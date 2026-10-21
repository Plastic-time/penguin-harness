# `penguin` no longer dies as a bare TypeError on a Node.js without node:sqlite

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `server`, `cli`

[中文版](2026-10-21-server-reset-admin-password-old-node.zh.md)

Running a command that opens the Web database — `penguin server reset-admin-password`, the offline rescue an operator reaches for when the admin password is lost — on a Node.js older than 22.5 (a machine's default `node`, say) died as `Cannot read properties of undefined (reading 'DatabaseSync')`: one line, no stack, and nothing pointing at the actual cause. The database module captured `process.getBuiltinModule("node:sqlite")` — `undefined` on a runtime that predates the builtin — into a module-scope constant at load time, so nothing failed until the first database touch, far from the cause.

## Details

- `node:sqlite` is now resolved lazily behind a guard (`packages/server/src/node-sqlite.ts`). Commands that never touch a database keep working on such a runtime, and every database touch fails with one actionable message instead, naming the running version and the requirement (node:sqlite first shipped in Node.js 22.5; PenguinHarness declares `engines.node >= 24`).
- The browser-import copy path (`sqlite-copy.ts`) had the same unguarded module-scope capture; both call sites now share the one accessor.
- `packages/cli/test` gains the command's success-path coverage (`reset-password.test.ts`): the seeded-admin reset (exit 0, the two stdout lines, the account back to its unclaimed state) and the unseeded-database refusal (exit 1, the stderr line).
