/**
 * The pure half of the backend: how a Windows path is spelled inside the distro, which Linux
 * program a Windows argv names, and the bubblewrap profile one policy becomes. No process is
 * started here, so all of it is tested on any host.
 *
 * The profile, in order (bwrap applies mounts in order, and a later one shadows an earlier):
 *
 *   --die-with-parent --unshare-all [--share-net]     namespaces; the network only when allowed
 *   --ro-bind / /  (--bind / / under full access)     the distro itself
 *   --dev /dev --proc /proc
 *   --tmpfs /run                                      WSL's interop sockets are not reachable
 *   --ro-bind-try /run/resolvconf/resolv.conf …       … but name resolution still is (see below)
 *   [writable temp]      --tmpfs /tmp
 *   [confining modes]    --tmpfs /mnt                 every Windows drive hidden …
 *   [exposeWindowsDrives]  --ro-bind /mnt/<d> …       … or shown read-only
 *   [path mounts]        sorted: deeper paths mount later, and at equal depth a
 *                        read-only mount mounts after a writable one — the Workspace,
 *                        the writable roots and the read-only roots in one order
 *   --ro-bind-try /mnt/wsl/resolv.conf …              the file /etc/resolv.conf points at
 *   --remount-ro /mnt                                 the covering tmpfs itself is read-only
 *   [full access]       --ro-bind <state root> …       the read-only roots still apply,
 *                        shadowing the writable bind of `/` from deeper paths
 *   [mask-paths]         --tmpfs <dir> | --ro-bind /dev/null <file>
 *
 * Why /mnt is hidden rather than left read-only: under WSL the whole Windows profile arrives at
 * /mnt/c/Users/<name>, credentials and browser data included. A policy that says "write the
 * Workspace" never meant "read the rest of the person's disk", and on Linux the equivalent
 * files belong to the host, not to a mount the distro adds. The setting that shows them
 * read-only exists for a toolchain that has to read something outside the Workspace.
 *
 * Why the tmpfs is remounted read-only: a tmpfs is writable, and bwrap creates the Workspace's
 * parent directories inside it. A write to `/mnt/c/Users/anything` therefore SUCCEEDED, in a
 * file that existed only for that one command and never reached Windows — a denial reported as
 * success, which is worse than a denial. Remounting after the binds makes the covering mount
 * refuse writes (EROFS) while the Workspace bound under it stays writable.
 *
 * Why resolv.conf is bound back: WSL keeps the generated one outside the distro's own root
 * (/mnt/wsl/resolv.conf, or /run/resolvconf/resolv.conf), and /etc/resolv.conf is a symlink to
 * it. Covering /mnt and /run therefore took DNS away — every name failed to resolve while the
 * network itself was reachable. The two candidates are bound back read-only; `-try` because a
 * distro uses one of them, not both.
 *
 * Why one order for every path mount: a state root the deployment's layout put inside the
 * Workspace (or inside the temp area) mounts later and shadows the writable bind that covers
 * it, while the scratchpad — a deeper child of the state root — mounts later still and stays
 * writable. A read-only root that has no spelling inside the distro is an error, not a skip:
 * dropping it would widen the sandbox, which is exactly what the field exists to forbid.
 */
import path from "node:path";
import type { SandboxPolicy } from "@prismshadow/penguin-core/plugin";

/** Where WSL mounts the Windows drives inside a distro (its default automount root). */
export const MOUNT_ROOT = "/mnt";

/** The generated resolv.conf, bound back through the tmpfs that would otherwise hide it. */
export const RESOLV_MNT = ["--ro-bind-try", "/mnt/wsl/resolv.conf", "/mnt/wsl/resolv.conf"];
export const RESOLV_RUN = [
  "--ro-bind-try",
  "/run/resolvconf/resolv.conf",
  "/run/resolvconf/resolv.conf",
];

/**
 * A Windows path as the distro sees it: `C:\Users\k\ws` → `/mnt/c/Users/k/ws`, and a path into
 * this distro's own filesystem (`\\wsl.localhost\<distro>\home\x`) → `/home/x`. Null for what
 * has no spelling in the distro: a relative path, another distro's files, a network share.
 */
