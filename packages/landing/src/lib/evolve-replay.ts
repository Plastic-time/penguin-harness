/**
 * The self-evolution player's panes as functions of how many steps of the script have played:
 * `foldEvolve` turns the first `count` steps into the round on the left and the scoreboard on the
 * right. Pure, so the finished state, every frame of the replay and the tests read the same code.
 *
 * The fold applies the loop's own rules rather than reading them from the script: a round's
 * Reference is the scoreboard's newest entry; the Trace it reads is that entry's lowest-scoring
 * case; the snapshot is named after the Reference's version; the candidate is the next version;
 * its averages are the means of its case runs, rounded as the Skill writes a scoreboard entry
 * (score to 2 places, cost to 6, duration to the millisecond); it is kept only when its score is
 * strictly higher than the Reference's, and only a kept candidate is appended, becoming the next
 * round's Reference.
 */
import type {
  CaseRun,
  CaseScore,
  ChangeRule,
  EvolveScript,
  EvolveStep,
  ScorePoint,
} from "./evolve-demo";

/** The rows of a round, top to bottom. */
export const ROWS = [
  "reference",
  "trace",
  "snapshot",
  "change",
  "evaluate",
  "decide",
  "append",
] as const;

export type RowKind = (typeof ROWS)[number];

/** The row a step lights. */
const ROW_OF: Record<EvolveStep["kind"], RowKind> = {
  reference: "reference",
  trace: "trace",
  snapshot: "snapshot",
  change: "change",
  dispatch: "evaluate",
  evaluated: "evaluate",
  decide: "decide",
  append: "append",
};

export interface EvaluatorRow {
  caseId: string;
  /** Null while the Evaluator runs. */
  run: CaseRun | null;
}

export interface Decision {
  /** The candidate's average score. */
  score: number;
  /** The Reference's. */
  referenceScore: number;
  kept: boolean;
}

export interface RoundState {
  /** 1-based. */
  number: number;
  reference: ScorePoint;
  weakest: CaseScore | null;
  snapshot: string | null;
  change: { file: string; added: number; version: number; rule?: ChangeRule } | null;
  evaluators: EvaluatorRow[] | null;
  decision: Decision | null;
  /** Null until the round's last step; then whether the candidate entered the scoreboard. */
  appended: boolean | null;
  /** The row the latest step lit. */
  current: RowKind;
}

/** A scoreboard entry as drawn: the round that appended it, if a round did. */
export interface BoardPoint extends ScorePoint {
  round?: number;
}

/** The candidate on the chart, from its decision until it is appended or dropped. */
export interface CandidateMark {
  version: number;
  score: number;
  kept: boolean;
  /** Rolled back and not appended: the mark leaves the chart. */
  dropped: boolean;
}

export interface EvolveState {
  round: RoundState | null;
  scoreboard: BoardPoint[];
  candidate: CandidateMark | null;
}

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const roundTo = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** A mean the scoreboard can store: every run recorded the value, or there is none. */
function averageOf(values: ReadonlyArray<number | undefined>, places: number): number | undefined {
  const recorded = values.filter((value): value is number => value !== undefined);
  return recorded.length === values.length ? roundTo(mean(recorded), places) : undefined;
}

