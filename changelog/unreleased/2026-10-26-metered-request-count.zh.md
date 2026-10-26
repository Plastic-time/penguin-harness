# 异常结束的已计量请求只统计一次

Date: 2026-10-26
Type: Fixed
Scope: server

[English](./2026-10-26-metered-request-count.md)

模型已报告 token 用量、随后以异常原因结束时，成本中心不再额外增加一次请求。后续重试和并发子会话仍分别计数。
