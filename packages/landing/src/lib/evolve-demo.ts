/**
 * The self-evolution player's script, an example run: an agent's scoreboard on a Benchmark that
 * scores four capability dimensions, then two rounds of the Default loop (the
 * `agent-optimization` Skill). Each round reads the Reference, reads the Trace of its weakest
 * dimension, snapshots the Agent State, makes one change, evaluates every dimension in parallel
 * through Evaluator subagents, keeps the candidate only on a strictly higher score and then
 * appends it to the scoreboard. What a step derives (the weakest dimension, the snapshot's path,
 * the candidate's averages, the verdict) is lib/evolve-replay.ts's fold; the script holds only what
 * the runs produced.
 *
 * The numbers are scripted to the loop's rules and to how such runs tend to look: the score rises
 * over the kept versions while the cost and time per case fall; round 1's change lifts its weakest
 * dimension and is kept; round 2's lifts its own but costs two others more, averages below the
 * Reference, and is rolled back without reaching the scoreboard.
 */

/** The label a scoreboard line is drawn for: the tested agent, the model and the thinking level. */
export interface EvolveLabel {
  agent: string;
  model: string;
  thinking: string;
}

/** The Benchmark's capability dimensions, one case each; their names are in the dictionaries. */
export type Dimension = "analysis" | "engineering" | "automation" | "terminal";

export interface CaseScore {
  /** The case: in the example run, a capability dimension. */
  id: string;
  score: number;
}

/** One scoreboard entry: a version's averages over the Benchmark's cases. */
export interface ScorePoint {
  version: number;
  score: number;
  /** Per-case scores, on an entry a round reads as its Reference. */
  cases?: readonly CaseScore[];
  /** Average cost of a case run, in USD. */
  cost?: number;
  /** Average duration of a case run. */
  durationMs?: number;
}

/** One case run by an Evaluator: its score, and the run's cost and time where they were recorded. */
export interface CaseRun {
  score: number;
  cost?: number;
  durationMs?: number;
}

/** The rule a change adds to the agent, by the dictionary key that holds its text. */
export type ChangeRule = "automationFields" | "testsFirst";

export type EvolveStep =
  /** A round begins from the Reference: the scoreboard's newest entry. */
  | { kind: "reference" }
  /** The Optimizer reads the Test Trace of the Reference's lowest-scoring case. */
  | { kind: "trace" }
  /** A hypothesis, and the Reference's Agent State archived before anything changes. */
  | { kind: "snapshot" }
  /** One bounded change, which makes the candidate the next version. */
  | { kind: "change"; file: string; added: number; rule?: ChangeRule }
  /** One Evaluator per case, all running at once. */
  | { kind: "dispatch" }
  /** An Evaluator returns its case's run. */
  | { kind: "evaluated"; caseId: string; run: CaseRun }
  /** The candidate's average against the Reference's. */
  | { kind: "decide" }
  /** A kept candidate is appended to the scoreboard; a rolled-back one is not. */
  | { kind: "append" };

export interface EvolveScript {
  label: EvolveLabel;
  /** The scoreboard before the first round, oldest first. */
  history: readonly ScorePoint[];
  steps: readonly EvolveStep[];
}

/** A case run, as the script spells one: the dimension it scored and what the run recorded. */
const evaluated = (
  caseId: Dimension,
  score: number,
  cost: number,
  durationMs: number,
): EvolveStep => ({ kind: "evaluated", caseId, run: { score, cost, durationMs } });

// Each round's Evaluators report in the order their runs finish: shortest first.
const ROUND_ONE: readonly EvolveStep[] = [
  { kind: "reference" },
  { kind: "trace" },
  { kind: "snapshot" },
  { kind: "change", file: "AGENTS.md", added: 1, rule: "automationFields" },
  { kind: "dispatch" },
  evaluated("terminal", 96, 0.0213, 47_930),
  evaluated("automation", 86, 0.0262, 55_710),
  evaluated("analysis", 88, 0.0291, 61_380),
  evaluated("engineering", 84, 0.0346, 78_240),
  { kind: "decide" },
  { kind: "append" },
];

const ROUND_TWO: readonly EvolveStep[] = [
  { kind: "reference" },
  { kind: "trace" },
  { kind: "snapshot" },
  { kind: "change", file: "AGENTS.md", added: 1, rule: "testsFirst" },
  { kind: "dispatch" },
  evaluated("automation", 85, 0.027, 57_320),
  evaluated("terminal", 88, 0.0244, 58_790),
  evaluated("analysis", 82, 0.0318, 70_240),
  evaluated("engineering", 90, 0.0401, 92_560),
  { kind: "decide" },
  { kind: "append" },
];

export const EVOLVE_SCRIPT: EvolveScript = {
  label: { agent: "ops-agent", model: "deepseek-flash", thinking: "medium" },
  history: [
    { version: 9, score: 48, cost: 0.0412, durationMs: 96_300 },
    { version: 11, score: 62, cost: 0.0371, durationMs: 84_480 },
    { version: 12, score: 69, cost: 0.0344, durationMs: 77_910 },
    { version: 13, score: 74, cost: 0.0336, durationMs: 74_160 },
    {
      version: 14,
      score: 81,
      cost: 0.0309,
      durationMs: 68_620,
      cases: [
        { id: "analysis", score: 86 },
        { id: "engineering", score: 80 },
        { id: "automation", score: 64 },
        { id: "terminal", score: 94 },
      ],
    },
  ],
  steps: [...ROUND_ONE, ...ROUND_TWO],
};
