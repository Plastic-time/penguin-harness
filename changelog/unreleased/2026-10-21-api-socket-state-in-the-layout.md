# The API socket's reconnect and give-up are said in the layout, quietly

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1275](https://github.com/Prism-Shadow/penguin-harness/pull/1275)

[中文版](2026-10-21-api-socket-state-in-the-layout.zh.md)

The page's one API socket carries every live thing a tab has — this server's events, the machines aggregate, each open conversation — and when it kept failing, the page said nothing at all: calls quietly went back to fetch, streams parked, and the tab sat there looking normal while it followed nothing. Three handshakes in a row that never opened ended it for good, still without a word anywhere.

The socket's situation is now a reading of its own — `health()` and `onHealth()` on `ApiSocket`, additive, with the retry and backoff behaviour untouched — and the app layout says the two states that used to be that silence as one small floating pill over the top of whatever page is showing:

- **Reconnecting** — a socket that was up (or a page whose handshakes have already failed) is being brought back: a neutral pill with the spinner, "Connection lost — reconnecting…". A blip that mends itself disappears without having moved a single line of the page it interrupted.
- **Given up** — the third handshake never opened against a server that kept answering `/api/me`: the pill turns the attention tone, "Live updates stopped", with the one action that state leaves — Reload — because the calls still work over HTTP while the streams wait for exactly that.

A page's first connect says nothing: nothing has been lost yet, and a normal load must not flash. The wording follows the interface language; the give-up line is an `alert`, a reconnect in progress only a `status`.
