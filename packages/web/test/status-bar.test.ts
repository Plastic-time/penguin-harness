/** @vitest-environment jsdom */
/**
 * The status bar's own strip of chrome (components/layout/status-bar.tsx): what it shows and
 * what its clicks report. The wired half — polling, storage, the route's opened/marks
 * bookkeeping, navigation — is thin glue over api/endpoints and lib/status-bar-model, whose
 * counting and marking rules are driven directly in status-bar-model.test.ts; these suites
 * hold the presentational half to its side of that seam, rendering it with props alone:
 *
 * - The machine on the left — the CPU with its measuring read while the first sample window
 *   is still open, memory as `used / total GB` — and the user's three labeled fields on the
 *   right: company and workdir (each its "—" when nothing is open to name), then the counts
 *   in the ticket's own `session: ${running} / ${all}` shape.
 * - `all` is the harness's total minus what this browser closed out of the list, never below
 *   zero — and a closed row is gone from the list as well, while `running` is untouched by
 *   the x: a removal closes the Session, it does not stop it.
 * - The counts button reports the list's toggle (the open state stays the shell's); a row
 *   click opens that Session, a row's x removes that row alone, and an opened Session that
 *   went idle carries its one-time 「已空闲」 badge — on its row and nowhere else.
 * - A row whose title was never generated keeps its fallback name; rows older than what the
 *   poll listed are counted in a footnote; an empty harness says so rather than nothing.
 */
import { createElement as h } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { HarnessStatusResponse, HarnessStatusSession } from "@prismshadow/penguin-server/api";
import { StatusBarView } from "../src/components/layout/status-bar";
import { S } from "../src/lib/strings";
import { button, click, hasButton, mount, unmountAll } from "./helpers/dom";

const GB = 1024 ** 3;
type Spy = ReturnType<typeof vi.fn>;

/** One harness-wide row, as the status poll would send it. */
function row(sessionId: string, over: Partial<HarnessStatusSession> = {}): HarnessStatusSession {
  return {
    sessionId,
    projectId: "proj",
    agentId: "helper",
    title: null,
    workspace: "/srv/app",
    client: "web",
    status: "idle",
    lastActiveAt: "2026-10-22T01:00:00Z",
    ...over,
  };
}

/** The poll these suites render: two of four Sessions running, three rows in the list. */
const poll: HarnessStatusResponse = {
  running: 2,
  total: 4,
  sessions: [
    row("s1", { title: "Deploy check", status: "running" }),
    row("s2", { title: "Handbook pass", status: "running", client: "cli" }),
    row("s3", { client: "cli" }),
  ],
  system: { cpuPercent: 37, memoryUsedBytes: 6.5 * GB, memoryTotalBytes: 16 * GB },
};

afterEach(unmountAll);

/** Three spies, one per callback the bar reports through. */
function spies(): { onListOpen: Spy; onOpenSession: Spy; onRemove: Spy } {
  return { onListOpen: vi.fn(), onOpenSession: vi.fn(), onRemove: vi.fn() };
}

/** The view with these suites' defaults; every field a test cares to change is an override. */
function view(
  s: { onListOpen: Spy; onOpenSession: Spy; onRemove: Spy },
  over: {
    data?: HarnessStatusResponse;
    companyName?: string | null;
    workdir?: string | null;
    marks?: ReadonlySet<string>;
    closed?: ReadonlySet<string>;
    listOpen?: boolean;
  } = {},
) {
  const {
    data = poll,
    companyName = "Penguin",
    workdir = "/srv/penguin-harness",
    marks = new Set<string>(),
    closed = new Set<string>(),
    listOpen = false,
  } = over;
  return h(StatusBarView, {
    data,
    companyName,
    workdir,
    marks,
    closed,
    listOpen,
    onListOpen: s.onListOpen,
    onOpenSession: s.onOpenSession,
    onRemove: s.onRemove,
  });
}

/** Mounts the view; rerendering with the same helper is how the shell flips its open state. */
const bar = (s: ReturnType<typeof spies>, over: Parameters<typeof view>[1] = {}) =>
  mount(view(s, over));

/** A row's element, found by its accessible name — the div its badge and its x sit in. */
function rowOf(name: string): HTMLElement {
  return button(name).closest("div")!;
}

it("shows the machine on the left and the user's three fields on the right", async () => {
  const s = spies();
  await bar(s);
  const text = document.body.textContent ?? "";
  expect(text).toContain("CPU 37%");
  expect(text).toContain("内存 6.5 / 16.0 GB");
  expect(text).toContain("company: Penguin");
  expect(text).toContain("workdir: penguin-harness");
  expect(button("session: 2 / 4")).toBeInstanceOf(HTMLButtonElement);
});

