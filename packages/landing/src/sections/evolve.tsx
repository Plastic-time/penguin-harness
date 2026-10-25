/**
 * Observable self-evolution: the Default loop replayed beside the scoreboard it writes, then the
 * RSI algorithms and the built-in Benchmarks it runs with, the recorded demo of a decision agent's
 * round with what its test runs cost, and where to read on in the docs.
 *
 * The player follows the /amsp page's (components/stream-player.tsx): one tab per round, the
 * script in lib/evolve-demo.ts folded by lib/evolve-replay.ts, one timer at a time, only while the
 * player is on screen and not paused. A round's rows light in order beside the chart: the
 * candidate shows as a hollow mark at its decision, a kept one becomes the line's next point when
 * it is appended, a rolled-back one leaves the chart. After round 1 the player goes on to round 2;
 * after the last it rests, then plays again from round 1. Under reduced motion each tab shows its
 * round finished and nothing plays.
 *
 * Nothing below moves: the round pane holds the height of the tallest finished round (each is
 * rendered invisibly in the same grid cell) and the chart's height depends on its width alone.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { SitePill, useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteLocale as Locale } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { DOCS_URL, demoVideoUrl } from "../lib/links";
import { BENCHMARKS, RSI_TOOLKITS } from "../lib/rsi-stats";
import { EVOLVE_SCRIPT } from "../lib/evolve-demo";
import type { CaseRun } from "../lib/evolve-demo";
import { foldEvolve, roundStarts, ROWS, stepDelays } from "../lib/evolve-replay";
import type { EvolveState, RoundState, RowKind } from "../lib/evolve-replay";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { Section } from "../components/section";
import { DemoVideo } from "../components/demo-video";
import { ExternalLink, ExternalLinkScope } from "../components/external-link";
import { ArrowRightIcon, ExternalLinkIcon, SpinnerIcon } from "../components/icons";
import demoPosterZh from "../assets/shots/decision-evo-zh.webp";
import demoPosterEn from "../assets/shots/decision-evo-en.webp";

const SCRIPT = EVOLVE_SCRIPT;
const STARTS = roundStarts(SCRIPT.steps);
const LENGTHS = STARTS.map((start, i) => (STARTS[i + 1] ?? SCRIPT.steps.length) - start);
const DELAYS = stepDelays(SCRIPT.steps);
const LAST = STARTS.length - 1;
/** Each round finished, for the tab that shows it and for the pane's height. */
const FINISHED = STARTS.map((start, i) => foldEvolve(SCRIPT, start + LENGTHS[i]!));

/** The finished last round stays on screen this long before round 1 plays again. */
const REST_MS = 3000;
/** A finished round stays on screen this long before the next one starts. */
const ROUND_GAP_MS = 2400;

/** The role that runs a round, and the Skill it runs: names, the same in every language. */
const OPTIMIZER = "Optimizer";
const OPTIMIZER_SKILL = "agent-optimization";

const SERIES = `${SCRIPT.label.agent} · ${SCRIPT.label.model} · ${SCRIPT.label.thinking}`;

const PANE_LABEL = "text-xs font-semibold text-gray-500 dark:text-gray-400";

/** A score as the Evaluation Center prints one: integers as they are, else up to two places. */
const score = (n: number) =>
  Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
