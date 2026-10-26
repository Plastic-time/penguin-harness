# Count goal usage across compaction logs

Date: 2026-10-26
Type: Fixed
Scope: plugins/goal

[中文](./2026-10-26-goal-compaction-budget.zh.md)

Goal mode now includes usage recorded before a mid-round context compaction when checking its token budget. It reads preceding Trace files back to the current round's input, so completed rounds are not charged again.
