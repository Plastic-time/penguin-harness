/**
 * @penguinharness/sandbox-dsh — the DeepSeek Harness sandbox ecosystem
 * behind this harness's own sandbox interface.
 *
 * A PLUGIN PACKAGE, not part of the platform: a Project asks for it on the Plugins page
 * and the harness resolves it from the installation (see the server's plugin/loader.ts).
 * The DSH dependencies live HERE, in this package — the harness itself does not depend
 * on them, which is what "plugins are configuration, not built-in capability" means in
 * dependency terms.
 *
 * `@deepseek-ai/dsh-sandbox-local` carries the platform chain (dsh-bwrap → Landlock on
 * Linux, Seatbelt on macOS, the ACL restricted-token runner on Windows) and probes them
 * functionally; this file translates between its vocabulary and ours. Because DSH's
 * policy vocabulary governs file-write effects only, the adaptor declares exactly
 * `fs-write` — except under the Landlock rung, which this file extends: Landlock is an
 * allow-list, so a read-only state root needs no new rule (nothing grants it a write), and
 * the launcher's own flag vocabulary — `grantArgs`, imported behind the same dynamic-import
 * rule as everything else DSH — lets the adaptor splice the policy's writable roots (the
 * Session's scratchpad) into the grants. The service therefore routes a `readonly-roots`
 * policy here only when the chain picked Landlock, and the adaptor never has to drop a
 * dimension it cannot honor.
 *
 * Everything DSH loads behind the dynamic imports below, and that is load-bearing for
 * hot push (see scripts/deploy.mjs): the package reaches native-adjacent modules that a
 * pushed single-file bundle resolves from the installation, so an installation missing
 * them fails THIS load — reported fail-closed by the service — instead of failing the
 * whole platform bundle's import.
 */
import { tmpdir } from "node:os";
import path from "node:path";
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type {
  ConfinedArgv,
  Plugin,
  SandboxDimension,
  SandboxLimit,
  SandboxPolicy,
  SandboxProvider,
  SandboxProviderSource,
} from "@prismshadow/penguin-core/plugin";

/**
 * Programs the Windows ACL restricted-token runner cannot start — and they include the harness's
 * Windows default session shell (Git for Windows' bash, or the `sh.exe` of the MinGit the
 * Windows package bundles). Measured on windows-latest: a bare `bash`
 * reaches System32's WSL launcher before PATH ("Error code:
 * Bash/Service/CreateInstance/E_ACCESSDENIED"), and an MSYS bash or sh named by path aborts
 * under the write-restricted token ("fatal error - couldn't create signal pipe, Win32 error
 * 5" / "CreateFileMapping …, Win32 error 5"). In the same run both PowerShells ran confined,
 * writing inside the Workspace and denied outside it: pwsh 7.6.6 and Windows PowerShell 5.1.
 *
 * The abort is the MSYS runtime's (msys-2.0.dll, shared by Git for Windows and MSYS2), not
 * bash's, so it is refused by runtime: the POSIX shells those distributions ship, by name, and
 * any program in an MSYS `usr\bin` — the directory where every binary links that runtime.
 */
const MSYS_SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "mksh", "fish", "git-bash"]);

/** What the backend reads of the harness's session shell (core's `ShellInvocation`). */
export interface SessionShell {
  /** Executable name or path the harness spawns commands with. */
  command: string;
}

const unstartable = (program: string): boolean => {
  const segments = program.toLowerCase().split(/[\\/]+/);
  const base = (segments.at(-1) ?? "").replace(/\.exe$/i, "");
  return MSYS_SHELLS.has(base) || (segments.at(-3) === "usr" && segments.at(-2) === "bin");
};

/** The one setting that fixes an MSYS-runtime session shell, as every refusal of it words it. */
const SESSION_SHELL_FIX =
  "Set PENGUIN_SHELL=pwsh (PowerShell 7) — or PENGUIN_SHELL=powershell (Windows PowerShell " +
  "5.1) where PowerShell 7 is not installed — in the harness's environment and restart it";

