# The CLI waits out an auto-started server's "starting" window, and never leaves one behind silently

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `cli`

[中文版](2026-10-21-cli-auto-start-waits-for-server-ready.zh.md)

A `penguin` command that found no running server used to auto-start one and fire its request the moment the data root's lock went live — but the server records that lock while it is still binding, and answers every request with 503 "penguin-server is starting" until its App is built. The command therefore failed with a bare `Server error 503 (http_error)` and left the freshly spawned server running with nothing managing it.

## Details

- **Auto-start now waits for readiness, not just the lock.** After the lock appears, the CLI polls the server until it answers anything other than the starting 503 — the auth middleware's 401 already proves the App is up, and that the boot's api-token is on disk.
- **A boot that never becomes ready is stopped again.** The server this invocation spawned is reaped (SIGTERM, a bounded wait, then SIGKILL) before the error is thrown; the error names the address, the server's own last words, and the log path. A server a concurrent CLI won the spawn race with is not touched — the error says where it is and how to stop it.
- **The auto-start banner says how to stop the server.** `Started a local server at … (log: …)` now continues with the fact that it stays running for later commands, and names `penguin server stop`.
- **The server's two plain-text 503s render as messages, not codes.** Answering "penguin-server is starting" or "penguin-server has no running platform: …" mid-request used to surface as a bare `Server error 503 (http_error)`; each now says what to do (retry in a moment, or restore the platform). A JSON 503 keeps carrying the server's own error code.
