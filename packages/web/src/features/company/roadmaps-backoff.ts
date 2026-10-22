/**
 * The backoff behind a failed read of an organization's roadmaps. Every roadmaps surface of the
 * Web App reads the same organization over the same link to the machine it runs on — the
 * sidebar's list (per navigation), the channel page's lookup of its roadmap, the room column's
 * detail poll and the PR graph's roadmap capsules — and a link whose death makes every one of
 * them fail at once is exactly when they must not each keep asking: one socket disconnect was
 * amplified into 5,160 requests in five minutes (2026-10-21, `…/organizations/penguin/roadmaps`).
 *
 * So a failed read is read again on its own, waiting {@link ROADMAPS_RETRY_MIN_MS} and doubling
 * up to {@link ROADMAPS_RETRY_MAX_MS} — the shape the proposals listing already uses
 * (state/proposals-retry.ts) for the same class of failure — plus two rules of its own:
 *
 * - a read that would start while the wait runs is SKIPPED, not started: a navigation or a
 *   remount re-pulling at once is the "fail, immediately ask again" this module exists to end,
 *   so the wait is the caller's to obey ({@link RoadmapsBackoff.mayStart}); the one scheduled
 *   retry is what heals the page without anyone clicking;
 * - the server's own `Retry-After` (the machine forward's cooldown, a 503 naming seconds) is
 *   never waited less than, so the client's ladder and the server's cooldown compose.
 *
 * One ladder per organization, shared by every surface: they fail on the same link and heal on
 * the same link, and a success anywhere ({@link RoadmapsBackoff.answered}) opens the gate at
 * once and lets everything waiting run — the page recovers one read after the link, not one
 * ladder per surface.
 */

/** The first wait after a failure, and the factor the ladder doubles by. */
export const ROADMAPS_RETRY_MIN_MS = 2_000;
/** The longest wait the ladder reaches, and so the worst-case staleness after a link returns. */
export const ROADMAPS_RETRY_MAX_MS = 30_000;

/**
 * The backoff every roadmaps surface shares. `key` is the organization the read is about —
 * {@link roadmapsKey}; a read of another organization is another ladder.
 */
export interface RoadmapsBackoff {
  /** Whether a read of `key` may start now; false while the failure wait runs. */
  mayStart(key: string): boolean;
  /**
   * A read of `key` answered. The ladder resets and the gate opens at once: the retries still
   * waiting (other surfaces of the same organization) run now rather than on their timers,
   * so one good read heals the page.
   */
  answered(key: string): void;
  /**
   * A read of `key` failed. The ladder steps (a failure that arrives while a wait already runs
   * keeps the earlier deadline), `again` runs when the gate opens, and the server's
   * `Retry-After`, when the failure carries one, is never waited less than. Answers the wait
   * in ms, so a test (or a log line) can read the ladder.
   */
  failed(key: string, again: () => void, retryAfterSeconds?: number): number;
  /**
   * A read of `key` was due now but the gate is closed: `run` joins the ones already waiting,
   * on the same deadline. The detail poll asks this — its own cycle must not die while the
   * gate is closed, and it must not ask early either.
   */
  defer(key: string, run: () => void): void;
}

interface Entry {
  /** Failures in a row: the exponent the next wait doubles by. */
  failures: number;
  /** When the gate opens again, in epoch ms; at most one timer holds it shut. */
  until: number;
  /** The timer that opens the gate; null while it is open. */
  timer: ReturnType<typeof setTimeout> | null;
  /** What runs when the gate opens: every surface that failed (or deferred) while it was shut. */
  waiting: Set<() => void>;
}

/** The ladder's wait after `failures` failures in a row. */
export function roadmapsRetryDelayMs(failures: number): number {
  return Math.min(ROADMAPS_RETRY_MAX_MS, ROADMAPS_RETRY_MIN_MS * 2 ** failures);
}

function createRoadmapsBackoff(): RoadmapsBackoff {
  const entries = new Map<string, Entry>();

  const entry = (key: string): Entry => {
    let made = entries.get(key);
    if (made === undefined) {
      made = { failures: 0, until: 0, timer: null, waiting: new Set() };
      entries.set(key, made);
    }
    return made;
  };

  /** Opens the gate: nothing more is waited, and everyone waiting runs now. */
  const open = (of: Entry): void => {
    if (of.timer !== null) clearTimeout(of.timer);
    of.timer = null;
    of.until = 0;
    const waiting = [...of.waiting];
    of.waiting.clear();
    for (const run of waiting) run();
  };

  return {
    mayStart: (key) => Date.now() >= entry(key).until,

    answered: (key) => {
      const of = entries.get(key);
      // A success without a failure before it leaves nothing to do.
      if (of === undefined) return;
      of.failures = 0;
      if (of.timer !== null) open(of);
    },

    failed: (key, again, retryAfterSeconds) => {
      const of = entry(key);
      of.waiting.add(again);
      const delay =
        retryAfterSeconds === undefined
          ? roadmapsRetryDelayMs(of.failures)
          : // The server's own cooldown names whole seconds; the ladder never undercuts it.
            Math.max(roadmapsRetryDelayMs(of.failures), retryAfterSeconds * 1000);
      of.failures += 1;
      if (of.timer !== null) return delay; // a wait already runs: keep its earlier deadline
      of.until = Date.now() + delay;
      of.timer = setTimeout(() => {
        of.timer = null;
        open(of);
      }, delay);
      return delay;
    },

    defer: (key, run) => {
      const of = entry(key);
      // The gate already open (or never shut): run now, as the caller's own read would have.
      if (of.timer === null) {
        run();
        return;
      }
      of.waiting.add(run);
    },
  };
}

/**
 * The instance the roadmaps surfaces share — one per page, module level like the session
 * machine tables, so every surface of every organization reads the same ladders.
 */
let instance = createRoadmapsBackoff();
export const roadmapsBackoff: RoadmapsBackoff = {
  mayStart: (key) => instance.mayStart(key),
  answered: (key) => instance.answered(key),
  failed: (key, again, retryAfterSeconds) => instance.failed(key, again, retryAfterSeconds),
  defer: (key, run) => instance.defer(key, run),
};

/** Reads the shared instance afresh: the state a test leaves behind never leaks into the next one. */
export function resetRoadmapsBackoff(): void {
  instance = createRoadmapsBackoff();
}

/** The key every roadmaps surface of one organization shares: `<projectId>/<orgId>`. */
export function roadmapsKey(projectId: string, orgId: string): string {
  return `${projectId}/${orgId}`;
}
