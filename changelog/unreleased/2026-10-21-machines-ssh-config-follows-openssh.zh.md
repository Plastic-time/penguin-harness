# 机器页按 OpenSSH 的口径读 ssh 配置，HOME 指向哪里不再影响

- **日期：** 2026-10-21
- **类型：** fix
- **范围：** `server`、`docs`
- **PR:** [#1281](https://github.com/Prism-Shadow/penguin-harness/pull/1281)

[English](2026-10-21-machines-ssh-config-follows-openssh.md)

机器页列出服务器 `~/.ssh/config` 里的主机别名、往这份配置写主机块、并把每个别名按原样交给 ssh。OpenSSH 读这份文件时按 passwd 数据库里账号的家目录定位、并不看 `$HOME`，所以在 HOME 指向别处的服务器上——隔离的测试根目录、设了 HOME 的服务——页面会列出 ssh 解析不了的主机，从页面添加的主机也写进了 ssh 永远不读的文件：一台机器可以出现在列表里，第一次安装却仍停在 `check` 步骤，别名被当成一个解析不出来的主机名报错。

## 细节

- 页面现在读写的都是 OpenSSH 自己会读的那份配置：POSIX 上是 passwd 家目录的 `~/.ssh/config`；Windows 保持以环境为基准——它的 ssh 跟随 profile 环境变量。HOME 与 passwd 家目录一致时——普通桌面——什么都没变。
- `Include` 照旧保留 ssh 自己的口径：`Include` 参数的 `~` 取自 `$HOME`（OpenSSH 把不带路径的参数锚到 `~/.ssh` 再按 `GLOB_TILDE` 做 glob），哪怕配置文件本身来自 passwd 家目录。
- 两个家目录不一致时，服务器启动时会说一句，指名 ssh 读的是哪一个——刻意设置了 HOME 的部署因此能看到页面列的和写的到底是哪份文件。
- 规则由单元测试钉住（`packages/server/test/machines-ssh-home.test.ts`）：POSIX 上两处不同时以 passwd 家目录为准、账号没有 passwd 条目时回退 HOME、Windows 保持 HOME、启动那句提示恰好在家目录不一致时出现。
