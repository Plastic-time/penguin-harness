/**
 * The one accessor for the runtime `node:sqlite` module.
 *
 * Resolved through `process.getBuiltinModule` rather than a static import so bundlers never
 * get a chance to mishandle `node:sqlite` (some tools' builtin lists predate the module),
 * and resolved lazily behind a guard because `getBuiltinModule` answers `undefined` — not
 * an error — on a runtime that predates the module (it first shipped in Node.js 22.5).
 *
 * An unguarded module-scope capture of that `undefined` is the trap this file exists for:
 * nothing fails at load time, and the first database touch then dies as a bare
 * `Cannot read properties of undefined (reading 'DatabaseSync')` — one line, no stack, no
 * hint that the runtime is the problem (a machine's older default `node` is exactly how an
 * offline rescue such as `penguin server reset-admin-password` ends up on one). With the
 * accessor, commands that never touch a database keep working on such a runtime, and every
 * database touch fails with one actionable message instead.
 */
export type NodeSqlite = typeof import("node:sqlite");

let cached: NodeSqlite | undefined;

/** The runtime `node:sqlite` module, or a clear error when the runtime predates it. */
export function nodeSqlite(): NodeSqlite {
  if (cached !== undefined) return cached;
  // `unknown`, not the module's type: the whole point is that this value can be `undefined`.
  const mod: unknown = process.getBuiltinModule("node:sqlite");
  if (mod === undefined) {
    throw new Error(
      `This PenguinHarness build needs the built-in node:sqlite module, which this Node.js ` +
        `(${process.version}) does not provide — it first shipped in Node.js 22.5, and the ` +
        `product requires Node.js >= 24. Start the command with a newer Node.js.`,
    );
  }
  return (cached = mod as NodeSqlite);
}
