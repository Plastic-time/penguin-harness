# 在没有 node:sqlite 的 Node.js 上，`penguin` 不再以一句裸 TypeError 崩溃

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `server`, `cli`

[English](2026-10-21-server-reset-admin-password-old-node.md)

在早于 22.5 的 Node.js（比如某台机器的默认 `node`）上运行要打开 Web 数据库的命令——管理员口令丢失时离线救急的 `penguin server reset-admin-password` 正是那个入口——会以 `Cannot read properties of undefined (reading 'DatabaseSync')` 崩溃：一行、无栈、没有任何指向真实原因的线索。数据库模块在加载时把 `process.getBuiltinModule("node:sqlite")`（在这种运行时上为 undefined）捕获进了模块级常量，于是一路无事，直到第一次碰数据库才在远离病因的地方炸开。

## Details

- node:sqlite 改为经由带守卫的惰性访问器解析（`packages/server/src/node-sqlite.ts`）：不碰数据库的命令在这种运行时上照常工作，碰数据库的都会得到一条可行动的错误，写明当前版本与要求（node:sqlite 自 Node.js 22.5 起提供；PenguinHarness 声明 `engines.node >= 24`）。
- 浏览器导入的副本读取路径（`sqlite-copy.ts`）有同样的无守卫模块级捕获；两处取用现在共用这一个访问器。
- `packages/cli/test` 新增该命令的成功路径覆盖（`reset-password.test.ts`）：已种子管理员的复位（退出码 0、两行 stdout、账号回到未认领态）与未种子数据库的拒绝（退出码 1、stderr 一行）。
