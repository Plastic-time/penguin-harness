/** @vitest-environment jsdom */
/**
 * The status bar's own strip of chrome (components/layout/status-bar.tsx): what it shows and
 * what its clicks report. The wired half — polling, storage, the route's opened/marks
 * bookkeeping, the machine-side company fallback, navigation — is thin glue over
 * api/endpoints and lib/status-bar-model, whose counting and marking rules are driven
 * directly in status-bar-model.test.ts; these suites hold the presentational half to its
 * side of that seam, rendering it with props alone:
 *
 * - The machine on the left — the CPU with its measuring read while the first sample window
 *   is still open, memory as `used / total GB`, and "—" for both when the machine being
 *   read did not answer the poll — and the user's three labeled fields on the right:
 *   company and workdir (each its "—" when nothing is open to name), then the counts in the
 *   ticket's own `session: ${active} / ${viewed}` shape.
 * - `viewed` is the opened set the parent hands down; a removal (the x) is reported and the
 *   next render with the smaller set shows the count that paid for it, while `active` is
 *   untouched by the x: a removal stops the keeping, it does not stop the Session.
 * - The counts button reports the list's toggle (the open state stays the shell's); a row
 *   click opens that Session, a row's x removes that row alone, and an opened Session that
 *   went idle carries its one-time 「已空闲」 badge — on its row and nowhere else.
 * - A row whose title was never generated keeps its fallback name; an empty list says so
 *   rather than nothing.
 */
import { createElement as h } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  HarnessStatusSession,
  HarnessStatusSystem,
} from "@prismshadow/penguin-server/api";
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
    machineId: null,
    ...over,
  };
}

/** The poll these suites render: two of three opened Sessions running. */
const rows: HarnessStatusSession[] = [
  row("s1", { title: "Deploy check", status: "running" }),
  row("s2", { title: "Handbook pass", status: "running", client: "cli" }),
  row("s3", { client: "cli" }),
];

const system: HarnessStatusSystem = { cpuPercent: 37, memoryUsedBytes: 6.5 * GB, memoryTotalBytes: 16 * GB };

afterEach(unmountAll);

/** Three spies, one per callback the bar reports through. */
function spies(): { onListOpen: Spy; onOpenSession: Spy; onRemove: Spy } {
  return { onListOpen: vi.fn(), onOpenSession: vi.fn(), onRemove: vi.fn() };
}

/** The view with these suites' defaults; every field a test cares to change is an override. */
function view(
  s: { onListOpen: Spy; onOpenSession: Spy; onRemove: Spy },
  over: {
    running?: number;
    rows?: HarnessStatusSession[];
    system?: HarnessStatusSystem | null;
    systemAlias?: string | null;
    companyName?: string | null;
    workdir?: string | null;
    marks?: ReadonlySet<string>;
    opened?: ReadonlySet<string>;
    listOpen?: boolean;
  } = {},
) {
  const {
    running = 2,
    rows: list = rows,
    system: machine = system,
    systemAlias = null,
    companyName = "Penguin",
    workdir = "/srv/penguin-harness",
    marks = new Set<string>(),
    opened = new Set(["s1", "s2", "s3"]),
    listOpen = false,
  } = over;
  return h(StatusBarView, {
    running,
    rows: list,
    system: machine,
    systemAlias,
    companyName,
    workdir,
    marks,
    opened,
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

/** The tooltip of the first element carrying one, as the bar's left side does. */
const tooltip = (): string =>
  document.querySelector<HTMLElement>("[data-tooltip]")?.getAttribute("data-tooltip") ?? "";

it("shows the machine on the left and the user's three fields on the right", async () => {
  const s = spies();
  await bar(s);
  const text = document.body.textContent ?? "";
  expect(text).toContain("CPU 37%");
  expect(text).toContain("内存 6.5 / 16.0 GB");
  expect(text).toContain("company: Penguin");
  expect(text).toContain("workdir: penguin-harness");
  expect(button("session: 2 / 3")).toBeInstanceOf(HTMLButtonElement);
});

it("shows measuring until the CPU's first window closes, and — for fields with nothing to name", async () => {
  const s = spies();
  await bar(s, {
    system: { ...system, cpuPercent: null },
    companyName: null,
    workdir: null,
  });
  const text = document.body.textContent ?? "";
  expect(text).toContain(`CPU ${S.statusBar.measuring}`);
  expect(text).toContain(`${S.statusBar.companyLabel}: —`);
  expect(text).toContain(`${S.statusBar.workdirLabel}: —`);
});

it("names the machine it reads in the tooltips", async () => {
  const s = spies();
  await bar(s, {
    system: { cpuPercent: 12.5, memoryUsedBytes: 1 * GB, memoryTotalBytes: 4 * GB },
    systemAlias: "kamiya-prism",
  });
  const text = document.body.textContent ?? "";
  expect(text).toContain("CPU 12.5%");
  expect(text).toContain("内存 1.0 / 4.0 GB");
  expect(tooltip()).toContain("kamiya-prism");
});

// The silent poll is its own `it`: a second mount in the same one would leave the first
// view's tooltip first in the document, and the helper reads that one.
it("says — for both when the machine being read did not answer the poll", async () => {
  const s = spies();
  await bar(s, { system: null, systemAlias: "kamiya-prism" });
  const text = document.body.textContent ?? "";
  expect(text).toContain("CPU —");
  expect(text).toContain("内存 —");
  expect(tooltip()).toContain("kamiya-prism");
});

it("reports the list's toggle from the counts button", async () => {
  const s = spies();
  const { rerender } = await bar(s);
  expect(document.body.textContent).not.toContain(S.statusBar.listTitle); // closed: no list yet
  await click(button("session: 2 / 3"));
  expect(s.onListOpen).toHaveBeenCalledExactlyOnceWith(true);
  await rerender(view(s, { listOpen: true })); // the shell flipped its state; the bar follows
  expect(document.body.textContent).toContain(S.statusBar.listTitle);
  await click(button("session: 2 / 3"));
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

it("the x lowers the viewed count on the next render, and never the active one", async () => {
  const s = spies();
  const { rerender } = await bar(s, { listOpen: true });
  expect(hasButton(`Handbook pass · ${S.statusBar.runningLabel}`)).toBe(true);
  await click(
    rowOf(`Handbook pass · ${S.statusBar.runningLabel}`).querySelector(
      `button[aria-label="${S.statusBar.remove}"]`,
    )!,
  );
  // The shell drops the id from the opened set and re-asks: the poll's answer no longer
  // holds the removed row, and the second count paid for it — the harness's own active
  // count did not move.
  await rerender(
    view(s, {
      listOpen: true,
      opened: new Set(["s1", "s3"]),
      rows: rows.filter((r) => r.sessionId !== "s2"),
    }),
  );
  expect(hasButton(`Handbook pass · ${S.statusBar.runningLabel}`)).toBe(false);
  expect(button("session: 2 / 2")).toBeInstanceOf(HTMLButtonElement);
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

it("says so when nothing has been viewed yet", async () => {
  const s = spies();
  await bar(s, { listOpen: true, running: 0, rows: [], opened: new Set<string>() });
  const text = document.body.textContent ?? "";
  expect(button("session: 0 / 0")).toBeInstanceOf(HTMLButtonElement);
  expect(text).toContain(S.statusBar.listEmpty);
});