/**
 * Fail this backend's load on Windows when the harness's session shell is one its ACL runner
 * cannot start. A backend whose load fails is not mounted: the sandbox service reports it with
 * this reason (the Session view's `unavailableBackends`), so the confining tier shows as
 * unavailable with the fix, rather than selectable and then refusing every command. `null` is
 * a host core that does not export the session shell (an older runtime): nothing is checked,
 * and `assertAclRunnerCanStart` still refuses per command.
 */
export function assertSessionShellConfinable(
  shell: SessionShell | null,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32" || shell === null || !unstartable(shell.command)) return;
  throw new Error(
    `sandbox-dsh cannot confine commands on Windows under the session shell "${shell.command}": ` +
      "its ACL runner does not start bash, sh or any other MSYS-runtime program (Git for " +
      "Windows, the bundled MinGit, MSYS2). " +
      `${SESSION_SHELL_FIX}.`,
  );
}

/**
 * Refuse, before the runner is involved, a spawn whose program the ACL runner cannot start.
 * Without this every confined command still fails closed, but with the runner's error — which
 * names WSL or an MSYS internal, not the setting that fixes it. The same `confine()` carries a
 * stdio MCP Server's launch command, which `PENGUIN_SHELL` does not choose: only a program that
 * IS the session shell is pointed at that setting. A `sessionShell` of `null` (a host core that
 * does not export it) cannot tell the two apart and keeps the session shell's wording.
 */
export function assertAclRunnerCanStart(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
  sessionShell: SessionShell | null = null,
): void {
  const program = argv[0];
  if (platform !== "win32" || program === undefined || !unstartable(program)) return;
  if (sessionShell === null || sessionShell.command.toLowerCase() === program.toLowerCase()) {
    throw new Error(
      `sandbox-dsh cannot confine "${program}" on Windows: its ACL runner does not start bash, ` +
        `sh or any other MSYS-runtime program (Git for Windows, the bundled MinGit, MSYS2). ` +
        `${SESSION_SHELL_FIX}; refusing to run the ` +
        "command unconfined.",
    );
  }
  throw new Error(
    `sandbox-dsh cannot confine "${program}" on Windows: its ACL runner does not start bash, ` +
      "sh or any other MSYS-runtime program (Git for Windows, the bundled MinGit, MSYS2, or " +
      "System32's WSL launcher); start the program " +
      "directly, or through PowerShell; refusing to run it unconfined.",
  );
}

/**
 * The host's plugin contract, named by a variable so this package's bundle leaves the import to
 * run time: tsup inlines `@prismshadow/penguin-core/plugin` for the decorators (a literal
 * specifier), and a second, bundled copy of the session shell would be this package's
 * resolution, not the harness's. Resolved where the plugin runs, from the installation; where
 * the host's core cannot be reached the import fails and `hostSessionShell` returns `null`.
 */
const HOST_CORE: string = "@prismshadow/penguin-core/plugin";

/**
 * The harness's session shell, from the host's core; `null` when that core does not export
 * `sessionShell` (it arrived after the runtimes a hot push may still be running on) or cannot
 * be reached. Read by namespace, never as a static named import: a missing export must not
 * fail this module's linking. `load` is injectable for tests.
 */
export async function hostSessionShell(
  load: () => Promise<unknown> = () => import(HOST_CORE),
): Promise<SessionShell | null> {
  let core: { sessionShell?: unknown };
  try {
    core = (await load()) as { sessionShell?: unknown };
  } catch {
    return null;
  }
  return typeof core.sessionShell === "function" ? (core.sessionShell() as SessionShell) : null;
}

/** What `loadDshAdaptor` reads of the running process; injectable for tests. */
export interface DshLoadHost {
  platform?: NodeJS.Platform;
  /** The session shell, `null` for a host core without one; read from the host when absent. */
  sessionShell?: SessionShell | null;
}

/**
 * The rung DSH's chain selected, by the program its wrap starts: on Linux bubblewrap when it
 * passed the chain's probe, else the Landlock launcher; one rung each on macOS and Windows.
 */
export function rungName(platform: NodeJS.Platform, runner: string | undefined): string {
  if (platform === "darwin") return "Seatbelt";
  if (platform === "win32") return "the Windows ACL runner";
  return runner === "bwrap" ? "bubblewrap" : "Landlock";
}

