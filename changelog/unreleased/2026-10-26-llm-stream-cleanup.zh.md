# 结束消费时关闭上游生成流

Date: 2026-10-26
Type: Fixed
Scope: core
PR: [#1354](https://github.com/Prism-Shadow/penguin-harness/pull/1354)

[English](./2026-10-26-llm-stream-cleanup.md)

在生成完成前退出 `GenerativeModel.streamGenerate()` 迭代器，现在会取消上游请求。正常完成、中断和出错时也会关闭上游迭代器，且不会等待无响应的清理操作。