const cost = (usd: number) => `$${usd.toFixed(4)}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
/** A case by its dimension's name; a case the dictionaries do not name, by its id. */
const caseName = (id: string) =>
  (S.evolve.player.dimensions as Record<string, string | undefined>)[id] ?? id;

export function Evolve() {
  const E = S.evolve;
  const { locale } = useSiteLocale();
  const demo = DEMO[locale];
  return (
    <Section id="self-evolution" title={E.title} subtitle={E.subtitle}>
      <EvolvePlayer />
      <Catalogue />
      <figure className="mx-auto mt-14 max-w-5xl">
        <DemoVideo src={demo.video} poster={demo.poster} label={E.recording.caption} />
        <figcaption className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          {E.recording.caption}
        </figcaption>
        <p className="mt-2 text-center text-[13px] font-semibold text-brand-700 dark:text-brand-300">
          {E.recording.cost}
        </p>
      </figure>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        <DocsLink href={`${DOCS_URL}self-improvement`}>{E.links.how}</DocsLink>
        <DocsLink href={`${DOCS_URL}evaluation-center`}>{E.links.center}</DocsLink>
      </div>
    </Section>
  );
}

/** The recorded demo and its title-frame poster, per language. */
const DEMO: Record<Locale, { video: string; poster: string }> = {
  zh: { video: demoVideoUrl("decision_evo_zh"), poster: demoPosterZh },
  en: { video: demoVideoUrl("decision_evo_en"), poster: demoPosterEn },
};

function DocsLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-1.5 text-[15px] font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
    >
      {children}
      <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </a>
  );
}

function EvolvePlayer() {
  const still = usePrefersReducedMotion();
  // The whole story until the player first comes on screen: the last round, finished.
  const [index, setIndex] = useState(LAST);
  const [count, setCount] = useState(LENGTHS[LAST]!);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const seen = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.4 },
    );
    seen.observe(root);
    return () => seen.disconnect();
  }, []);

  // The first time it is seen, round 1 starts from its first step.
  useEffect(() => {
    if (visible && !playing && !still) {
      setPlaying(true);
      setIndex(0);
      setCount(0);
    }
  }, [visible, playing, still]);

  // One step at a time; after a round, the next; after the last, a rest, then round 1 again.
  useEffect(() => {
    if (!playing || still || paused || !visible) return;
    const length = LENGTHS[index]!;
    const wait =
      count < length ? DELAYS[STARTS[index]! + count]! : index === LAST ? REST_MS : ROUND_GAP_MS;
    const timer = window.setTimeout(() => {
      if (count < length) {
        setCount(count + 1);
        return;
      }
      setIndex(index === LAST ? 0 : index + 1);
      setCount(0);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [playing, still, paused, visible, count, index]);

  const choose = (next: number) => {
    setIndex(next);
    // Paused or still, a tab shows its round finished; otherwise the round plays from its start.
    setCount(still || paused ? LENGTHS[next]! : 0);
    setPlaying(!still);
  };

  const onTabKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + STARTS.length) % STARTS.length;
    choose(next);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };

  // Reduced motion switched on mid-replay shows the round finished.
  const shown = still ? LENGTHS[index]! : count;
  const state = useMemo(() => foldEvolve(SCRIPT, STARTS[index]! + shown), [index, shown]);
  // Until its first step plays, a round's rows wait unlit (the fold still holds the last one).
  const round = state.round?.number === index + 1 ? state.round : null;
  const P = S.evolve.player;

  return (
    <div ref={rootRef}>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-200 px-3 pt-1.5 dark:border-gray-800">
          <span id={`${id}-label`} className={`pb-1 ${PANE_LABEL}`}>
            {P.label}
          </span>
          <div
            ref={tabsRef}
            role="tablist"
            aria-labelledby={`${id}-label`}
            className="flex flex-wrap gap-1"
            onKeyDown={onTabKey}
          >
            {STARTS.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                id={`${id}-tab-${i}`}
                aria-controls={`${id}-panel`}
                aria-selected={i === index}
                tabIndex={i === index ? 0 : -1}
                onClick={() => choose(i)}
                className="rounded-t-md border-b-2 border-transparent px-2.5 py-1 text-[13px] whitespace-nowrap text-gray-500 transition-colors hover:text-gray-900 aria-selected:border-brand-600 aria-selected:font-medium aria-selected:text-brand-700 dark:text-gray-400 dark:hover:text-gray-100 dark:aria-selected:border-brand-400 dark:aria-selected:text-brand-300"
              >
                {P.round(i + 1)}
              </button>
            ))}
          </div>
          {!still && (
            <button
              type="button"
              aria-pressed={paused}
              onClick={() => setPaused((was) => !was)}
              className="mb-1 ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-gray-600 transition-colors hover:text-gray-950 dark:border-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
            >
              {paused ? <PlayGlyph /> : <PauseGlyph />}
              <span>{paused ? P.play : P.pause}</span>
            </button>
          )}
        </div>

        <div
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-tab-${index}`}
          className="grid gap-px bg-gray-200 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] dark:bg-gray-800"
        >
          <section className="min-w-0 bg-gray-50 px-4 pt-3 pb-4 dark:bg-gray-900">
            <h3 className={PANE_LABEL}>
              {OPTIMIZER} · <span className="font-mono font-normal">{OPTIMIZER_SKILL}</span>
            </h3>
            <div className="mt-2 grid">
              {/* Every round, finished and invisible, in the cell: it takes the tallest one's height. */}
              {FINISHED.map((finished, i) => (
                <div key={i} aria-hidden="true" className="invisible col-start-1 row-start-1">
                  <RoundRows round={finished.round} />
                </div>
              ))}
              <div className="col-start-1 row-start-1">
                <RoundRows round={round} live />
              </div>
            </div>
          </section>
          <section className="min-w-0 bg-gray-50 px-4 pt-3 pb-4 dark:bg-gray-900">
            <Scoreboard state={state} still={still} />
          </section>
        </div>
      </div>
    </div>
  );
}