/** The dimensions a rung of DSH's chain can be routed, as this file loads them. */
export function declaredDimensions(rung: string): readonly SandboxDimension[] {
  // Only the Landlock rung can hold a read-only state root: its allow-list needs no new
  // rule for it, and the writable roots this file splices in speak the launcher's own flag
  // vocabulary. Every other rung stays what it was — filesystem writes only.
  return rung === "Landlock" ? ["fs-write", "readonly-roots"] : ["fs-write"];
}

/**
 * The writable roots the Landlock rung must grant BEYOND its own profile, under Workspace
 * Write — the one mode where that profile grants anything writable besides /dev/null: the
 * policy's further roots (the Session's scratchpad), plus the host's actual temp directory
 * whenever the policy keeps temp writable, because the chain's profile names only the
 * literal `/tmp` and a deployment whose TMPDIR points elsewhere must not lose its temp.
 * What the profile already grants (that literal `/tmp`, the workspace) drops out, so nothing
 * is granted twice. Read-only keeps the chain's own profile untouched: nothing to splice.
 */
export function grantableWritableRoots(
  policy: Pick<SandboxPolicy, "mode" | "workspaceRoot" | "writableRoots" | "writableTemp">,
  tmp: string = tmpdir(),
): string[] {
  if (policy.mode !== "workspace-write") return [];
  const alreadyGranted = new Set(["/tmp", path.resolve(policy.workspaceRoot)]);
  return [...(policy.writableRoots ?? []), ...(policy.writableTemp !== false ? [tmp] : [])]
    .map((root) => path.resolve(root))
    .filter((root, at, all) => all.indexOf(root) === at && !alreadyGranted.has(root));
}

/**
 * Whether Landlock can hold these read-only roots at all. It is an allow-list with no
 * subtractive rule: on a path inside (or equal to) a writable grant, the closest ancestor's
 * rights apply, so the grant wins and the root stays writable — the read-only promise would
 * be a lie. Refusing here is the fail-closed answer. The carve-OUT direction needs no check:
 * a writable root deeper INSIDE a read-only one is exactly how the scratchpad stays writable
 * under a read-only state root, and a more specific grant is precisely how Landlock spells it.
 */
export function assertLandlockCanExpress(
  readonlyRoots: readonly string[],
  rwGrants: readonly string[],
): void {
  for (const rawRoot of readonlyRoots) {
    const root = path.resolve(rawRoot);
    for (const rawGrant of rwGrants) {
      const grant = path.resolve(rawGrant);
      const relative = path.relative(grant, root);
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
        throw new Error(
          `dsh-local cannot hold ${root} read-only under Landlock: it sits inside the ` +
            `writable grant ${grant}, and Landlock has no rule that subtracts; refusing ` +
            "to run the command with that path writable.",
        );
      }
    }
  }
}

/** The launcher's grant-argument function, as `@deepseek-ai/node-addon-landlock-run` exports it. */
export type GrantArgs = (grants: {
  readOnly?: readonly string[];
  readWrite?: readonly string[];
}) => string[];

/**
 * The extra writable grants spliced into a Landlock wrapper. The caller's command must sit
 * behind the same `--` separator it started behind, so the known tail — the separator and
 * the caller's argv — is stripped, the grants go in front of the separator, and the tail is
 * re-attached. A wrapper that does not end with exactly that tail is refused rather than
 * spliced by guesswork: the launcher's flag spellings are private to its package, and a
 * splice into an unknown shape could grant to the wrong path or drop the command's own
 * arguments.
 */
export function spliceLandlockGrants(
  wrapped: readonly string[],
  callerArgv: readonly string[],
  extra: readonly string[],
  grantArgs: GrantArgs,
): string[] {
  const at = wrapped.length - callerArgv.length - 1;
  const endsWithTail =
    at >= 0 && wrapped[at] === "--" && callerArgv.every((arg, i) => wrapped[at + 1 + i] === arg);
  if (!endsWithTail) {
    throw new Error(
      'dsh-local: the Landlock wrapper no longer ends with "--" and the caller\'s command; ' +
        "refusing to splice further grants into an unknown argv shape.",
    );
  }
  if (extra.length === 0) return [...wrapped];
  return [...wrapped.slice(0, at), ...grantArgs({ readWrite: [...extra] }), ...wrapped.slice(at)];
}

