# Count metered requests once after abnormal finishes

Date: 2026-10-26
Type: Fixed
Scope: server

[中文](./2026-10-26-metered-request-count.zh.md)

The Cost Center no longer adds a second request when a model reports token usage and then ends with an abnormal finish reason. Subsequent attempts and concurrent child sessions remain separately counted.