/** A round's rows, unlit until its steps reach them; the latest one on the accent's light ground. */
function RoundRows({ round, live = false }: { round: RoundState | null; live?: boolean }) {
  const lit = round === null ? -1 : ROWS.indexOf(round.current);
  return (
    <ol aria-live={live ? "off" : undefined} className="space-y-0.5">
      {ROWS.map((kind, i) => (
        <RoundRow
          key={kind}
          kind={kind}
          round={i <= lit ? round : null}
          current={live && i === lit}
        />
      ))}
    </ol>
  );
}

function RoundRow({
  kind,
  round,
  current,
}: {
  kind: RowKind;
  round: RoundState | null;
  current: boolean;
}) {
  const P = S.evolve.player;
  const lit = round !== null;
  return (
    <li
      className={`grid grid-cols-[0.875rem_minmax(0,1fr)] items-start gap-x-1.5 rounded-md px-2 py-1 transition-colors ${
        current ? "bg-brand-50 dark:bg-brand-400/10" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 size-2 rounded-full ${
          lit ? "bg-brand-500 dark:bg-brand-400" : "border border-gray-300 dark:border-gray-600"
        }`}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span
            className={`text-[13px] sm:w-52 sm:shrink-0 ${
              lit ? "text-gray-900 dark:text-gray-100" : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {P.steps[kind]}
          </span>
          {round !== null && <Fact kind={kind} round={round} />}
        </div>
        {round !== null && kind === "change" && round.change?.rule !== undefined && (
          <p className="mt-0.5 text-[12px] leading-5 text-gray-500 dark:text-gray-400">
            {P.rules[round.change.rule]}
          </p>
        )}
        {round !== null && kind === "evaluate" && round.evaluators !== null && (
          <ul className="mt-1 mb-0.5 space-y-px">
            {round.evaluators.map((row) => (
              <EvaluatorLine key={row.caseId} caseId={row.caseId} run={row.run} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const FACT = "font-mono text-[12px] text-gray-700 dark:text-gray-300";

/** What a lit row says, read from the round's state. */
function Fact({ kind, round }: { kind: RowKind; round: RoundState }) {
  const P = S.evolve.player;
  switch (kind) {
    case "reference":
      return (
        <span className={FACT}>
          {P.version(round.reference.version)} · {score(round.reference.score)}
        </span>
      );
    case "trace":
      return round.weakest === null ? null : (
        <span className={FACT}>
          {caseName(round.weakest.id)} · {score(round.weakest.score)}
        </span>
      );
    case "snapshot":
      return <span className={FACT}>{round.snapshot}</span>;
    case "change":
      return round.change === null ? null : (
        <span className={FACT}>
          {round.change.file} +{round.change.added} → {P.version(round.change.version)}
        </span>
      );
    case "evaluate":
      return null;
    case "decide": {
      const decision = round.decision;
      if (decision === null) return null;
      return (
        <span className="inline-flex items-baseline gap-2">
          <span className={FACT}>
            {score(decision.score)}{" "}
            {decision.kept ? ">" : decision.score < decision.referenceScore ? "<" : "="}{" "}
            {score(decision.referenceScore)}
          </span>
          <SitePill tone={decision.kept ? "brand" : "neutral"}>
            {decision.kept ? P.kept : P.rolledBack}
          </SitePill>
        </span>
      );
    }
    case "append":
      return round.appended === null ? null : (
        <span className={FACT}>
          scoreboard.yaml{" "}
          {round.appended ? (
            "+1"
          ) : (
            <span className="font-sans text-gray-500 dark:text-gray-400">{P.notAppended}</span>
          )}
        </span>
      );
  }
}

/** One Evaluator's case: running, then its score and, where recorded, the run's cost and time. */
function EvaluatorLine({ caseId, run }: { caseId: string; run: CaseRun | null }) {
  const P = S.evolve.player;
  return (
    <li className="grid h-5 grid-cols-[minmax(0,1fr)_3.5ch_7.5ch_5.5ch] items-center gap-x-2 font-mono text-[12px] leading-5 tabular-nums">
      <span className="truncate font-sans text-gray-600 dark:text-gray-400">
        {caseName(caseId)}
      </span>
      {run === null ? (
        <span className="col-span-3 inline-flex items-center gap-1.5 font-sans text-gray-500 dark:text-gray-400">
          <SpinnerIcon className="h-3 w-3 animate-spin text-brand-500 dark:text-brand-400" />
          {P.running}
        </span>
      ) : (
        <>
          <span className="text-right font-semibold text-gray-900 dark:text-gray-100">
            {score(run.score)}
          </span>
          <span className="text-right text-gray-600 dark:text-gray-400">
            {run.cost !== undefined ? cost(run.cost) : ""}
          </span>
          <span className="text-right text-gray-600 dark:text-gray-400">
            {run.durationMs !== undefined ? seconds(run.durationMs) : ""}
          </span>
        </>
      )}
    </li>
  );
}

/** A change against the version before, as a whole percentage: none when it rounds to zero. */
function percent(now: number, before: number): Change | null {
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return null;
  return { text: `${change > 0 ? "+" : "\u2212"}${Math.abs(change)}%`, gain: change < 0 };
}

interface Change {
  text: string;
  /** Better than the version before: a higher score, a lower cost or time. */
  gain: boolean;
}

/** The scoreboard: the label's line over the versions, then the newest entry's averages. */
function Scoreboard({ state, still }: { state: EvolveState; still: boolean }) {
  const P = S.evolve.player;
  const recorded = state.scoreboard.filter(
    (point) => point.cost !== undefined && point.durationMs !== undefined,
  );
  const latest = recorded.at(-1);
  const before = recorded.at(-2);
  const gain = latest && before ? latest.score - before.score : 0;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className={PANE_LABEL}>{P.chart}</h3>
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1.5 font-mono">
            <span
              aria-hidden="true"
              className="h-0.5 w-4 rounded-full bg-brand-600 dark:bg-brand-400"
            />
            {SERIES}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full border-[1.5px] border-gray-400 dark:border-gray-500"
            />
            {P.candidate}
          </span>
        </span>
      </div>
      <ScoreChart state={state} still={still} />
      {latest !== undefined && (
        <dl className="mt-2 flex flex-wrap gap-x-7 gap-y-2 border-t border-gray-200 pt-2 dark:border-gray-800">
          <Readout label={P.versionLabel} value={P.version(latest.version)} />
          <Readout
            label={P.score}
            value={score(latest.score)}
            change={
              gain === 0
                ? null
                : { text: `${gain > 0 ? "+" : "\u2212"}${score(Math.abs(gain))}`, gain: gain > 0 }
            }
          />
          <Readout
            label={P.cost}
            value={cost(latest.cost!)}
            unit={P.perCase}
            change={before ? percent(latest.cost!, before.cost!) : null}
          />
          <Readout
            label={P.duration}
            value={seconds(latest.durationMs!)}
            unit={P.perCase}
            change={before ? percent(latest.durationMs!, before.durationMs!) : null}
          />
        </dl>
      )}
    </>
  );
}

/** A small grey label over a dark value; a change against the version before follows the value. */
function Readout({
  label,
  value,
  unit,
  change = null,
}: {
  label: string;
  value: string;
  unit?: string;
  change?: Change | null;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold whitespace-nowrap text-gray-900 tabular-nums dark:text-gray-100">
        {value}
        {unit && (
          <span className="ml-1 text-[11px] font-normal text-gray-500 dark:text-gray-400">
            {unit}
          </span>
        )}
        {change && (
          <span
            className={`ml-1.5 text-[11px] font-medium ${
              change.gain
                ? "text-brand-700 dark:text-brand-300"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {change.text}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * The chart's frame for every state of the script: versions from the first entry to the last a
 * candidate can take, scores in the Evaluation Center's padded domain (every value ever drawn,
 * padded by 10 and rounded out to ticks 20 apart, within 0..100).
 */
const AXIS = (() => {
  const states = Array.from({ length: SCRIPT.steps.length + 1 }, (_, n) => foldEvolve(SCRIPT, n));
  const versions = states.flatMap((s) => [
    ...s.scoreboard.map((point) => point.version),
    ...(s.candidate ? [s.candidate.version] : []),
  ]);
  const scores = states.flatMap((s) => [
    ...s.scoreboard.map((point) => point.score),
    ...(s.candidate ? [s.candidate.score] : []),
  ]);
  const min = Math.max(0, Math.floor((Math.min(...scores) - 10) / 20) * 20);
  const max = Math.min(100, Math.ceil((Math.max(...scores) + 10) / 20) * 20);
  return {
    first: Math.min(...versions),
    last: Math.max(...versions),
    min,
    max,
    ticks: Array.from({ length: (max - min) / 20 + 1 }, (_, i) => min + i * 20),
  };
})();

/** The chart's height follows its width, within these bounds, so it fills its pane beside the round. */
const chartHeight = (width: number) => Math.round(Math.min(290, Math.max(220, width * 0.55)));
const M = { left: 30, right: 18, top: 22, bottom: 24 };

/** The width the chart has: measured, so its text stays at its own size on every screen. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  // Measured before the first paint, so a phone never sees the fallback width.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth > 0) setWidth(el.clientWidth);
    if (!("ResizeObserver" in window)) return;
    const watch = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(Math.round(next));
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, width] as const;
}

function ScoreChart({ state, still }: { state: EvolveState; still: boolean }) {
  const P = S.evolve.player;
  const [ref, width] = useWidth(480);
  const height = chartHeight(width);
  const x = (version: number) =>
    M.left + ((version - AXIS.first) / (AXIS.last - AXIS.first)) * (width - M.left - M.right);
  const y = (value: number) =>
    M.top + ((AXIS.max - value) / (AXIS.max - AXIS.min)) * (height - M.top - M.bottom);
  const points = state.scoreboard;
  // The line through the entries already there; each appended one draws its own segment in.
  const settled = points.filter((point) => point.round === undefined);
  const base = settled
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.version)},${y(p.score)}`)
    .join(" ");
  const newest = points.at(-1);
  const candidate = state.candidate;
  const label = P.chartLabel(
    SERIES,
    points.map((point) => `${P.version(point.version)} ${score(point.score)}`),
    candidate !== null && !candidate.dropped
      ? `${P.version(candidate.version)} ${score(candidate.score)}`
      : null,
  );

  return (
    <div ref={ref} className="mt-2">
      <svg width={width} height={height} role="img" aria-label={label} className="block">
        {AXIS.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={M.left}
              x2={width - M.right}
              y1={y(tick)}
              y2={y(tick)}
              strokeWidth={1}
              className="stroke-gray-200 dark:stroke-gray-800"
            />
            <text
              x={M.left - 8}
              y={y(tick) + 3.5}
              textAnchor="end"
              className="fill-gray-400 text-[11px] tabular-nums dark:fill-gray-500"
            >
              {tick}
            </text>
          </g>
        ))}

        <path
          d={base}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-brand-600 dark:stroke-brand-400"
        />
        {points.map((point, i) =>
          point.round === undefined ? null : (
            <GrowingSegment
              key={point.version}
              d={`M${x(points[i - 1]!.version)},${y(points[i - 1]!.score)} L${x(point.version)},${y(point.score)}`}
              animate={!still}
            />
          ),
        )}

        {candidate !== null && (
          <CandidateMark
            key={`${candidate.version}-${candidate.score}`}
            from={{ x: x(newest!.version), y: y(newest!.score) }}
            at={{ x: x(candidate.version), y: y(candidate.score) }}
            version={P.version(candidate.version)}
            value={score(candidate.score)}
            kept={candidate.kept}
            dropped={candidate.dropped}
            baseline={height - M.bottom}
            animate={!still}
          />
        )}

        {points.map((point) => (
          <ChartPoint
            key={point.version}
            cx={x(point.version)}
            cy={y(point.score)}
            version={P.version(point.version)}
            value={score(point.score)}
            newest={point === newest}
            baseline={height - M.bottom}
            animate={!still && point.round !== undefined}
          />
        ))}
      </svg>
    </div>
  );
}

const EASE = "cubic-bezier(0.2, 0.7, 0.3, 1)";
const DRAW_MS = 900;

/** A segment an append adds, drawn in from the point before it. */
function GrowingSegment({ d, animate }: { d: string; animate: boolean }) {
  const ref = useRef<SVGPathElement>(null);
  useEffect(() => {
    const path = ref.current;
    if (!animate || !path || typeof path.animate !== "function") return;
    const draw = path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: DRAW_MS,
      easing: EASE,
    });
    return () => draw.cancel();
    // Drawn once, when the append mounts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <path
      ref={ref}
      d={d}
      pathLength={1}
      strokeDasharray="1"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      className="stroke-brand-600 dark:stroke-brand-400"
    />
  );
}

/** A scoreboard entry: its point, its score above it and its version under the axis. */
function ChartPoint({
  cx,
  cy,
  version,
  value,
  newest,
  baseline,
  animate,
}: {
  cx: number;
  cy: number;
  version: string;
  value: string;
  newest: boolean;
  baseline: number;
  animate: boolean;
}) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const group = ref.current;
    if (!animate || !group || typeof group.animate !== "function") return;
    // The point lands as its segment finishes drawing.
    const land = group.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 300,
      delay: DRAW_MS - 200,
      easing: EASE,
      fill: "backwards",
    });
    return () => land.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <g ref={ref}>
      <circle cx={cx} cy={cy} r={5} className="fill-gray-50 dark:fill-gray-900" />
      <circle cx={cx} cy={cy} r={3.5} className="fill-brand-600 dark:fill-brand-400" />
      <text
        x={cx}
        y={cy - 10}
        textAnchor="middle"
        className={`text-[11px] tabular-nums ${
          newest
            ? "fill-brand-700 font-semibold dark:fill-brand-300"
            : "fill-gray-500 dark:fill-gray-400"
        }`}
      >
        {value}
      </text>
      <text
        x={cx}
        y={baseline + 16}
        textAnchor="middle"
        className="fill-gray-500 text-[11px] dark:fill-gray-400"
      >
        {version}
      </text>
    </g>
  );
}

