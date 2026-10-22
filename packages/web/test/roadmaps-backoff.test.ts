/**
 * features/company/roadmaps-backoff.ts: the shared backoff behind every roadmaps read of one
 * organization. A read that fails is retried on its own, doubling, and a read that would start
 * inside the wait is skipped — the "fail, immediately ask again" that turned one dead link to
 * the organization's machine into 5,160 requests in five minutes. The ladder is the proposals
 * listing's own shape (state/proposals-retry.ts), plus two rules of its own: the server's
 * Retry-After is never undercut, and one answered read opens the gate for every surface waiting
 * on the same organization, so the page heals once, not once per surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ROADMAPS_RETRY_MAX_MS,
  ROADMAPS_RETRY_MIN_MS,
  resetRoadmapsBackoff,
  roadmapsBackoff,
  roadmapsKey,
  roadmapsRetryDelayMs,
} = await import("../src/features/company/roadmaps-backoff");

const ORG = roadmapsKey("p1", "acme");
const OTHER = roadmapsKey("p1", "lab");

beforeEach(() => {
  vi.useFakeTimers();
  resetRoadmapsBackoff();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the ladder", () => {
  it("starts at the minimum and doubles, capped at the ceiling", () => {
    expect(roadmapsRetryDelayMs(0)).toBe(ROADMAPS_RETRY_MIN_MS);
    expect(roadmapsRetryDelayMs(1)).toBe(ROADMAPS_RETRY_MIN_MS * 2);
    expect(roadmapsRetryDelayMs(2)).toBe(ROADMAPS_RETRY_MIN_MS * 4);
    expect(roadmapsRetryDelayMs(10)).toBe(ROADMAPS_RETRY_MAX_MS);
  });

  it("names the worst-case staleness of a healed link as the ceiling", () => {
    expect(ROADMAPS_RETRY_MAX_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("a failed read", () => {
  it("may not start again until the wait has passed, and the retry runs then", () => {
    const again = vi.fn();
    /** The wait the failure the retry itself met produced, read out of the mock. */
    let metWait: number | undefined;
    again.mockImplementation(() => {
      metWait = roadmapsBackoff.failed(ORG, again);
    });
    expect(roadmapsBackoff.failed(ORG, again)).toBe(ROADMAPS_RETRY_MIN_MS);
    expect(roadmapsBackoff.mayStart(ORG)).toBe(false);

    vi.advanceTimersByTime(ROADMAPS_RETRY_MIN_MS - 1);
    expect(again).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(again).toHaveBeenCalledTimes(1);
    // The failure the retry met waited twice the first.
    expect(metWait).toBe(ROADMAPS_RETRY_MIN_MS * 2);
  });

  it("never waits longer than the ceiling between two reads", () => {
    const again = vi.fn();
    again.mockImplementation(() => roadmapsBackoff.failed(ORG, again));
    for (let at = 0; at < 8; at += 1) roadmapsBackoff.failed(ORG, again);
    expect(roadmapsBackoff.failed(ORG, again)).toBe(ROADMAPS_RETRY_MAX_MS);
  });

  it("keeps the earlier deadline when another failure lands inside the wait", () => {
    const first = vi.fn();
    const second = vi.fn();
    roadmapsBackoff.failed(ORG, first);
    vi.advanceTimersByTime(ROADMAPS_RETRY_MIN_MS / 2);
    // A second surface failed on the same link: it joins the first's wait, none is shortened.
    roadmapsBackoff.failed(ORG, second);
    vi.advanceTimersByTime(ROADMAPS_RETRY_MIN_MS / 2 - 1);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("never waits less than the server's own Retry-After", () => {
    const wait = roadmapsBackoff.failed(ORG, vi.fn(), 20);
    expect(wait).toBe(20_000);
    // The server said five seconds; the ladder was at its first step, the server wins.
    expect(roadmapsBackoff.failed(OTHER, vi.fn(), 1)).toBe(ROADMAPS_RETRY_MIN_MS);
  });

  it("counts a failure arriving inside a wait towards the next one", () => {
    const again = vi.fn();
    roadmapsBackoff.failed(ORG, again);
    roadmapsBackoff.failed(ORG, again);
    vi.advanceTimersByTime(ROADMAPS_RETRY_MIN_MS); // the earlier deadline opens the gate
    // Two failures were counted: the next wait is the ladder's third step.
    expect(roadmapsBackoff.failed(ORG, again)).toBe(ROADMAPS_RETRY_MIN_MS * 4);
  });
});

describe("an answered read", () => {
  it("resets the ladder and opens the gate at once", () => {
    const again = vi.fn();
    roadmapsBackoff.failed(ORG, again);
    roadmapsBackoff.answered(ORG);
    expect(roadmapsBackoff.mayStart(ORG)).toBe(true);
    expect(again).toHaveBeenCalledTimes(1);
    // The next failure waits the minimum again.
    expect(roadmapsBackoff.failed(ORG, again)).toBe(ROADMAPS_RETRY_MIN_MS);
  });

  it("lets every surface waiting on the same organization run, once", () => {
    const sidebar = vi.fn();
    const poll = vi.fn();
    const graph = vi.fn();
    roadmapsBackoff.failed(ORG, sidebar);
    roadmapsBackoff.failed(ORG, poll);
    roadmapsBackoff.answered(ORG);
    expect(sidebar).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(graph).not.toHaveBeenCalled();
  });

  it("does nothing when no read of the organization ever failed", () => {
    expect(() => roadmapsBackoff.answered(ORG)).not.toThrow();
    expect(roadmapsBackoff.mayStart(ORG)).toBe(true);
  });
});

describe("a read deferred against a closed gate", () => {
  it("runs when the gate opens, not before", () => {
    const run = vi.fn();
    roadmapsBackoff.failed(ORG, vi.fn());
    roadmapsBackoff.defer(ORG, run);
    vi.advanceTimersByTime(ROADMAPS_RETRY_MIN_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs at once against an open gate", () => {
    const run = vi.fn();
    roadmapsBackoff.defer(ORG, run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("two organizations", () => {
  it("hold one ladder each", () => {
    const acme = vi.fn();
    const lab = vi.fn();
    roadmapsBackoff.failed(ORG, acme);
    expect(roadmapsBackoff.mayStart(ORG)).toBe(false);
    expect(roadmapsBackoff.mayStart(OTHER)).toBe(true);
    vi.advanceTimersByTime(ROADMAPS_RETRY_MIN_MS);
    expect(acme).toHaveBeenCalledTimes(1);
    expect(lab).not.toHaveBeenCalled();
  });
});
