/**
 * `penguin server reset-admin-password` through the CLI wiring: the success path's exit code
 * and the two stdout lines, and the unseeded database's exit code and stderr line. The server
 * package's own reset-admin-password suite covers the rescue semantics (hash rotation,
 * session revocation, the live-server refusal); what was missing is the command a human
 * runs — the one that in the wild died as a bare
 * `Cannot read properties of undefined (reading 'DatabaseSync')` on a Node.js without the
 * built-in node:sqlite.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";

const t = getMessages("en");

let stdout: string[];
let stderr: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };
let root: string;
let prevHome: string | undefined;

beforeEach(() => {
  stdout = [];
  stderr = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-reset-admin-"));
  prevHome = process.env.PENGUIN_HOME;
  process.env.PENGUIN_HOME = root;
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  fs.rmSync(root, { recursive: true, force: true });
});

const out = () => stdout.join("");
const err = () => stderr.join("");

/** The admin row a started server leaves behind (seedAdmin), with a changed-then-forgotten password. */
function seedAdmin(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      "INSERT INTO users (user_id, password_hash, is_admin, password_is_initial, display_name, avatar, created_at)" +
        " VALUES ('admin', 'stale-hash', 1, 0, NULL, NULL, '2026-01-01T00:00:00.000Z')",
    ).run();
  } finally {
    db.close();
  }
}

describe("penguin server reset-admin-password", () => {
  it("resets a seeded admin: exit 0, the two stdout lines, the admin back to unclaimed", async () => {
    const dbPath = path.join(root, "web.db");
    // The product itself builds the schema: a first run against an empty database file is
    // the unseeded outcome (and leaves the tables behind — no DDL is mirrored here).
    fs.writeFileSync(dbPath, "");
    expect(await cli(["server", "reset-admin-password"])).toBe(1);
    seedAdmin(dbPath);

    stdout.length = 0;
    stderr.length = 0;
    expect(await cli(["server", "reset-admin-password"])).toBe(0);
    expect(out()).toContain(t.resetPassword.done(root));
    expect(out()).toContain(t.resetPassword.next());
    expect(err()).toBe("");

    const after = new DatabaseSync(dbPath);
    try {
      const admin = after
        .prepare("SELECT password_hash, password_is_initial FROM users WHERE user_id = 'admin'")
        .get() as { password_hash: string; password_is_initial: number };
      // Back to the unclaimed state, under a password nobody holds.
      expect(admin.password_is_initial).toBe(1);
      expect(admin.password_hash).not.toBe("stale-hash");
    } finally {
      after.close();
    }
  });

  it("reports an unseeded database: exit 1 and the stderr line, without inventing an admin", async () => {
    const dbPath = path.join(root, "web.db");
    fs.writeFileSync(dbPath, "");
    expect(await cli(["server", "reset-admin-password"])).toBe(1);
    expect(err()).toContain(t.resetPassword.noAdmin());
    expect(out()).toBe("");
    const db = new DatabaseSync(dbPath);
    try {
      expect(db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});