/**
 * The candidate from its decision on: a hollow mark at its score, dashed from the newest entry —
 * the accent when it is kept, gray when it is rolled back; a dropped one fades from the chart.
 */
function CandidateMark({
  from,
  at,
  version,
  value,
  kept,
  dropped,
  baseline,
  animate,
}: {
  from: { x: number; y: number };
  at: { x: number; y: number };
  version: string;
  value: string;
  kept: boolean;
  dropped: boolean;
  baseline: number;
  animate: boolean;
}) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const group = ref.current;
    if (!animate || !group || typeof group.animate !== "function") return;
    const appear = group.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: EASE });
    return () => appear.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stroke = kept
    ? "stroke-brand-500 dark:stroke-brand-400"
    : "stroke-gray-400 dark:stroke-gray-500";
  const ink = kept ? "fill-brand-700 dark:fill-brand-300" : "fill-gray-500 dark:fill-gray-400";
  return (
    <g
      ref={ref}
      className={`transition-opacity duration-700 ${dropped ? "opacity-0" : "opacity-100"}`}
    >
      <line
        x1={from.x}
        y1={from.y}
        x2={at.x}
        y2={at.y}
        strokeWidth={1.5}
        strokeDasharray="3 3"
        className={stroke}
      />
      <circle
        cx={at.x}
        cy={at.y}
        r={4.5}
        strokeWidth={1.5}
        className={`fill-gray-50 dark:fill-gray-900 ${stroke}`}
      />
      <text
        x={at.x}
        y={at.y - 10}
        textAnchor="middle"
        className={`text-[11px] font-semibold tabular-nums ${ink}`}
      >
        {value}
      </text>
      <text x={at.x} y={baseline + 16} textAnchor="middle" className={`text-[11px] ${ink}`}>
        {version}
      </text>
    </g>
  );
}

