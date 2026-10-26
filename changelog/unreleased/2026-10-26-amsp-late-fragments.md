# Skip delayed fragments already included in a history snapshot

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `amsp`

[中文版](2026-10-26-amsp-late-fragments.zh.md)

Fixed `SessionReader` delivering text and tool-call fragments again when they arrived after the history snapshot that already contained them. The snapshot cursor now filters delayed partial records on the live stream and across reconnects. Complete records, newer fragments and records without comparable event IDs continue to be delivered.
