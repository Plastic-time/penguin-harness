# A machine's forward rides one reconnect — bounded, merged, and said in the log

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1275](https://github.com/Prism-Shadow/penguin-harness/pull/1275)

[中文版](2026-10-21-machine-forward-reconnect.zh.md)

A request forwarded to a machine (`/server/<id>/api/…`) rides the one ssh session held to it. When that session dropped, the dial behind the request opened a session of its own — at once, outside every backoff — so a page's burst of requests spawned connection attempts of their own, and the requests that arrived while ssh was still authenticating failed with `connect ECONNREFUSED` on a port nothing had bound, while the machine still read as connected. Nothing retried, and nothing said what it was doing.

## Details

- **A session is up only once a command has completed over it.** ssh binds its `-D` SOCKS listener after the TCP connection, the handshake and authentication; `ExitOnForwardFailure` makes a child that could not bind exit before its first command runs. The moment the first framed command's mark comes back is therefore the moment the SOCKS port exists — and that, not the spawn, is when a held session counts as up and its listeners are told. Before, a child counted as up at spawn: that window is where a dial met `ECONNREFUSED` while the page said the machine was connected.
- **A dial waits for the held session's own reconnect, and every dial of the window merges into it.** `MachineConnection.dial()` no longer opens a transient session of its own: it waits — bounded, 8 s — for the transport's scheduled reopen, and all concurrent dials settle on that same one, so however many requests a page makes inside a reconnect window, none of them opens a second ssh. A SOCKS dial that meets a dead listener rides one reconnect and is tried exactly once more; after that the failure is the caller's. A dial to a machine nothing is held to answers at once and opens nothing.
- **The reopen itself is bounded and said aloud.** Every attempt is a line in the server's log — which attempt it is, the wait it used, the cap — and its failure is a line too. After eight attempts in a row that never came up, the transport stops reopening on its own: the machines page's reconnecting streak (which has its own Retry) and the next connect start another, and a stopped streak is what the page then shows.
- **A forwarded request waits out a reconnect instead of failing into it.** The proxy's target lookup waits up to ten seconds for a held session that is on its way back — every waiting request joins the same reconnect — and skips the wait when the bring-back streak has stopped or is waiting for a saved password, answering the honest `not_connected` at once. A network blip costs a request a moment; a machine that is really down answers within the wait with the reason, next to the page's own account of its streak.
