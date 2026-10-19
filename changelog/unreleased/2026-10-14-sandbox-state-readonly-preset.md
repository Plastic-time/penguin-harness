# A sandbox preset that keeps the agent's own state read-only

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`

[中文版](2026-10-14-sandbox-state-readonly-preset.zh.md)

A sandboxed session can write its Workspace, yet everything a command runs has also been able to write the agent's own files: its memory, its instructions, its skills, its scheduled tasks. The new built-in preset **Workspace Write, State Read-Only** closes that. The workspace stays writable and the network stays open, but the agent's whole per-agent root is held read-only to the session's commands, hooks and stdio MCP Servers — readable, so the agent it configures can still be inspected, but not writable. The session's scratchpad, a deeper child of that root, stays writable, so plans, goals and attachments keep working.

## Details

- The sandbox vocabulary gains a fourth policy value, `stateReadonly`, and a new `readonly-roots` dimension: a backend that does not declare the dimension is never routed such a policy, and a policy no mounted backend can serve refuses to run — fail-closed, like every dimension. Ignoring a read-only root would widen the sandbox, the one direction the interface forbids, which is why the dimension is declared instead of inferred from the mode.
- The read-only root is the agent's whole per-agent root, named at every spawn seam by the core that owns the state's layout. It is never created by the sandbox: a root missing on disk refuses the spawn rather than faking the protection by making the directory it would then claim to hold read-only.
- The settings card's preset table gains a **State read-only** column, and the new built-in preset is pinned and selectable like the others. Where no mounted backend can enforce the dimension the column shows as unavailable, the same face the other limits use. Only an administrator can give a session a writable agent state when the server's default keeps it read-only; the session permission pick carries the value like the mode and the network.
- The bubblewrap backend mounts every path bind — the temp tmpfs, the writable roots, the read-only roots — in one order: deeper paths mount later, and at equal depth read-only mounts after writable ones. That single order is what makes the root hold wherever the deployment put it: a state root inside the Workspace (or inside the temp area) mounts after the writable bind covering it and shadows it, while the scratchpad inside the state root mounts later still and stays writable. Masks keep mounting last.
- The WSL backend gets the same order inside its distro, and translates the state root to its distro path. A read-only root with no spelling inside the distro (another distro's files, a network share) is an error rather than a skip: dropping it would widen the sandbox.
- The sandbox-dsh backend extends its Landlock rung to serve the dimension: Landlock is an allow-list, so a read-only root needs no new rule — nothing grants a write there — and the same rung now also splices the policy's writable roots into the launcher's own grant flags, which makes the session scratchpad writable under Landlock (previously disclosed as a limitation of that rung). A read-only root that falls inside a writable grant cannot be expressed — Landlock has no subtractive rule — and refuses the spawn instead of lying. The other rungs (bubblewrap, Seatbelt, the Windows ACL runner) still confine file writes only and stay off the new dimension's routes.
