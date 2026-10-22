# A status bar across the bottom of the Web App

- **Date:** 2026-10-22
- **Type:** feat
- **Scope:** `web`, `server`

[中文版](2026-10-22-webui-bottom-status-bar.zh.md)

The Web App's shell now ends in a status bar. Its left side reads the machine the server runs
on — whole-machine CPU utilization and used/total memory, nothing else (no disk), refreshed by
one request every 10 seconds and paused while the tab is hidden. Its right side names the
company currently open and the workdir of the session you are on, then the harness-wide session
counts `session: ${running} / ${all}`: over every Project and every creating client the harness
holds, not just the Project the sidebar lists.

## Details

- One poll (`GET /api/harness-status`, admin-only — a non-admin gets 403 and the bar never
  renders) carries everything the bar repaints with: the counts, the newest 100 sessions with
  their live run status, and the machine's CPU and memory.
- CPU utilization is a server-side ratio of two `os.cpus()` readings taken on demand; the first
  read of a process answers null and the bar shows a placeholder, and reads closer than 2
  seconds apart serve a cached answer — no background timer, no dense polling.
- `all` counts every session the harness holds minus the ones this browser removed from the
  list: a row's x removes it from the list and the count goes down by one. Removal is the
  browser's own bookkeeping — the session itself is untouched.
- A session you have opened that a poll first reads idle after a running one carries a one-time
  "Went idle" mark on its row, until you open it again.
- Clicking the counts opens the list: a row jumps to its session, its x removes it, and
  sessions older than the newest 100 are summarized as a count at the list's foot.
- This round the bar is a fixed part of the Web App's layout; the seam is one component, so a
  plugin-provided bar can follow later.
