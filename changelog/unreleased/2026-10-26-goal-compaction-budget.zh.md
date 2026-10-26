# 跨压缩日志统计目标模式用量

Date: 2026-10-26
Type: Fixed
Scope: plugins/goal

[English](./2026-10-26-goal-compaction-budget.md)

目标模式检查 token 预算时，现在会计入本轮上下文压缩前的用量。统计沿之前的 Trace 文件回溯到本轮输入，不会重复计入已完成轮次的消耗。