export function toLinuxPath(windowsPath: string, distro?: string): string | null {
  const p = windowsPath.trim();
  if (p.startsWith("/")) return path.posix.normalize(p);
  const drive = /^([A-Za-z]):(?:[\\/](.*))?$/.exec(p);
  if (drive) {
    const rest = (drive[2] ?? "").split(/[\\/]+/).filter((s) => s !== "");
    return [`${MOUNT_ROOT}/${drive[1]!.toLowerCase()}`, ...rest].join("/");
  }
  const unc =
    /^[\\/]{2}(?:\?[\\/]UNC[\\/])?(wsl\.localhost|wsl\$)[\\/]([^\\/]+)(?:[\\/](.*))?$/i.exec(p);
  if (unc && distro !== undefined && unc[2]!.toLowerCase() === distro.toLowerCase()) {
    const rest = (unc[3] ?? "").split(/[\\/]+/).filter((s) => s !== "");
    return `/${rest.join("/")}`;
  }
  return null;
}

/**
 * The Linux program a Windows argv's first element means. The harness resolves its shell on
 * Windows as `bash` (Git Bash on PATH) or a full path to `bash.exe`; inside the distro that is
 * the distro's own bash. Anything else is looked up by its bare name on the distro's PATH —
 * a Windows program cannot run there at all, since interop is off.
 */
export function linuxProgram(command: string): string {
  const base = path.win32.basename(command).replace(/\.exe$/i, "");
  const lower = base.toLowerCase();
  if (lower === "bash") return "/bin/bash";
  if (lower === "sh") return "/bin/sh";
  return base;
}

/** What the profile needs to know about the host besides the policy. */
export interface ProfileHost {
  /** The distro's name, for a Workspace inside its own filesystem. */
  distro: string;
  /** Show every Windows drive read-only instead of hiding them. */
  exposeWindowsDrives: boolean;
  /** The drive letters that exist on this machine (lowercase), for exposing them. */
  drives: readonly string[];
  /** Whether a Windows path is a directory, a file, or nothing (a mask on nothing is skipped). */
  kind: (windowsPath: string) => "dir" | "file" | null;
}

/** One mount the profile applies in order: where it lands, the arguments that apply it, and whether it is read-only. */
interface DistroMount {
  /** The destination path the mount lands on, spelled inside the distro (binds: source === destination). */
  path: string;
  /** The arguments that apply the mount, in order. */
  args: string[];
  /** Read-only mounts sort after writable ones at the same depth, so a read-only root wins a tie. */
  readonly: boolean;
}

/** How deep a path is inside the distro: 0 for `/`, 1 for `/mnt`. */
function depth(linuxPath: string): number {
  return linuxPath === "/" ? 0 : linuxPath.split("/").length - 1;
}

/**
 * The read-only roots a policy names, spelled inside the distro and deduplicated. One that has
 * no spelling there is an error, not a skip: dropping a read-only root would widen the sandbox,
 * which is exactly what the field exists to forbid — the writable roots above may fall back to
 * "unreachable stays confined", a read-only root may not.
 */
function readonlyRootsInDistro(policy: SandboxPolicy, host: ProfileHost): string[] {
  const roots = [...new Set(policy.readonlyRoots ?? [])].map((root) => {
    const linux = toLinuxPath(root, host.distro);
    if (linux === null) {
      throw new Error(
        `penguin-wsl: the read-only root ${root} has no path inside the WSL distro ` +
          "(it must be on a local drive), and dropping it would widen the sandbox — refusing to confine.",
      );
    }
    return linux;
  });
  return roots;
}

