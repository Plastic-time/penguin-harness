# The schedule form's refusals, said in the UI's language under the field

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [#1276](https://github.com/Prism-Shadow/penguin-harness/pull/1276)

[中文版](2026-10-21-schedules-form-validation-language.zh.md)

The "New scheduled task" dialog's three validation refusals — a name the store cannot file, a malformed period, an end time at or before the start — reached a Chinese UI as the server's English sentences, while the duplicate-name refusal beside them was already Chinese. The server now sends each of the three with its own error code (`schedule_invalid_name`, `schedule_invalid_period`, `schedule_invalid_window`), the web maps the codes to its dictionaries, and the form itself says them under the corresponding field while the value is typed, holding Create until it fits — the same sentence whether the form or the server is the one refusing, and English in the English UI as before.

## Details

- The name rule mirrors core's `isValidId` (a schedule's name is its file name), the period rule the server's `parsePeriod` (digits then `m`/`h`/`d`, zero refused), and the window the server's `end_at` comparison — measured on the trimmed values the form sends.
- The 5-minute period floor and the other server-only rules keep their sentence as before; a refusal the form does not pre-empt still lands under the form, now carried by the code.
