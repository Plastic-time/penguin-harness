/**
 * The self-evolution player's panes, as functions of how many steps of the script have played.
 *
 * - Given a candidate whose average is strictly higher than the Reference's, it is kept: the
 *   append adds exactly one scoreboard entry, at the next version, and the next round starts from
 *   it.
 * - Given a candidate whose average only equals the Reference's, it is rolled back: the append adds
 *   no entry, its mark leaves the chart, and the next round starts from the same Reference.
 * - Given the case runs, the appended entry holds their means rounded as the Skill writes a
 *   scoreboard entry (score to 2 places, cost to 6, duration to the millisecond); a value some run
 *   did not record is left out rather than averaged over the others.
 * - Given a round, it reads the Trace of the Reference's lowest-scoring case and snapshots the
 *   Reference's version before the change makes the next one.
 * - Given a decision before every Evaluator has returned, the fold refuses it.
 * - Given the example run, every round snapshots before it changes anything and hears from every
 *   Evaluator before it decides; round 1 is kept and round 2 rolled back, so the scoreboard ends at
 *   round 1's version; and every finished round leaves no row unlit, no Evaluator running and no
 *   candidate pending on the chart.
 * - Given the Evaluators' recorded durations, a longer gap between two finishing waits longer, and
 *   every wait of the replay stays within its bounds.
 */
import { describe, expect, it } from "vitest";
import { EVOLVE_SCRIPT } from "../src/lib/evolve-demo";
import type { CaseRun, EvolveScript, EvolveStep, ScorePoint } from "../src/lib/evolve-demo";
import {
  foldEvolve,
  MAX_STEP_MS,
  MIN_STEP_MS,
  roundStarts,
  ROWS,
  stepDelays,
} from "../src/lib/evolve-replay";

const REFERENCE: ScorePoint = {
  version: 3,
  score: 50,
  cases: [
    { id: "A", score: 60 },
    { id: "B", score: 40 },
  ],
};

/** One round of the loop whose Evaluators return these runs, in this order. */
const round = (runs: ReadonlyArray<[string, CaseRun]>): EvolveStep[] => [
  { kind: "reference" },
  { kind: "trace" },
  { kind: "snapshot" },
  { kind: "change", file: "AGENTS.md", added: 1 },
  { kind: "dispatch" },
  ...runs.map(([caseId, run]): EvolveStep => ({ kind: "evaluated", caseId, run })),
  { kind: "decide" },
  { kind: "append" },
];

const script = (...steps: EvolveStep[]): EvolveScript => ({
  label: { agent: "a", model: "m", thinking: "medium" },
  history: [{ version: 1, score: 30 }, REFERENCE],
  steps,
});

const finished = (s: EvolveScript) => foldEvolve(s, s.steps.length);

describe("a round of the loop", () => {
  it("keeps a strictly higher candidate: one entry at the next version, the next Reference", () => {
    const kept = round([
      ["A", { score: 70 }],
      ["B", { score: 31 }],
    ]);
    const after = finished(script(...kept));
    expect(after.round?.decision).toEqual({ score: 50.5, referenceScore: 50, kept: true });
    expect(after.round?.appended).toBe(true);
    expect(after.scoreboard.map((point) => [point.version, point.score])).toEqual([
      [1, 30],
      [3, 50],
      [4, 50.5],
    ]);
    expect(after.candidate).toBeNull();

    const next = script(...kept, { kind: "reference" });
    expect(finished(next).round?.reference).toMatchObject({ version: 4, score: 50.5 });
  });

  it("rolls back a candidate that only equals the Reference: no entry, its mark dropped", () => {
    const rejected = round([
      ["A", { score: 55 }],
      ["B", { score: 45 }],
    ]);
    const after = finished(script(...rejected));
    expect(after.round?.decision).toMatchObject({ score: 50, kept: false });
    expect(after.round?.appended).toBe(false);
    expect(after.scoreboard.map((point) => point.version)).toEqual([1, 3]);
    expect(after.candidate).toMatchObject({ version: 4, dropped: true });

    const next = finished(script(...rejected, { kind: "reference" }));
    expect(next.round?.reference.version).toBe(3);
    expect(next.candidate).toBeNull();
  });

  it("appends the case runs' means, rounded as the Skill writes them", () => {
    const after = finished(
      script(
        ...round([
          ["A", { score: 61, cost: 0.0000011, durationMs: 1000 }],
          ["B", { score: 40, cost: 0.0000012, durationMs: 1001 }],
        ]),
      ),
    );
    expect(after.scoreboard.at(-1)).toMatchObject({
      score: 50.5,
      cost: 0.000001,
      durationMs: 1001,
      cases: [
        { id: "A", score: 61 },
        { id: "B", score: 40 },
      ],
    });

    const uncosted = finished(
      script(
        ...round([
          ["A", { score: 51, durationMs: 1 }],
          ["B", { score: 50, cost: 0.02, durationMs: 2 }],
        ]),
      ),
    );
    // A cost one run did not record is left out; the duration every run recorded is averaged.
    expect(uncosted.scoreboard.at(-1)).not.toHaveProperty("cost");
    expect(uncosted.scoreboard.at(-1)).toMatchObject({ score: 50.5, durationMs: 2 });
  });

  it("reads the weakest case's Trace and snapshots the Reference before the change", () => {
    const steps = round([
      ["A", { score: 60 }],
      ["B", { score: 40 }],
    ]);
    const at = (kind: EvolveStep["kind"]) =>
      foldEvolve(script(...steps), steps.findIndex((step) => step.kind === kind) + 1).round;
    expect(at("trace")?.weakest).toEqual({ id: "B", score: 40 });
    expect(at("snapshot")?.snapshot).toBe("snapshots/v3.tar.gz");
    expect(at("snapshot")?.change).toBeNull();
    expect(at("change")?.change).toMatchObject({ file: "AGENTS.md", version: 4 });
  });

  it("refuses a decision before every Evaluator has returned", () => {
    const early = round([["A", { score: 90 }]]);
    expect(() => finished(script(...early))).toThrow(/every Evaluator/);
  });
});

