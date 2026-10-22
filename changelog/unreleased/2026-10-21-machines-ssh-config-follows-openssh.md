# The machines page reads the ssh config OpenSSH reads, whatever HOME says

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#1281](https://github.com/Prism-Shadow/penguin-harness/pull/1281)

[中文版](2026-10-21-machines-ssh-config-follows-openssh.zh.md)

The machines page lists the host aliases of the server's `~/.ssh/config`, writes host blocks to it, and hands each alias to ssh exactly as written. OpenSSH reads that file from the account's home as the passwd database gives it and ignores `$HOME`, so on a server whose HOME points elsewhere — an isolated test root, a service with HOME set — the page offered hosts ssh could not resolve, and a host added from the page was written into a file ssh never reads: a machine could be visible in the list and still fail its first install at the `check` step, the alias surfacing as a host name that does not resolve.

## Details

- The page now reads and writes the config OpenSSH itself reads: the passwd home's `~/.ssh/config` on POSIX, while Windows keeps the environment as its basis, its ssh following the profile environment. Where HOME and the passwd home agree — an ordinary desktop — nothing changes.
- `Include` keeps ssh's own split as it was: an `Include` argument takes its `~` from `$HOME` (OpenSSH anchors a bare argument at `~/.ssh` and globs it `GLOB_TILDE`), even though the config file itself comes from the passwd home.
- When the two homes differ, the server says so at startup — one line naming the home ssh reads — so a deployment that set HOME deliberately can see which file the page is listing and writing.
- Unit tests pin the rule (`packages/server/test/machines-ssh-home.test.ts`): the passwd home wins on POSIX wherever it differs from HOME, HOME stands in when the account has no passwd entry, Windows keeps HOME, and the startup sentence appears exactly when the homes differ.