/** The panes after the first `count` steps of the script. */
export function foldEvolve(script: EvolveScript, count: number): EvolveState {
  const scoreboard: BoardPoint[] = script.history.map((point) => ({ ...point }));
  let round: RoundState | null = null;
  let candidate: CandidateMark | null = null;
  let rounds = 0;

  const inRound = (step: EvolveStep): RoundState => {
    if (round === null) throw new Error(`"${step.kind}" before the first "reference"`);
    round.current = ROW_OF[step.kind];
    return round;
  };

  for (const step of script.steps.slice(0, count)) {
    if (step.kind === "reference") {
      rounds += 1;
      candidate = null;
      round = {
        number: rounds,
        reference: scoreboard.at(-1)!,
        weakest: null,
        snapshot: null,
        change: null,
        evaluators: null,
        decision: null,
        appended: null,
        current: "reference",
      };
      continue;
    }
    const r = inRound(step);
    switch (step.kind) {
      case "trace": {
        const cases = r.reference.cases ?? [];
        r.weakest = cases.reduce<CaseScore | null>(
          (low, each) => (low === null || each.score < low.score ? each : low),
          null,
        );
        break;
      }
      case "snapshot":
        r.snapshot = `snapshots/v${r.reference.version}.tar.gz`;
        break;
      case "change":
        r.change = {
          file: step.file,
          added: step.added,
          version: r.reference.version + 1,
          ...(step.rule !== undefined ? { rule: step.rule } : {}),
        };
        break;
      case "dispatch":
        r.evaluators = (r.reference.cases ?? []).map((each) => ({ caseId: each.id, run: null }));
        break;
      case "evaluated": {
        const row = r.evaluators?.find((each) => each.caseId === step.caseId);
        if (row === undefined) throw new Error(`no Evaluator runs ${step.caseId}`);
        row.run = step.run;
        break;
      }
      case "decide": {
        const runs = (r.evaluators ?? []).map((each) => each.run);
        if (runs.length === 0 || runs.some((run) => run === null)) {
          throw new Error("a decision before every Evaluator finished");
        }
        const score = roundTo(mean((runs as CaseRun[]).map((run) => run.score)), 2);
        const kept = score > r.reference.score;
        r.decision = { score, referenceScore: r.reference.score, kept };
        candidate = {
          version: r.change?.version ?? r.reference.version + 1,
          score,
          kept,
          dropped: false,
        };
        break;
      }
      case "append": {
        if (r.decision === null || candidate === null)
          throw new Error("an append before the decision");
        r.appended = r.decision.kept;
        if (!r.decision.kept) {
          // Made by this fold, so it is this call's to change.
          candidate.dropped = true;
          break;
        }
        const rows = r.evaluators!.map((each) => ({ id: each.caseId, run: each.run! }));
        const cost = averageOf(
          rows.map((row) => row.run.cost),
          6,
        );
        const durationMs = averageOf(
          rows.map((row) => row.run.durationMs),
          0,
        );
        scoreboard.push({
          version: candidate.version,
          score: r.decision.score,
          cases: rows.map((row) => ({ id: row.id, score: row.run.score })),
          ...(cost !== undefined ? { cost } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          round: r.number,
        });
        candidate = null;
        break;
      }
    }
  }
  return { round, scoreboard, candidate };
}

/** Where each round's steps start in the script, in order. */
export function roundStarts(steps: readonly EvolveStep[]): number[] {
  return steps.flatMap((step, i) => (step.kind === "reference" ? [i] : []));
}

/**
 * The pace of the replay, unhurried: each step waits its kind's beat. Evaluators run in parallel,
 * so a run that recorded its duration finishes after the one before it by the recorded gap,
 * scaled down; every wait stays within the bounds.
 */
export const MIN_STEP_MS = 600;
export const MAX_STEP_MS = 2400;

const BEAT_MS: Record<EvolveStep["kind"], number> = {
  reference: 1000,
  trace: 1500,
  snapshot: 1500,
  change: 1700,
  dispatch: 1500,
  evaluated: 900,
  decide: 1700,
  append: 1500,
};

/** Recorded seconds become a fraction of a replayed second. */
const EVALUATION_TIME_SCALE = 1 / 8;

const clamp = (ms: number) => Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, Math.round(ms)));

/** Milliseconds to wait before showing step i. */
export function stepDelays(steps: readonly EvolveStep[]): number[] {
  let finished = 0;
  return steps.map((step) => {
    if (step.kind === "dispatch") finished = 0;
    if (step.kind !== "evaluated" || step.run.durationMs === undefined) {
      return clamp(BEAT_MS[step.kind]);
    }
    const gap = step.run.durationMs - finished;
    finished = step.run.durationMs;
    return clamp(gap * EVALUATION_TIME_SCALE);
  });
}
