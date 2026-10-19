/**
 * Unit tests for penguin-bwrap: the exact profile it builds for each dimension, and
 * its fail-closed behavior when bubblewrap is unusable. The probe is injected, so both
 * paths are deterministic on any host (a real-bwrap host also runs sandbox-live).
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  bwrapProfileArgs,
  bwrapSettingsOf,
  createPenguinBwrapProvider,
  loadPenguinBwrapProvider,
  sortedMounts,
  vendoredRunner,
} from "../src/index.js";

const ARGV = ["bash", "-lc", "echo hi"] as const;
const WS = "/work/project";

/** argv slice between two markers, for asserting order without pinning the whole array. */
function after(argv: readonly string[], marker: string): readonly string[] {
  return argv.slice(argv.indexOf(marker));
}

/** Index of the `flag path path` mount in a profile, or -1: order assertions without offsets. */
function mountAt(args: readonly string[], flag: string, mountPath: string): number {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1] === mountPath && args[i + 2] === mountPath) return i;
  }
  return -1;
}

describe("penguin-bwrap profile", () => {
  it("read-only: the world is read-only, nothing is writable, no network flag", () => {
    const args = bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS });
    expect(args).toEqual([
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--die-with-parent",
    ]);
  });

  // skipIf(win32): the profile echoes host path resolution, which turns the POSIX
  // workspace literal into a drive path — and bwrap never runs there anyway.
  it.skipIf(process.platform === "win32")(
    "workspace-write: the workspace becomes writable, and /tmp only when temp is",
    () => {
      const args = bwrapProfileArgs({ mode: "workspace-write", workspaceRoot: WS });
      expect(args.join(" ")).toContain(`--bind ${WS} ${WS}`);
      expect(args).not.toContain("--tmpfs");

      const withTemp = bwrapProfileArgs({
        mode: "workspace-write",
        workspaceRoot: WS,
        writableTemp: true,
      });
      expect(withTemp.join(" ")).toContain("--tmpfs /tmp");
      expect(withTemp.join(" ")).toContain(`--bind ${WS} ${WS}`);
      // /tmp is the tmpfs, never also a bind of the host's /tmp.
      expect(withTemp.join(" ")).not.toContain("--bind /tmp /tmp");
    },
  );

  // skipIf(win32): as above, host path resolution would rewrite the POSIX literals.
  it.skipIf(process.platform === "win32")(
    "workspace-write binds the policy's further roots (the Session's scratchpad) writable; read-only ignores them",
    () => {
      const scratchpad = "/data/agent/scratchpad/session-1";
      const args = bwrapProfileArgs({
        mode: "workspace-write",
        workspaceRoot: WS,
        writableRoots: [scratchpad],
      });
      expect(args.join(" ")).toContain(`--bind ${WS} ${WS}`);
      expect(args.join(" ")).toContain(`--bind ${scratchpad} ${scratchpad}`);

      const readOnly = bwrapProfileArgs({
        mode: "read-only",
        workspaceRoot: WS,
        writableRoots: [scratchpad],
      });
      expect(readOnly).toEqual(bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS }));
    },
  );

  it("read-only with writable temp: a tmpfs /tmp is the only writable place", () => {
    const args = bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS, writableTemp: true });
    expect(args.join(" ")).toContain("--tmpfs /tmp");
    expect(args.join(" ")).not.toContain(`--bind ${WS}`);
  });

  it("refuses the local network level rather than reading it as an open network", () => {
    expect(() =>
      bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS, network: "local" }),
    ).toThrow(/local network/);
  });

  it("full access binds the root read-WRITE, but still cuts the network when asked", () => {
    const args = bwrapProfileArgs({
      mode: "danger-full-access",
      workspaceRoot: WS,
      network: "none",
    });
    // The whole filesystem is writable: --bind / /, never --ro-bind / /.
    expect(args.slice(0, 3)).toEqual(["--bind", "/", "/"]);
    expect(args.join(" ")).not.toContain("--ro-bind / /");
    // The network cut still applies — that is why the policy reached a backend at all.
    expect(args).toContain("--unshare-net");
  });

  it("network: none adds --unshare-net; absent leaves the network alone", () => {
    expect(bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS, network: "none" })).toContain(
      "--unshare-net",
    );
    expect(bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS })).not.toContain(
      "--unshare-net",
    );
  });

  it("mask-paths: a directory becomes an empty tmpfs, a file is shadowed by /dev/null", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "penguin-mask-"));
    const file = path.join(dir, "secret.txt");
    writeFileSync(file, "shh");
    const sub = path.join(dir, "sub");
    mkdirSync(sub);
    try {
      const args = bwrapProfileArgs({
        mode: "read-only",
        workspaceRoot: WS,
        maskPaths: [sub, file],
      });
      expect(args.join(" ")).toContain(`--tmpfs ${sub}`);
      expect(args.join(" ")).toContain(`--ro-bind /dev/null ${file}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mask-paths: a path that does not exist is skipped (nothing to hide)", () => {
    const args = bwrapProfileArgs({
      mode: "read-only",
      workspaceRoot: WS,
      maskPaths: [path.join(tmpdir(), "penguin-definitely-absent-path")],
    });
    expect(args.join(" ")).not.toContain("penguin-definitely-absent-path");
  });

  it("masks come AFTER the read-only bind of / that would otherwise expose them", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "penguin-mask-order-"));
    try {
      const args = bwrapProfileArgs({ mode: "read-only", workspaceRoot: WS, maskPaths: [dir] });
      // bwrap applies mounts in order: the mask must be in the tail after `--ro-bind / /`.
      expect(after(args, "--ro-bind").join(" ")).toContain(`--tmpfs ${dir}`);
      expect(args.indexOf(dir)).toBeGreaterThan(args.indexOf("--die-with-parent"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // skipIf(win32): the profile echoes host path resolution, and bwrap never runs there.
  it.skipIf(process.platform === "win32")(
    "readonly-roots: every path mount in one order — deeper later, read-only winning ties",
    () => {
      // writableTemp grants TMPDIR's own depth; pin it so the asserted order is fixed.
      const was = process.env.TMPDIR;
      process.env.TMPDIR = "/tmp";
      try {
        const mounts = sortedMounts({
          mode: "workspace-write",
          workspaceRoot: "/work/project",
          writableRoots: ["/work/project/scratch", "/data/agent/scratchpad/s"],
          readonlyRoots: ["/work/project/state", "/etc"],
          writableTemp: true,
        });
        // Deeper later; at the same depth the read-only mount follows the writable one.
        expect(mounts.map((mount) => mount.path)).toEqual([
          "/tmp",
          "/etc",
          "/work/project",
          "/work/project/scratch",
          "/work/project/state",
          "/data/agent/scratchpad/s",
        ]);
      } finally {
        if (was === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = was;
      }
    },
  );

  /** A workspace-write policy over the test Workspace, with these further roots. */
  const ws = (readonlyRoots?: readonly string[], writableRoots?: readonly string[]) => ({
    mode: "workspace-write" as const,
    workspaceRoot: WS,
    ...(readonlyRoots ? { readonlyRoots } : {}),
    ...(writableRoots ? { writableRoots } : {}),
  });

  /** An order row's mounts — flag before path — in the order the profile must show them. */
  const chain = (...pairs: [string, string][]) => pairs;

  // Order rows: a later mount shadows an earlier one beneath it, so the order must hold.
  it.skipIf(process.platform === "win32").each([
    {
      name: "a state root inside the workspace shadows the writable bind that covers it",
      policy: ws(["/work/project/state"]),
      order: chain(["--bind", WS], ["--ro-bind", "/work/project/state"]),
    },
    {
      name: "the scratchpad inside the state root mounts later still and stays writable",
      policy: ws(["/work/project/state"], ["/work/project/state/scratchpad"]),
      order: chain(
        ["--bind", WS],
        ["--ro-bind", "/work/project/state"],
        ["--bind", "/work/project/state/scratchpad"],
      ),
    },
    {
      name: "full access still mounts the read-only root, shadowing the writable bind of /",
      policy: {
        mode: "danger-full-access" as const,
        workspaceRoot: WS,
        readonlyRoots: ["/data/agent-state"],
      },
      order: chain(["--bind", "/"], ["--ro-bind", "/data/agent-state"]),
    },
  ])("$name", ({ policy, order }) => {
    // Not skipped for falling inside a writable root: the ro-bind must be there, later.
    const args = bwrapProfileArgs(policy);
    let prev = -1;
    for (const [flag, mount] of order) {
      const at = mountAt(args, flag, mount);
      expect(at, `${flag} ${mount}`).toBeGreaterThan(prev);
      prev = at;
    }
  });

  it.skipIf(process.platform === "win32")(
    "readonly-roots: deduplicated, and the temp tmpfs stays private when /tmp is a root",
    () => {
      const dupes = bwrapProfileArgs({
        mode: "workspace-write",
        workspaceRoot: WS,
        readonlyRoots: ["/etc", "/etc"],
        writableTemp: true,
      }).join(" ");
      expect(dupes.split("--ro-bind /etc /etc").length - 1).toBe(1);
      expect(
        bwrapProfileArgs({
          mode: "workspace-write",
          workspaceRoot: "/tmp",
          readonlyRoots: [],
          writableRoots: ["/tmp"],
          writableTemp: true,
        }).join(" "),
      ).not.toContain("--bind /tmp /tmp");
    },
  );
});

describe("penguin-bwrap provider", () => {
  it("implements every dimension of the built-in interface", () => {
    expect(createPenguinBwrapProvider({ probe: () => true }).dimensions).toEqual([
      "fs-write",
      "network",
      "mask-paths",
      "closed-temp",
      "readonly-roots",
    ]);
  });

  it("wraps the caller's argv behind the profile and a -- separator", () => {
    const provider = createPenguinBwrapProvider({ probe: () => true, runner: "bwrap" });
    const confined = provider.confine([...ARGV], {
      mode: "workspace-write",
      workspaceRoot: WS,
      network: "none",
    });
    expect(confined.argv[0]).toBe("bwrap");
    expect(confined.argv.slice(-3)).toEqual([...ARGV]);
    expect(confined.argv[confined.argv.length - 4]).toBe("--");
    expect(confined.argv).toContain("--unshare-net");
    expect(confined.enforcement).toBe("full");
  });

  it("an unusable bwrap fails closed, and the probe runs once", () => {
    let probes = 0;
    const provider = createPenguinBwrapProvider({
      probe: () => {
        probes++;
        return false;
      },
    });
    const policy = { mode: "read-only", workspaceRoot: WS } as const;
    expect(() => provider.confine([...ARGV], policy)).toThrow(/cannot confine on this host/);
    expect(() => provider.confine([...ARGV], policy)).toThrow(/cannot confine on this host/);
    expect(probes).toBe(1);
  });

  it("reads its settings at each confine, probing each runner once with the timeout set", () => {
    const probed: Array<[number, string]> = [];
    let doc: Record<string, unknown> = {};
    const provider = createPenguinBwrapProvider({
      probe: (timeoutMs, runner) => {
        probed.push([timeoutMs, runner]);
        return runner !== "/missing/bwrap";
      },
      // "" for the shipped binary: this is about the settings, not about what the package carries.
      settings: () => bwrapSettingsOf(doc, ""),
    });
    const policy = { mode: "read-only", workspaceRoot: WS } as const;
    expect(provider.confine([...ARGV], policy).argv[0]).toBe("bwrap");
    doc = { runner: " /opt/bwrap ", probeTimeoutSeconds: 2 };
    expect(provider.confine([...ARGV], policy).argv[0]).toBe("/opt/bwrap");
    expect(provider.confine([...ARGV], policy).argv[0]).toBe("/opt/bwrap");
    doc = { runner: "/missing/bwrap" };
    expect(() => provider.confine([...ARGV], policy)).toThrow(/'\/missing\/bwrap' is missing/);
    expect(probed).toEqual([
      [5000, "bwrap"],
      [2000, "/opt/bwrap"],
      [5000, "/missing/bwrap"],
    ]);
  });
});

describe("bwrap on another platform", () => {
  it("declines off Linux (not a failure), and fails with a reason on Linux it cannot serve", async () => {
    const other = "win32" as const;
    await expect(
      loadPenguinBwrapProvider({ platform: other, probe: () => true }),
    ).resolves.toBeNull();
    await expect(
      loadPenguinBwrapProvider({ platform: "linux", probe: () => false }),
    ).rejects.toThrow(/is missing or refuses/);
    await expect(
      loadPenguinBwrapProvider({ platform: "linux", probe: () => true }),
    ).resolves.toBeDefined();
  });

  it("names the switch of each distribution that gates user namespaces, Ubuntu's included", async () => {
    const rejection = loadPenguinBwrapProvider({ platform: "linux", probe: () => false });
    await expect(rejection).rejects.toThrow(/kernel\.unprivileged_userns_clone/);
    await expect(rejection).rejects.toThrow(/kernel\.apparmor_restrict_unprivileged_userns/);
    // The root step is optional: sandbox-dsh confines files without it.
    await expect(rejection).rejects.toThrow(/sandbox-dsh confines file writes without them/);
    await expect(rejection).rejects.toThrow(/Optional: a one-time root step lets bubblewrap run/);
  });

  it("carries what the runner said, and that it did not start at all", async () => {
    await expect(
      loadPenguinBwrapProvider({
        platform: "linux",
        settings: () => ({ runner: "/nonexistent/bwrap", probeTimeoutMs: 5000 }),
      }),
    ).rejects.toThrow(/'\/nonexistent\/bwrap' is missing or refuses the base profile \(.*ENOENT/);
  });

  it("names itself bubblewrap on the settings card", () => {
    expect(createPenguinBwrapProvider({ probe: () => true }).mechanism).toBe("bubblewrap");
  });
});

describe("the bwrap it runs", () => {
  it("ships its own, so a host without bubblewrap still confines", () => {
    // The real thing: the package carries a binary for THIS host (scripts/vendor-bwrap.mjs) —
    // on Linux only, the one platform bubblewrap runs on. Elsewhere there is none to carry.
    const shipped = vendoredRunner();
    if (process.platform !== "linux") {
      expect(shipped).toBe("");
      return;
    }
    expect(shipped).toMatch(/vendor[\\/]linux-(x64|arm64)[\\/]bin[\\/]bwrap$/);
    expect(existsSync(shipped)).toBe(true);
  });

  it("carries none for a host it has no binary for, and says so with an empty path", () => {
    expect(vendoredRunner("win32", "x64", () => false)).toBe("");
  });

  it("what the deployment names wins; then the shipped one; then a bwrap on PATH", () => {
    const shipped = "/pkg/vendor/linux-x64/bin/bwrap";
    expect(bwrapSettingsOf({ runner: "/usr/bin/bwrap" }, shipped).runner).toBe("/usr/bin/bwrap");
    expect(bwrapSettingsOf({}, shipped).runner).toBe(shipped);
    expect(bwrapSettingsOf({ runner: "  " }, shipped).runner).toBe(shipped);
    expect(bwrapSettingsOf({}, "").runner).toBe("bwrap");
  });
});
