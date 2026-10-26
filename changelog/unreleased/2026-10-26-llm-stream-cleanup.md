# Close upstream generation streams when consumption ends

Date: 2026-10-26
Type: Fixed
Scope: core
PR: [#1354](https://github.com/Prism-Shadow/penguin-harness/pull/1354)

[中文](./2026-10-26-llm-stream-cleanup.zh.md)

Leaving a `GenerativeModel.streamGenerate()` iterator before completion now cancels the upstream request. Upstream iterators are also closed after completion, interruption, and errors, without waiting on unresponsive cleanup.