/**
 * What the rung leaves open, for the settings card. DSH's policy takes the mode and the
 * Workspace and nothing more, so the rungs that keep DSH's own profile grant the Session's
 * scratchpad (SandboxPolicy.writableRoots) nothing; under Landlock this file splices those
 * roots into the launcher's grants, so there the scratchpad is writable and the limitation
 * that remains is the shared /tmp. On a kernel older than Landlock ABI 5 the launcher
 * governs only part of the file accesses, and says so on every run (dropped from the
 * command's stderr, see the core's ConfinedSpawn.runnerLines).
 */
export function rungLimits(rung: string, enforcement: "full" | "partial"): SandboxLimit[] {
  const limits: SandboxLimit[] = [];
  if (rung !== "Landlock") {
    limits.push({
      text: `${rung}: under Workspace Write the Session scratchpad is not writable — DSH's policy takes the Workspace alone — so commands cannot write the plan, goal or attachment files kept there.`,
      textZh: `${rung}：仅工作区可写下 Session scratchpad 不可写（DSH 的策略只接受工作区），命令无法写入其中的计划、目标与附件文件。`,
    });
    return limits;
  }
  limits.push({
    text: "Landlock: under Workspace Write the temporary directory is the host's shared /tmp, writable by every confined command; it cannot be closed or made private here.",
    textZh:
      "Landlock：仅工作区可写下，临时目录就是宿主共享的 /tmp，每条受限命令都可写；本机无法关闭它，也无法让它私有。",
  });
  if (enforcement === "partial") {
    limits.push({
      text: "Landlock (partial): this kernel's Landlock ABI is older than 5 (Linux 6.10), so ioctl on device files outside the Workspace is not restricted; below ABI 3 (Linux 6.2) truncating a file outside the Workspace is not restricted either.",
      textZh:
        "Landlock（partial）：本机内核的 Landlock ABI 低于 5（Linux 6.10），工作区外设备文件上的 ioctl 不受限制；低于 ABI 3（Linux 6.2）时，截断工作区外的文件也不受限制。",
    });
  }
  return limits;
}

/**
 * Mount the stock DSH chain on a bare cordis Context — exactly how DSH's own tests mount it —
 * after checking, on Windows, that its ACL runner can start the session shell at all.
 */