it("shows measuring until the CPU's first window closes, and — for fields with nothing to name", async () => {
  const s = spies();
  await bar(s, {
    data: { ...poll, system: { ...poll.system, cpuPercent: null } },
    companyName: null,
    workdir: null,
  });
  const text = document.body.textContent ?? "";
  expect(text).toContain(`CPU ${S.statusBar.measuring}`);
  expect(text).toContain(`${S.statusBar.companyLabel}: —`);
  expect(text).toContain(`${S.statusBar.workdirLabel}: —`);
});

it("subtracts the closed from the harness's total, never below zero", async () => {
  const s = spies();
  const { rerender } = await bar(s, { closed: new Set(["s1"]) });
  expect(button("session: 2 / 3")).toBeInstanceOf(HTMLButtonElement); // the x cost the total one
  // A closed id can outlive its row (the server deleted it since); the count stops at zero.
  await rerender(view(s, { closed: new Set(["s1", "s2", "s3", "s4", "gone"]) }));
  expect(button("session: 2 / 0")).toBeInstanceOf(HTMLButtonElement);
});

it("reports the list's toggle from the counts button", async () => {
  const s = spies();
  const { rerender } = await bar(s);
  expect(document.body.textContent).not.toContain(S.statusBar.listTitle); // closed: no list yet
  await click(button("session: 2 / 4"));
  expect(s.onListOpen).toHaveBeenCalledExactlyOnceWith(true);
  await rerender(view(s, { listOpen: true })); // the shell flipped its state; the bar follows
  const text = document.body.textContent ?? "";
  expect(text).toContain(S.statusBar.listTitle);
  expect(text).toContain(S.statusBar.olderHidden(1)); // total 4, the poll listed three rows
  await click(button("session: 2 / 4"));
  expect(s.onListOpen).toHaveBeenLastCalledWith(false);
});

it("opens a Session from its row and removes it from its own x", async () => {
  const s = spies();
  await bar(s, { listOpen: true });
  await click(button(`Deploy check · ${S.statusBar.runningLabel}`));
  expect(s.onOpenSession).toHaveBeenCalledExactlyOnceWith("s1");
  // The row whose title was never generated still names itself, and opens like any other.
  await click(button(`${S.company.sessionList.untitledSession} · ${S.statusBar.idleLabel}`));
  expect(s.onOpenSession).toHaveBeenLastCalledWith("s3");
  await click(
    rowOf(`Handbook pass · ${S.statusBar.runningLabel}`).querySelector(
      `button[aria-label="${S.statusBar.remove}"]`,
    )!,
  );
  expect(s.onRemove).toHaveBeenCalledExactlyOnceWith("s2");
  expect(s.onOpenSession).toHaveBeenCalledTimes(2); // the x removed; it did not also open
});

it("carries the one-time idle mark on its row and on no other", async () => {
  const s = spies();
  await bar(s, { listOpen: true, marks: new Set(["s3"]) });
  expect(
    rowOf(`${S.company.sessionList.untitledSession} · ${S.statusBar.idleLabel}`).textContent,
  ).toContain(S.statusBar.markedIdle);
  expect(rowOf(`Deploy check · ${S.statusBar.runningLabel}`).textContent).not.toContain(
    S.statusBar.markedIdle,
  );
});

it("drops a closed row from the list while the count pays for it", async () => {
  const s = spies();
  await bar(s, { listOpen: true, closed: new Set(["s1"]) });
  expect(hasButton(`Deploy check · ${S.statusBar.runningLabel}`)).toBe(false); // closed out
  expect(hasButton(`Handbook pass · ${S.statusBar.runningLabel}`)).toBe(true); // neighbours stay
  expect(button("session: 2 / 3")).toBeInstanceOf(HTMLButtonElement); // and the total paid for it
});

it("says so when the harness holds no Session at all", async () => {
  const s = spies();
  await bar(s, {
    listOpen: true,
    data: {
      running: 0,
      total: 0,
      sessions: [],
      system: { cpuPercent: 0, memoryUsedBytes: 0, memoryTotalBytes: 16 * GB },
    },
  });
  const text = document.body.textContent ?? "";
  expect(button("session: 0 / 0")).toBeInstanceOf(HTMLButtonElement);
  expect(text).toContain(S.statusBar.listEmpty);
  expect(text).not.toContain("更早"); // nothing is hidden: there was nothing to hide
});
