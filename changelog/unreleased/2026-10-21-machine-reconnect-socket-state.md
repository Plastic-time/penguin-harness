# A machine back over a new connection dials its API socket again, and Retry takes the machine's own id

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1279](https://github.com/Prism-Shadow/penguin-harness/pull/1279)

[中文版](2026-10-21-machine-reconnect-socket-state.zh.md)

Two readings the machines round took after a disconnect-and-recovery, both about a machine that was back and running:

- The detail dialog's **API socket** row kept the OLD session's reading — “失败 · 13 分钟前 · the socket closed” — beside a “上次检查 刚刚” that said the machine was fine, and stayed that way until some stream happened to ask. A socket fact is only written by a dial, and the socket that rode the old ssh session was gone with it; nothing dialled again. A connect that replaces the connection now asks for one dial over the new session — only where a socket was ever dialled, so a machine nobody has streamed from is still not measured on its connect — and the row says what the new session's own socket is doing.
- `POST /api/projects/:projectId/machines/:id/reconnect` answered a connected machine addressed by its OWN id — the 机器 ID the dialog offers to copy, the addressing the proxy's routes take — with `404 unknown_machine`, because it matched only the ssh address (`ssh:<alias>`, the list's `id`). Retry resolves either name; a machine that is up answers 200 starting nothing, and a machine that is down begins its streak.

## Details

- `MachinesEffects.redialSocket` is the new seam: the service knows when a machine came back over a new session (the one place every way of connecting lands — a job, a Retry, the automatic streak), and the dial itself belongs to the proxy generation's socket cache, injected the same way the `socketFact` reader is. The platform's wiring builds the target with the service's own `proxyTarget` and hands it to `MachineSockets.socketFor`, which drops a cached socket from the replaced session and writes the fresh fact (dialling → connected, or a failure with the real, current reason).
- `retryReconnect` resolves the name it was given through the repo's by-own-id rows before matching the list, so `ssh:<alias>` and the machine's own id reach the same machine and the same streak, job and reconnect state; an id naming nothing is still the 404 it was.
- The refusal codes and the page's own Retry are unchanged: the page sends the list's `id` as before, a job on the machine still answers `job_running`, a machine not kept connected still `not_kept_connected`.
