# Backoff for failed roadmaps reads

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-21-client-backoff-on-failed-roadmaps-reads.zh.md)

Failed reads of an organization's roadmaps no longer re-pull at once. When the link to the organization's machine died, every surface that reads roadmaps — the sidebar's list on each navigation, the channel page's lookup of its roadmap, the room column's detail poll and the PR graph's capsules — failed and was asked again by the next navigation or tick, turning one socket disconnect into thousands of 1 ms 502s a minute against `…/organizations/<org>/roadmaps`. A failed read now holds one shared ladder per organization (2 s doubling to a 30 s ceiling, the shape the proposals listing already uses), a read that would start inside the wait is skipped, the one scheduled retry is what heals the page, the server's own `Retry-After` is never waited less than, and a success anywhere opens the gate for every surface at once. The room column's poll keeps its fixed 10 s beat on a healthy link and rides the ladder only while reads fail.
