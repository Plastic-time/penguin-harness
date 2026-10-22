/**
 * The harness status bar's one poll, GET /api/harness-status:
 *
 * - A non-admin is refused with 403 `admin_required` — the counts and the list span every
 *   Project and every user's Sessions, so the surface is the admin's alone.
 * - An empty harness answers zero counts, an empty list, and the system shape (memory is a
 *   real pair; CPU is null until a second reading exists).
 * - Every row counts whichever Project or client owns it, the list is newest-activity-first
 *   and capped, and a row no runtime is working in reads idle — so it counts toward
 *   `total` and not toward `running`.
 * - The system sampler's pure half: a utilization delta is a ratio of the two readings
 *   (all-idle 0, all-busy 100, mixed exact, an idle core's zero window is fine), a zero or
 *   backwards delta is null rather than a divide-by-zero, mismatched shapes are null; the
 *   service diffs consecutive readings and serves its cache within the spacing window.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import type { HarnessStatusResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import {
  MIN_SAMPLE_SPACING_MS,
  SystemStatusService,
  computeCpuPercent,
  readMemory,
} from "../src/services/system-status.js";
import type { CpuTimes } from "../src/services/system-status.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("harness status bar (GET /api/harness-status)", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "alice")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  /** A row as the index stores one, with the fields the bar's list reads. */
  const row = (n: number, over: Partial<SessionRow> = {}): SessionRow => ({
    sessionId: `sess-${String(n).padStart(3, "0")}`,
    projectId: over.projectId ?? "p1",
    agentId: "general",
    provider: "custom",
    modelId: "kimi-k3",
    workspace: `/tmp/ws-${n}`,
    approvalMode: "allow-all",
    title: null,
    // Fixed-width minute:second fields, so lexicographic order (what the TEXT column's
    // ORDER BY is) and numeric order agree: row 150 is the newest of the 150.
    lastActiveAt: `2026-10-22T00:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z`,
    createdAt: `2026-10-22T00:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z`,
    ...over,
  });

  it("refuses a non-admin with 403 admin_required", async () => {
    const res = await member.get("/api/harness-status");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("admin_required");
  });

  it("answers zero counts and the system shape on an empty harness", async () => {
    const res = await admin.get("/api/harness-status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as HarnessStatusResponse;
    expect(body.total).toBe(0);
    expect(body.running).toBe(0);
    expect(body.sessions).toEqual([]);
    // Memory is a live pair of the machine running the test; CPU is null on the first
    // reading of the process (no previous reading to take a delta against).
    expect(body.system.memoryTotalBytes).toBeGreaterThan(0);
    expect(body.system.memoryUsedBytes).toBeGreaterThanOrEqual(0);
    expect(body.system.memoryUsedBytes).toBeLessThanOrEqual(body.system.memoryTotalBytes);
    expect(body.system.cpuPercent).toBeNull();
  });

  it("counts every row, lists newest first capped, and idle rows never count as running", async () => {
    // 150 rows across two Projects and three clients, stamped in reverse so row numbers
    // and recency agree; row 150 is the newest.
    for (let n = 150; n >= 1; n--) {
      t.deps.sessionsRepo.insert(
        row(n, {
          projectId: n <= 50 ? "p1" : "p2",
          client: n % 3 === 0 ? "org" : n % 3 === 1 ? "web" : null,
          ...(n === 150 ? { title: "the newest one" } : {}),
        }),
      );
    }
    const res = await admin.get("/api/harness-status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as HarnessStatusResponse;
    expect(body.total).toBe(150);
    // No runtime entry exists for any row, so nothing is running and every row reads idle.
    expect(body.running).toBe(0);
    expect(body.sessions).toHaveLength(100);
    const [first] = body.sessions;
    expect(first?.sessionId).toBe("sess-150");
    expect(first?.title).toBe("the newest one");
    expect(first?.status).toBe("idle");
    // The row's own fields ride along, whichever Project or client owns it.
    expect(first?.projectId).toBe("p2");
    expect(body.sessions[99]?.sessionId).toBe("sess-051");
    const orgRow = body.sessions.find((s) => s.sessionId === "sess-147");
    expect(orgRow?.client).toBe("org");
    const legacyRow = body.sessions.find((s) => s.sessionId === "sess-146");
    expect(legacyRow?.client).toBeNull();
  });
});

describe("system status sampler (services/system-status.ts)", () => {
  /** One core's counters. */
  const core = (over: Partial<CpuTimes> = {}): CpuTimes => ({
    user: 100,
    nice: 0,
    sys: 100,
    idle: 100,
    irq: 0,
    ...over,
  });

  it("a utilization delta is a ratio of the two readings", () => {
    // All idle: 0. All busy: 100. Half busy: 50, one decimal. Two cores, one busy all
    // window and one idle all window: half the machine, and the idle core's zero-busy
    // window is a reading, not an error.
    expect(computeCpuPercent([core()], [core({ idle: 200 })])).toBe(0);
    expect(computeCpuPercent([core()], [core({ user: 200, idle: 100 })])).toBe(100);
    expect(computeCpuPercent([core()], [core({ user: 150, idle: 150 })])).toBe(50);
    expect(computeCpuPercent([core(), core()], [core({ user: 300 }), core({ idle: 300 })])).toBe(
      50,
    );
  });

  it("a zero, backwards or mismatched delta is null, never NaN", () => {
    expect(computeCpuPercent([core()], [core()])).toBeNull();
    expect(computeCpuPercent([core({ idle: 200 })], [core({ idle: 100 })])).toBeNull();
    expect(computeCpuPercent([], [])).toBeNull();
    expect(computeCpuPercent([core()], [core(), core()])).toBeNull();
  });

  it("readMemory answers the machine's live pair", () => {
    const mem = readMemory();
    expect(mem.memoryTotalBytes).toBeGreaterThan(0);
    expect(mem.memoryUsedBytes).toBeGreaterThanOrEqual(0);
    expect(mem.memoryUsedBytes).toBeLessThanOrEqual(mem.memoryTotalBytes);
  });

  it("the service diffs consecutive readings and serves its cache inside the spacing window", () => {
    const GB = 1024 ** 3;
    const service = new SystemStatusService();
    // Controlled readings and memory, so every number is the test's own: the first read has
    // no predecessor to diff against, the second is half-busy since the first, and the third
    // never reads the counters at all.
    const reading = (user: number, idle: number): os.CpuInfo => ({
      model: "",
      speed: 0,
      times: { user, nice: 0, sys: 100, idle, irq: 0 },
    });
    const cpus = vi
      .spyOn(os, "cpus")
      .mockReturnValueOnce([reading(100, 100)])
      .mockReturnValueOnce([reading(200, 200)]);
    const totalmem = vi.spyOn(os, "totalmem").mockReturnValue(16 * GB);
    const freemem = vi.spyOn(os, "freemem").mockReturnValue(4 * GB);
    try {
      const first = service.read();
      expect(first.cpuPercent).toBeNull(); // nothing to diff against yet
      expect(first.memoryUsedBytes).toBe(12 * GB);
      expect(first.memoryTotalBytes).toBe(16 * GB);
      const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + MIN_SAMPLE_SPACING_MS + 1);
      try {
        const second = service.read();
        expect(second.cpuPercent).toBe(50); // 100 busy of the 200 ticks since the first
        now.mockRestore();
        const third = service.read(); // back on the real clock: still inside the window
        expect(third).toBe(second); // the cached answer — the very object, reference and all
      } finally {
        now.mockRestore();
      }
    } finally {
      cpus.mockRestore();
      totalmem.mockRestore();
      freemem.mockRestore();
    }
  });
});
