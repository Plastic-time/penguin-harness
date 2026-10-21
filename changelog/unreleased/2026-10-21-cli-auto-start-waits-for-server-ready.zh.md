# CLI 自动起服会等过「启动中」窗口，也不再无声留下服务进程

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `cli`

[English](2026-10-21-cli-auto-start-waits-for-server-ready.md)

`penguin` 命令找不到正在运行的服务器时会自动拉起一个，并在此前于数据根的锁一出现就发出请求——但服务端在仍在绑定时就写入该锁，并在 App 构建完成前对一切请求回答 503 "penguin-server is starting"。命令因此以一句裸的 `Server error 503 (http_error)` 失败，并把刚拉起、无人接管的服务进程留在后台。

## 细节

- **自动起服从等锁改为等就绪。** 锁出现后，CLI 会轮询到服务器的应答不再是启动 503 为止——鉴权中间件回 401 已足以证明 App 就绪、本轮启动的 api-token 已落盘。
- **一直起不来的服务会被再次停掉。** 本次调用拉起的服务在报错前先被回收（SIGTERM、有界等待、然后 SIGKILL）；错误信息带地址、服务自己的最后一句话与日志路径。并发 CLI 抢赢拉起竞争的服务不会被碰——错误只说明它在哪、如何停止。
- **自动起服的横幅写明停止方式。** `Started a local server at … (log: …)` 之后接着说明它会为后续命令保持运行，并给出 `penguin server stop`。
- **服务端的两种明文 503 渲染为可操作的信息。** 请求中途撞上 "penguin-server is starting" 或 "penguin-server has no running platform: …" 此前会显示为裸的 `Server error 503 (http_error)`；现在分别给出下一步（稍候重试，或先恢复平台）。JSON 503 仍按服务端自己的错误码渲染。
