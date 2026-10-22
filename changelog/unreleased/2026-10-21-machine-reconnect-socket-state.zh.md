# 断开又恢复的机器重新拨号它的 API 套接字，重试也认机器自己的 id

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1279](https://github.com/Prism-Shadow/penguin-harness/pull/1279)

[English](2026-10-21-machine-reconnect-socket-state.md)

机器断开又恢复之后，机器轮测到两处读数，都是一台已经回来、正在运行的机器：

- 详情对话框的 **API 套接字** 行停在旧会话的读数——「失败 · 13 分钟前 · the socket closed」——旁边「上次检查 刚刚」说机器好好的，并且一直停到有哪条流恰好再要一次为止。套接字的 fact 只有拨号才写，而骑着旧 ssh 会话的那条套接字已经随它一起没了，没人再拨。现在，替换了连接的那次 connect 会按新会话再拨一次——只在过去拨过套接字的机器上，所以从没人流过的机器仍不在 connect 时被测量——这一行说的就是新会话自己的套接字在做什么。
- `POST /api/projects/:projectId/machines/:id/reconnect` 对按机器自己的 id 寻址的已连接机器回 `404 unknown_machine`——那个 id 正是详情对话框提供复制的「机器 ID」、也是代理各路由采用的寻址——因为它只匹配 ssh 地址（`ssh:<alias>`，列表的 `id`）。重试现在两种名字都认：在线的机器回 200 且不动任何东西，掉线的机器从它自己的重连开始。

## 细节

- `MachinesEffects.redialSocket` 是新的接缝：机器何时经新会话回来由服务知道（所有连上来的路——任务、重试、自动重连——都落在同一处），而拨号本身属于代理那一代的套接字缓存，与 `socketFact` 读取器一样是注入的。平台的接线用服务自己的 `proxyTarget` 构造目标、交给 `MachineSockets.socketFor`——它会丢弃被替换会话上的缓存套接字，并写下新鲜的 fact（拨号中 → 已连接，或者带当前真实原因的失败）。
- `retryReconnect` 先经仓库的按自有 id 行解析拿到的名字、再匹配列表，`ssh:<alias>` 与机器自己的 id 到达同一台机器、同一条重连状态与任务；一个不指任何机器的 id 仍是从前的 404。
- 拒绝码与页面自己的重试不变：页面仍发列表的 `id`，机器上有任务仍回 `job_running`，不被保持连接的机器仍回 `not_kept_connected`。
