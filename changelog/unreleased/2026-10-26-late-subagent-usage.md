# Preserve completed child usage during Session removal

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1363](https://github.com/Prism-Shadow/penguin-harness/pull/1363)

[中文版](2026-10-26-late-subagent-usage.zh.md)

A background subagent can receive a completed provider response before its final Trace write
finishes. Deleting the parent Session during that write used to discard the ensuing token
usage, leaving the Project's usage totals short of the tokens the provider reported.

Environment disposal now allows Session metadata and request accounting records to finish
forwarding. The server records them against the original parent Session and child model after
the runtime is removed, without publishing late child output to the removed Session's stream.
Deleting an entire Project still discards its usage history, including records arriving after
a Session was removed earlier.

This preserves reported usage; it does not estimate unreported tokens or establish a provider's
actual charge.
