/**
 * Live enforcement for the WSL backend against a real Windows host: a real WSL2 distro,
 * real bubblewrap inside it, real kernel denials.
 *
 * Host-gated — this backend exists on Windows only, and the sandbox distro must be
 * initialized; elsewhere the suite skips with the reason and profile.test.ts still pins
 * the profile, the sort and the refusals (unless PENGUIN_MUST_RUN names it; see
 * scripts/must-run.mjs). The backend is driven DIRECTLY here (no SandboxService): what a
 * plugin package owes is that its own confinement works, and routing/settings are the
 * harness's behavior, tested there with fakes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CommandSessionManager } from "@prismshadow/penguin-core";
import type { SandboxPolicy } from "@prismshadow/penguin-core/plugin";
import { mustRun } from "../../../scripts/must-run.mjs";
import { createWslProvider, toLinuxPath, wslSettingsOf } from "../src/index.js";
import { readHost, readState } from "../src/host.js";

const state = readState();
const cannotOpen = await (async () => {
  if (process.platform !== "win32") return "the WSL backend runs on Windows only";
  if (state === null) return "the sandbox distro is not initialized on this host";
  const host = await readHost();
  if (host.wsl !== "installed") return `WSL does not work here: ${host.problem ?? "not installed"}`;
  if (!host.distros.some((d) => d.toLowerCase() === state.distro.toLowerCase()))
    return `the distro ${state.distro} is gone from WSL`;
  return null;
})();
const usable = mustRun("sandbox-wsl", cannotOpen);

const provider = createWslProvider(() =>
  wslSettingsOf(state === null ? {} : { distro: state.distro }),
);

// Built in the describe's beforeAll and removed in its afterAll: a file whose every test
// is skipped never runs its hooks, so fixtures made at module level would leak a
// directory on every non-Windows run.
let ws = "";
let stateRoot = "";
let scratchpad = "";
let stateInWs = "";
let mgr: CommandSessionManager | null = null;

/** null = spawn unconfined; otherwise confine under this policy (workspaceRoot per spawn). */
let held: Omit<SandboxPolicy, "workspaceRoot"> | null = null;

/** The distro's spelling of a Windows path, for the command string the test writes. */
function inDistro(windowsPath: string): string {
  const linux = toLinuxPath(windowsPath, state === null ? undefined : state.distro);
  if (linux === null) throw new Error(`no distro path for ${windowsPath}`);
  return linux;
}

async function run(cmd: string): Promise<{ code: number | null; out: string }> {
  if (mgr === null) throw new Error("run() before the suite's beforeAll built it");
  const session = mgr.spawn({ cmd, cwd: ws });
  let out = "";
  // A distro can take a moment to boot on the first command; 30s, not 15.
  for await (const chunk of session.collect(30000)) out += chunk;
  if (session.running) session.kill();
  return { code: session.exit?.code ?? null, out };
}

describe.skipIf(!usable)("penguin-wsl live enforcement (Windows-host-gated)", () => {
  // Everything under the profile on a real drive: what the confined process writes must
  // reach the Windows host through the bind itself.
  beforeAll(() => {
    ws = mkdtempSync(path.join(homedir(), "penguin-wsl-live-ws-"));
    stateRoot = mkdtempSync(path.join(homedir(), "penguin-wsl-live-state-"));
    writeFileSync(path.join(stateRoot, "marker.txt"), "wsl-state-marker");
    scratchpad = path.join(stateRoot, "scratchpad", "session-1");
    mkdirSync(scratchpad, { recursive: true });
    stateInWs = path.join(ws, "state-root");
    mkdirSync(stateInWs);
    mgr = new CommandSessionManager({
      confineSpawn: () => (argv, opts) =>
        held === null
          ? { argv }
          : provider.confine(argv, { ...held, workspaceRoot: opts.workspaceDir }),
      workspaceDir: ws,
    });
  });

  afterAll(() => {
    mgr?.dispose();
    rmSync(ws, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  });

  /** A confined `echo` that must succeed and reach the Windows host file with this content. */
  async function writes(file: string, text: string) {
    const r = await run(`echo ${text.trim()} > ${JSON.stringify(inDistro(file))}`);
    expect(r.code, r.out).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(text);
  }

  /** A confined write that the kernel must deny, leaving nothing on the host. */
  async function denied(target: string) {
    const r = await run(`echo leak > ${JSON.stringify(inDistro(target))} 2>&1; echo exit=$?`);
    expect(r.out).toMatch(/read-only file system|permission denied|operation not permitted/i);
    expect(existsSync(target)).toBe(false);
  }

  /** A confined read of a file inside the state root. */
  async function reads(file: string, marker: string) {
    const r = await run(`cat ${JSON.stringify(inDistro(file))}`);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(marker);
  }

  it("holds the agent state read-only: the workspace and the scratchpad write, the state root does not, and it stays readable", async () => {
    held = { mode: "workspace-write", readonlyRoots: [stateRoot], writableRoots: [scratchpad] };
    await writes(path.join(ws, "wsl-ws.txt"), "wsl-ws-ok\n");
    await writes(path.join(scratchpad, "pad.txt"), "pad\n");
    await denied(path.join(stateRoot, "leak.txt"));
    await reads(path.join(stateRoot, "marker.txt"), "wsl-state-marker");
    // The corner layout: the mount order, not the layout, holds the state root read-only.
    held = { ...held, readonlyRoots: [stateInWs] };
    await denied(path.join(stateInWs, "leak.txt"));
  });

  it("a read-only root with no path in the distro refuses the confine rather than dropping it", () => {
    expect(() =>
      provider.confine(["bash", "-lc", "true"], {
        mode: "workspace-write",
        workspaceRoot: ws,
        readonlyRoots: ["\\\\wsl.localhost\\SomeOtherDistro\\home\\x"],
      }),
    ).toThrow(/no path inside the WSL distro/);
  });
});