/**
 * An entry of a catalogue row: plain text on the page, no box of its own, with its one-line
 * description under it.
 */
const ENTRY = "inline-flex items-center gap-1 text-sm font-medium text-gray-800 dark:text-gray-200";
const ENTRY_LINK = `${ENTRY} underline-offset-4 decoration-gray-300 transition-colors hover:text-gray-950 hover:underline dark:decoration-gray-600 dark:hover:text-white`;
const ENTRY_NOTE = "mt-0.5 block text-gray-500 dark:text-gray-400";

/** A repository's name, from its URL: what a Benchmark is drawn from. */
const repoName = (href: string) => new URL(href).pathname.split("/").filter(Boolean).at(-1) ?? "";

/** The algorithms the loop runs and the Benchmarks it is scored on, each linked to its source. */
function Catalogue() {
  const E = S.evolve;
  return (
    <ExternalLinkScope>
      <dl className="mt-12 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        <CatalogueRow label={E.algorithmsLabel}>
          {RSI_TOOLKITS.map((toolkit) => (
            <li key={toolkit.plugin} className="min-w-0">
              {toolkit.href !== null ? (
                <ExternalLink href={toolkit.href} className={ENTRY_LINK}>
                  {toolkit.label}
                  <ExternalLinkIcon className="h-3 w-3 text-gray-400 dark:text-gray-500" />
                </ExternalLink>
              ) : (
                <span className={ENTRY}>{toolkit.label}</span>
              )}
              <span className={`${ENTRY_NOTE} text-xs`}>
                {E.algorithmDescriptions[toolkit.plugin]}
              </span>
            </li>
          ))}
        </CatalogueRow>
        <CatalogueRow label={E.benchmarksLabel}>
          {BENCHMARKS.map((benchmark, i) => (
            <li key={benchmark.href} className="min-w-0">
              <ExternalLink href={benchmark.href} className={ENTRY_LINK}>
                {E.benchmarkKinds[i]}
                <ExternalLinkIcon className="h-3 w-3 text-gray-400 dark:text-gray-500" />
              </ExternalLink>
              <span className={`${ENTRY_NOTE} font-mono text-[11px]`}>
                {repoName(benchmark.href)}
              </span>
            </li>
          ))}
        </CatalogueRow>
      </dl>
    </ExternalLinkScope>
  );
}

function CatalogueRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 py-5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-6">
      <dt className="text-sm font-semibold text-gray-500 dark:text-gray-400">{label}</dt>
      <dd>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          {children}
        </ul>
      </dd>
    </div>
  );
}

function PauseGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
      <rect x="14" y="4" width="4" height="16" rx="1" />
      <rect x="6" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PlayGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
      <path d="M6 3l14 9-14 9V3Z" />
    </svg>
  );
}