export async function loadDshAdaptor(host: DshLoadHost = {}): Promise<SandboxProvider | null> {
  const platform = host.platform ?? process.platform;
  const shell =
    platform !== "win32"
      ? null
      : host.sessionShell !== undefined
        ? host.sessionShell
        : await hostSessionShell();
  assertSessionShellConfinable(shell, platform);
  const { Context } = await import("@deepseek-ai/cordis");
  const { LocalSandboxProvider } = await import("@deepseek-ai/dsh-sandbox-local");
  const ctx = new Context();
  // `ctx.plugin` is cordis's own API name, not this repo's vocabulary.
  await ctx.plugin(LocalSandboxProvider, {});
  const dsh = ctx.sandbox;
  // The chain picks its rung on the first confine; do that here, so the settings card can name
  // the rung that serves. On Linux, whose chain has two rungs, that is the chain's functional
  // probes (DSH keeps the verdict for the provider's lifetime), and a host where neither works
  // fails this load with DSH's reason instead of mounting a backend that refuses every command.
  // macOS and Windows have a single rung, which DSH selects unprobed: this proves nothing there.
  const probe = dsh.confine([process.execPath], { mode: "read-only", workspaceRoot: tmpdir() });
  const rung = rungName(platform, probe.argv[0]);
  // The Landlock rung is the one this file extends, and the extension speaks the launcher's
  // own flag vocabulary — behind the same dynamic-import rule as everything else DSH (hot
  // push, see the file header), from a package this one depends on directly.
  const grantArgs: GrantArgs | null =
    rung === "Landlock" ? (await import("@deepseek-ai/node-addon-landlock-run")).grantArgs : null;
  return {
    // DSH's own words: "Network and process visibility are outside this vocabulary." Nor can it
    // close the temporary directory (`closed-temp`): every rung grants one under workspace-write.
    // `readonly-roots` rides only on the Landlock rung — the dimensions the service routes by.
    dimensions: declaredDimensions(rung),
    mechanism: rung + (probe.enforcement === "partial" ? " (partial)" : ""),
    limits: rungLimits(rung, probe.enforcement),
    confine(argv, policy): ConfinedArgv {
      if (policy.mode === "danger-full-access") {
        // DSH has no vocabulary for "the whole filesystem writable but these roots": the
        // service prefers a backend that declares more dimensions, so a full-access policy
        // that also holds the state read-only reaches the bwrap backend first; when only
        // this one is mounted it lands here, and refusing beats running with a root the
        // policy promised read-only.
        throw new Error("dsh-local does not implement full filesystem access with confinement");
      }
      assertAclRunnerCanStart(argv, platform, shell);
      const readonlyRoots = [
        ...new Set((policy.readonlyRoots ?? []).map((root) => path.resolve(root))),
      ];
      // What the Landlock rung must grant beyond its own profile; unused everywhere else.
      const extra = grantableWritableRoots(policy);
      if (readonlyRoots.length > 0) {
        if (grantArgs === null) {
          // Defensive: the service routes by the dimensions this provider declared at load,
          // so a read-only state root reaching another rung means a stale mounted provider or
          // an embedder wiring around the service. Drop the roots is the one forbidden
          // direction — refuse instead.
          throw new Error(
            `dsh-local cannot hold the agent state read-only under ${rung}: only the Landlock ` +
              "rung has a vocabulary for it; refusing to run the command with the state writable.",
          );
        }
        // The writable grants that will be in force: the chain's own profile (always
        // /dev/null; /tmp and the workspace under Workspace Write) plus what this file
        // splices in. A read-only root inside one of those stays writable — unexpressable.
        assertLandlockCanExpress(
          readonlyRoots,
          policy.mode === "workspace-write"
            ? ["/dev/null", "/tmp", path.resolve(policy.workspaceRoot), ...extra]
            : ["/dev/null", ...extra],
        );
      }
      const confined = dsh.confine(argv, {
        mode: policy.mode,
        workspaceRoot: policy.workspaceRoot,
      });
      return {
        argv:
          grantArgs === null || extra.length === 0
            ? confined.argv
            : spliceLandlockGrants(confined.argv, argv, extra, grantArgs),
        enforcement: confined.enforcement,
        denialSignatures: confined.denialSignatures,
        runnerFailureRules: confined.runnerFailureRules,
      };
    },
  };
}

/**
 * The plugin's one module: a provider on the sandbox slot, the code half of the
 * contribution the decorator declares (its manifest is generated into ifaces.json from
 * here). Created per App, so a hot swap gets a fresh provider.
 */
@Component({
  contributes: {
    "WebModule.quickStarts": [
      {
        id: "sandbox-dsh.quick-start",
        prompt:
          "Test the sandbox your commands run under. Run three separate commands: write a file inside this Workspace, write a file in your home directory outside it, and fetch https://example.com. Report which succeeded and which were denied; if all three succeed, the sandbox is off (Settings → Plugins → Sandbox).",
        promptZh:
          "测试你执行命令时所处的沙盒。分三条命令执行：在当前工作区内写一个文件、在工作区外的家目录写一个文件、访问 https://example.com。报告哪些成功、哪些被拒；如果三条都成功，说明沙盒处于关闭状态（设置 → 插件 → 沙盒）。",
      },
    ],
    "SandboxModule.providers": [
      { id: "sandbox-dsh.provider", name: "dsh-local", dimensions: ["fs-write"] },
    ],
  },
})
export class SandboxDsh {
  @Bind("sandbox-dsh.provider") provider!: SandboxProviderSource;

  setup() {
    this.provider = loadDshAdaptor();
  }
}

const plugin: Plugin = { modules: [SandboxDsh] };
export default plugin;