/** The bubblewrap arguments for one policy: everything before `--` and the command. */
export function bwrapArgs(policy: SandboxPolicy, host: ProfileHost): string[] {
  const full = policy.mode === "danger-full-access";
  if (policy.network === "local") {
    // bwrap's empty network namespace also loses the host's loopback, so "localhost only" has
    // no spelling here. The service never routes it here (no network-local dimension); refuse
    // rather than read it as an open network.
    throw new Error("penguin-wsl cannot confine to the local network (localhost only)");
  }
  const readonly = readonlyRootsInDistro(policy, host);
  const args = ["--die-with-parent", "--unshare-all"];
  if (policy.network !== "none") args.push("--share-net");
  args.push(full ? "--bind" : "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc");
  args.push("--tmpfs", "/run", ...RESOLV_RUN);
  if (policy.writableTemp === true) args.push("--tmpfs", "/tmp");
  if (!full) {
    const workspace = toLinuxPath(policy.workspaceRoot, host.distro);
    if (workspace === null) {
      throw new Error(
        `penguin-wsl: the Workspace ${policy.workspaceRoot} has no path inside the WSL distro ` +
          "(it must be on a local drive), so it cannot be confined there.",
      );
    }
    args.push("--tmpfs", MOUNT_ROOT);
    if (host.exposeWindowsDrives) {
      for (const d of host.drives)
        args.push("--ro-bind", `${MOUNT_ROOT}/${d}`, `${MOUNT_ROOT}/${d}`);
    }
    // Every path mount in the one order bwrap needs: deeper paths mount later (a later mount
    // shadows an earlier one on every path beneath it), and at equal depth a read-only mount
    // mounts after a writable one. The writable roots keep their two skips — inside the
    // Workspace the bind is redundant, and one the distro cannot reach stays confined — while
    // the read-only roots skip nothing: a state root inside the Workspace must mount AFTER the
    // writable bind and shadow it, and the scratchpad, a deeper child of the state root,
    // mounts later still and stays writable.
    const mounts: DistroMount[] = [
      {
        path: workspace,
        args: [policy.mode === "workspace-write" ? "--bind" : "--ro-bind", workspace, workspace],
        readonly: policy.mode !== "workspace-write",
      },
    ];
    if (policy.mode === "workspace-write") {
      for (const root of policy.writableRoots ?? []) {
        const linux = toLinuxPath(root, host.distro);
        if (linux !== null && !within(linux, [workspace]))
          mounts.push({ path: linux, args: ["--bind", linux, linux], readonly: false });
      }
    }
    for (const linux of readonly)
      mounts.push({ path: linux, args: ["--ro-bind", linux, linux], readonly: true });
    mounts.sort((a, b) => depth(a.path) - depth(b.path) || Number(a.readonly) - Number(b.readonly));
    for (const mount of mounts) args.push(...mount.args);
    // Last over /mnt, and only now: the binds above need a writable tmpfs to create their
    // mountpoints in, and the remount is what stops a write outside the Workspace from
    // "succeeding" into a tmpfs nobody ever reads.
    args.push(...RESOLV_MNT, "--remount-ro", MOUNT_ROOT);
  } else {
    // Full access binds `/` writable, so only a deeper mount can still hold a line read-only:
    // the read-only roots apply in full mode too, mounting after it and shadowing it on
    // exactly the paths they name.
    for (const linux of readonly) args.push("--ro-bind", linux, linux);
  }
  for (const target of policy.maskPaths ?? []) {
    const kind = host.kind(target);
    const linux = toLinuxPath(target, host.distro);
    if (kind === null || linux === null) continue;
    if (kind === "dir") args.push("--tmpfs", linux);
    else args.push("--ro-bind", "/dev/null", linux);
  }
  return args;
}

/**
 * The directories a confined command may start in: a cwd outside every one of them does not
 * exist inside the sandbox, and bwrap refuses a `--chdir` there.
 */
export function chdirRoots(policy: SandboxPolicy, host: ProfileHost): string[] {
  if (policy.mode === "danger-full-access") return ["/"];
  if (host.exposeWindowsDrives) return host.drives.map((d) => `${MOUNT_ROOT}/${d}`);
  const workspace = toLinuxPath(policy.workspaceRoot, host.distro);
  return workspace === null ? [] : [workspace];
}

/** Whether a Linux path is one of the roots or inside one. */
export function within(linuxPath: string, roots: readonly string[]): boolean {
  return roots.some(
    (root) => root === "/" || linuxPath === root || linuxPath.startsWith(`${root}/`),
  );
}

/** A line WSL itself writes to stderr before the command runs, which is not the command's. */
export function isWslNotice(line: string): boolean {
  return /^wsl: /i.test(line) && /(proxy|localhost|代理)/i.test(line);
}
