# Keep deleted Project usage cleared

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`

[中文版](2026-10-26-deleted-project-usage.zh.md)

Project deletion cleared its usage history, but a request finishing after the cleanup deadline
could insert new rows for that deleted Project. The usage recorder now checks that the Project
still exists before persisting reported tokens or failed-request rows. This applies to main
Sessions, subagent records and standalone usage such as automatic titles.

Removing only a Session still preserves its reported usage while the Project exists. The change
does not alter the deletion deadline or estimate provider charges.
