# 开始移除 Session 时取消子代理请求

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1361](https://github.com/Prism-Shadow/penguin-harness/pull/1361)

[English](2026-10-26-cancel-subagents-on-removal.md)

Session、Agent、Project 删除以及服务器关闭，在等待主 Task 中断收尾前就取消了运行中的子代理。主 Task 收尾缓慢时，这些子代理不再继续完成工具调用并发起下一次模型请求。

环境资源仍在主 Task 结束后按原有顺序释放。普通的 Task 停止操作仍允许后台子代理继续运行。