describe("the example run", () => {
  const steps = EVOLVE_SCRIPT.steps;
  const starts = roundStarts(steps);
  const ends = starts.map((start, i) => starts[i + 1] ?? steps.length);
  const roundSteps = starts.map((start, i) => steps.slice(start, ends[i]));

  it("snapshots before every change and decides only once every Evaluator has returned", () => {
    expect(starts.length).toBeGreaterThan(1);
    for (const [i, each] of roundSteps.entries()) {
      const kinds = each.map((step) => step.kind);
      expect(kinds.indexOf("snapshot")).toBeLessThan(kinds.indexOf("change"));
      const decide = starts[i]! + kinds.indexOf("decide");
      const before = foldEvolve(EVOLVE_SCRIPT, decide).round;
      expect(before?.evaluators?.length).toBeGreaterThan(0);
      expect(before?.evaluators?.every((row) => row.run !== null)).toBe(true);
    }
  });

  it("keeps round 1, rolls back round 2, and ends the scoreboard at round 1's version", () => {
    const decisions = ends.map((end) => foldEvolve(EVOLVE_SCRIPT, end).round?.decision);
    expect(decisions.map((decision) => decision?.kept)).toEqual([true, false]);
    for (const decision of decisions) {
      expect(decision!.kept).toBe(decision!.score > decision!.referenceScore);
    }
    const history = EVOLVE_SCRIPT.history.map((point) => point.version);
    const kept = foldEvolve(EVOLVE_SCRIPT, ends[0]!).scoreboard.at(-1)!.version;
    expect(finished(EVOLVE_SCRIPT).scoreboard.map((point) => point.version)).toEqual([
      ...history,
      kept,
    ]);
  });

  it("leaves every finished round with all rows lit, no Evaluator running, no candidate pending", () => {
    for (const end of ends) {
      const state = foldEvolve(EVOLVE_SCRIPT, end);
      expect(state.round?.current).toBe(ROWS.at(-1));
      expect(state.round?.evaluators?.every((row) => row.run !== null)).toBe(true);
      expect(state.candidate === null || state.candidate.dropped).toBe(true);
    }
  });
});

describe("the replay's pace", () => {
  it("waits longer for a longer gap between Evaluators finishing, within the bounds", () => {
    const delays = stepDelays(
      round([
        ["A", { score: 1, durationMs: 1_000 }],
        ["B", { score: 1, durationMs: 9_000 }],
        ["C", { score: 1, durationMs: 9_500 }],
        ["D", { score: 1, durationMs: 600_000 }],
      ]),
    );
    const [first, second, third, last] = delays.slice(5, 9);
    expect(second).toBeGreaterThan(first!);
    expect(second).toBeGreaterThan(third!);
    expect(last).toBe(MAX_STEP_MS);
    expect(Math.min(first!, third!)).toBe(MIN_STEP_MS);
  });

  it("keeps every wait of the example run within the bounds", () => {
    const delays = stepDelays(EVOLVE_SCRIPT.steps);
    expect(delays).toHaveLength(EVOLVE_SCRIPT.steps.length);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(MIN_STEP_MS);
      expect(delay).toBeLessThanOrEqual(MAX_STEP_MS);
    }
  });
});
