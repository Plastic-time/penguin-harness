/**
 * The status bar's counting and marking rules, kept free of React so tests drive them
 * directly (the component only wires polling, storage and navigation on top).
 *
 * What the user asked the bar to keep, over the WHOLE harness (the server's one poll — not
 * the Project the sidebar lists):
 *
 * - `session: ${running} / ${all}` — `running` is the server's live truth; `all` is the
 *   harness's every Session MINUS the ones this browser has closed out of the list: a row's
 *   x removes it from the list and, per the ticket's 「移除即关闭」 reading, that removal is
 *   the closing that makes the count go down by one.
 * - A Session the user has OPENED (the route sits on it once) is marked once when it goes
 *   idle — a finished-working signal the list carries until the user looks at the Session
 *   again. Transitions are observed between consecutive polls; a reload forgets the previous
 *   statuses, so a flip that happens while the page is closed is not re-marked (there was
 *   nothing observed to mark from).
 * - The closed set is client bookkeeping (localStorage) capped at CAP ids, oldest evicted:
 *   it is the user's own tracker, not a deletion — the Session itself is untouched, and the
 *   harness's own count stays what the server says. A closed id deleted on the server later
 *   still subtracts until it falls off the cap; the one-count drift that costs is accepted
 *   (the exact fix — intersecting the set server-side — rides on a later need).
 */
import type { HarnessStatusSession, SessionStatus } from "@prismshadow/penguin-server/api";

/** localStorage keys under which the three sets persist (all best-effort; see the loader). */
export const OPENED_KEY = "penguin.statusBar.opened";
export const MARKS_KEY = "penguin.statusBar.marks";
export const CLOSED_KEY = "penguin.statusBar.closed";

/** How many ids each set keeps; the oldest evicted. */
export const CAP = 200;

/** The storage the sets persist in, as narrow as the model needs (tests stand one in). */
export interface StatusBarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The page's own localStorage, read at call time so a stubbed global is honoured. */
export function pageStorage(): StatusBarStorage | null {
  try {
    const store = globalThis.localStorage;
    if (store === undefined || store === null) return null;
    return store;
  } catch {
    return null;
  }
}

/**
 * An insertion-ordered set of session ids with a size cap (oldest evicted). Order is what
 * makes the cap fair — the oldest bookkeeping entry goes, not an arbitrary one. A Set
 * subclass, so it flows anywhere a set of ids is read; the only behaviour it adds is the
 * cap, and that re-adding an id moves it to the end (recency is what eviction goes by).
 */
export class IdSet extends Set<string> {
  constructor(
    ids: Iterable<string> = [],
    private readonly cap: number = CAP,
  ) {
    super();
    // Deduplicate on the way in, keeping each id's first position (a plain Set's order).
    for (const id of new Set(ids)) super.add(id);
    while (this.size > this.cap) this.deleteOldest();
  }

  add(id: string): this {
    super.delete(id);
    super.add(id);
    while (this.size > this.cap) this.deleteOldest();
    return this;
  }

  toArray(): string[] {
    return [...this];
  }

  /** Evicts the oldest entry — the first one a Set's insertion order hands back. */
  private deleteOldest(): void {
    const oldest = this.values().next().value;
    if (oldest !== undefined) super.delete(oldest);
  }
}

/** Reads one set; an unreadable or malformed value reads as empty (the bar degrades, never breaks). */
export function loadIdSet(storage: StatusBarStorage | null, key: string): IdSet {
  if (storage === null) return new IdSet();
  try {
    const raw = storage.getItem(key);
    if (raw === null) return new IdSet();
    const parsed: unknown = JSON.parse(raw);
    return new IdSet(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new IdSet();
  }
}

/** Writes one set; a refused write only costs persistence for this tab. */
export function saveIdSet(storage: StatusBarStorage | null, key: string, ids: IdSet): void {
  if (storage === null) return;
  try {
    storage.setItem(key, JSON.stringify(ids.toArray()));
  } catch {
    // Storage refused or is full: the in-memory set keeps working for this tab.
  }
}

/**
 * The ids to mark this poll: a Session the user has opened that just read idle after being
 * observed running (or compacting) in the previous poll, and that does not already carry a
 * mark. 「标记一次」 per transition — an id that keeps its mark is not marked again.
 */
export function marksForTransitions(
  rows: readonly HarnessStatusSession[],
  prevStatusById: ReadonlyMap<string, SessionStatus>,
  opened: ReadonlySet<string>,
  marked: ReadonlySet<string>,
): string[] {
  const newlyMarked: string[] = [];
  for (const row of rows) {
    if (row.status !== "idle") continue;
    if (!opened.has(row.sessionId) || marked.has(row.sessionId)) continue;
    const prev = prevStatusById.get(row.sessionId);
    if (prev !== undefined && prev !== "idle" && !newlyMarked.includes(row.sessionId)) {
      newlyMarked.push(row.sessionId);
    }
  }
  return newlyMarked;
}

/**
 * The bar's `all`: the harness's every Session minus the ones this browser closed out of
 * the list. Never below zero (a closed id the server has since deleted costs at most one,
 * until it falls off the cap).
 */
export function trackedTotal(total: number, closed: ReadonlySet<string>): number {
  return Math.max(0, total - closed.size);
}

/** The rows the list shows: every row the server sent except the closed-out ones. */
export function visibleRows(
  rows: readonly HarnessStatusSession[],
  closed: ReadonlySet<string>,
): HarnessStatusSession[] {
  return rows.filter((row) => !closed.has(row.sessionId));
}

/** One decimal of GB — the bar's memory shape (`6.2 / 16 GB`). */
export function gigabytes(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}
