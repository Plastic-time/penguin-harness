/**
 * A2APP: an agent builds a mini app of its own and the app calls the agent. The player replays
 * one run per start-page starter (lib/a2app-demo.ts), then the recording of the legal app with
 * what five sample reviews cost, then the post.
 *
 * The player has two panes. Chat holds the person's sentences, the agent's tool calls and its
 * replies. The app pane holds the Web App's window, where the workbench's tab appears beside Chat
 * on its first load with its page under it, and under the window the calls the workbench's
 * server makes to the agent over the host API. Colour says who acts: the person on gray, the
 * agent's calls on the brand tint, the app's calls to the agent on amber (the /amsp page's tones
 * for model records and events), with the host block's heading as its legend.
 *
 * Paced by each step's scripted wait (lib/a2app-replay.ts `stepDelays`), one timer at a time,
 * only while the player is on screen and not paused; after the last step it rests, then plays
 * again. Under reduced motion it shows each run finished and never plays. Each pane renders every
 * run finished and invisible in the same grid cell, so it holds the tallest one's height and
 * nothing below it moves during a replay or on a tab change.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Link } from "react-router";
import { SitePill, useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteLocale as Locale } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { Section } from "../components/section";
import { DemoVideo } from "../components/demo-video";
import { ArrowRightIcon, PauseGlyph, PlayGlyph } from "../components/icons";
import { demoVideoUrl } from "../lib/links";
import { a2appScenarios } from "../lib/a2app-demo";
import type { A2appScenario, AppPage, ContractRow, HostCall } from "../lib/a2app-demo";
import { foldRun, stepDelays } from "../lib/a2app-replay";
import type { A2appState, ChatLine } from "../lib/a2app-replay";
import { usePrefersReducedMotion } from "../lib/reduced-motion";
import { TONES } from "../lib/amsp-tones";
import posterZh from "../assets/shots/legal-app-zh.webp";
import posterEn from "../assets/shots/legal-app-en.webp";
import "./a2app.css";

/** The recording and its title-frame poster, per language. */
const DEMO: Record<Locale, { video: string; poster: string }> = {
  zh: { video: demoVideoUrl("legal_app_zh"), poster: posterZh },
  en: { video: demoVideoUrl("legal_app_en"), poster: posterEn },
};

const POST = "/blog/from-a2ui-to-a2app";

export function A2app() {
  const { locale } = useSiteLocale();
  const demo = DEMO[locale];
  const a = S.a2app;

  return (
    <Section id="a2app" title={a.title} subtitle={a.subtitle}>
      <div className="mx-auto max-w-5xl">
        <A2appPlayer />
        <figure className="mt-12 sm:mt-16">
          <DemoVideo src={demo.video} poster={demo.poster} label={a.recording.label} />
          <figcaption className="mt-3 text-center text-[13px] font-semibold text-brand-700 dark:text-brand-300">
            {a.recording.cost}
          </figcaption>
        </figure>
        <p className="mt-6 text-center">
          <Link
            to={POST}
            className="group inline-flex items-center gap-1.5 text-[15px] font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
          >
            {a.link}
            <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </p>
      </div>
    </Section>
  );
}

/** The finished run stays on screen this long before it plays again. */
const REST_MS = 3000;

const PANE_LABEL = "text-xs font-semibold text-gray-500 dark:text-gray-400";
/**
 * The /amsp page's family tones: the agent's own calls take the model's, the app's calls to the
 * agent the event's.
 */
const AGENT_ROW = `rounded-sm ${TONES.model.ground}`;
const AGENT_INK = TONES.model.ink;
const HOST_ROW = `rounded-sm ${TONES.event.ground}`;
const HOST_INK = TONES.event.ink;

function A2appPlayer() {
  const still = usePrefersReducedMotion();
  // The dictionaries hold the runs' words; the tree remounts when the language changes.
  const scenarios = useMemo(() => a2appScenarios(S.a2app.player.runs), []);
  const finished = useMemo(
    () => scenarios.map((scenario) => foldRun(scenario.steps, scenario.steps.length)),
    [scenarios],
  );
  const delays = useMemo(
    () => scenarios.map((scenario) => stepDelays(scenario.steps)),
    [scenarios],
  );
  const [index, setIndex] = useState(0);
  const scenario = scenarios[index]!;
  const total = scenario.steps.length;
  // The finished run until the player first comes on screen.
  const [count, setCount] = useState(total);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabsId = useId();

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

  // The first time it is seen, the run starts from its first step.
  useEffect(() => {
    if (visible && !playing && !still) {
      setPlaying(true);
      setCount(0);
    }
  }, [visible, playing, still]);

  // One step at a time; after the last, a rest, then from the start again.
  useEffect(() => {
    if (!playing || still || paused || !visible) return;
    const timer = window.setTimeout(
      () => setCount((shown) => (shown < total ? shown + 1 : 0)),
      count < total ? delays[index]![count]! : REST_MS,
    );
    return () => window.clearTimeout(timer);
  }, [playing, still, paused, visible, count, total, index, delays]);

  const choose = (next: number) => {
    setIndex(next);
    // Paused or still, a new tab shows its run finished; otherwise it plays from the start.
    setCount(still || paused ? scenarios[next]!.steps.length : 0);
    setPlaying(!still);
  };

  const onTabKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + scenarios.length) % scenarios.length;
    choose(next);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };

  const state = useMemo(() => foldRun(scenario.steps, count), [scenario, count]);
  const P = S.a2app.player;

  return (
    <div ref={rootRef}>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-left dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-200 px-3 pt-1.5 dark:border-gray-800">
          <span id={`${tabsId}-label`} className={`pb-1 ${PANE_LABEL}`}>
            {P.label}
          </span>
          <div
            ref={tabsRef}
            role="tablist"
            aria-labelledby={`${tabsId}-label`}
            className="flex flex-wrap gap-1"
            onKeyDown={onTabKey}
          >
            {scenarios.map((candidate, i) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                id={`${tabsId}-tab-${candidate.id}`}
                aria-controls={`${tabsId}-panel`}
                aria-selected={i === index}
                tabIndex={i === index ? 0 : -1}
                onClick={() => choose(i)}
                className="rounded-t-md border-b-2 border-transparent px-2.5 py-1 text-[13px] whitespace-nowrap text-gray-500 transition-colors hover:text-gray-900 aria-selected:border-brand-600 aria-selected:font-medium aria-selected:text-brand-700 dark:text-gray-400 dark:hover:text-gray-100 dark:aria-selected:border-brand-400 dark:aria-selected:text-brand-300"
              >
                {P.scenarios[candidate.id]}
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
          id={`${tabsId}-panel`}
          aria-labelledby={`${tabsId}-tab-${scenario.id}`}
          className="grid gap-px bg-gray-200 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] dark:bg-gray-800"
        >
          {/*
           * Each pane holds every run's finished pane, invisible, in its own cell, so it takes the
           * tallest one's height: stacked on a phone, the app pane starts at the same place
           * whichever run plays and however far it has got.
           */}
          <section className="grid min-w-0 bg-gray-50 dark:bg-gray-900">
            {scenarios.map((candidate, i) => (
              <div key={candidate.id} aria-hidden="true" className={`invisible ${CELL}`}>
                <ChatPane state={finished[i]!} />
              </div>
            ))}
            <div className={CELL}>
              <ChatPane state={state} live />
            </div>
          </section>
          <section className="grid min-w-0 bg-gray-50 dark:bg-gray-900">
            {scenarios.map((candidate, i) => (
              <div key={candidate.id} aria-hidden="true" className={`invisible ${CELL}`}>
                <AppPane scenario={candidate} state={finished[i]!} />
              </div>
            ))}
            <div className={CELL}>
              <AppPane scenario={scenario} state={state} live />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One layer of a pane's stack: every layer sits in the same grid cell. */
const CELL = "col-start-1 row-start-1 min-w-0 px-4 pt-3 pb-4";

/** A row that a step adds comes in with a fade; the invisible finished copies need none. */
const enterClass = (live: boolean) => (live ? "a2app-enter" : "");

/** Chat: the person's sentences, the agent's tool calls and its replies. */
function ChatPane({ state, live = false }: { state: A2appState; live?: boolean }) {
  const P = S.a2app.player;
  const enter = enterClass(live);
  return (
    <>
      <h3 className={PANE_LABEL}>{P.chat}</h3>
      <ol aria-live="off" className="mt-2.5 space-y-1.5">
        {state.chat.map((line, i) => (
          <ChatRow key={i} line={line} enter={enter} />
        ))}
      </ol>
    </>
  );
}

/** The app: the Web App's window with the workbench in it, then its calls to the agent. */
function AppPane({
  scenario,
  state,
  live = false,
}: {
  scenario: A2appScenario;
  state: A2appState;
  live?: boolean;
}) {
  const P = S.a2app.player;
  const enter = enterClass(live);
  return (
    <>
      <h3 className={PANE_LABEL}>{P.app}</h3>
      <AppWindow scenario={scenario} state={state} enter={enter} />
      {state.host.length > 0 && (
        <div className="mt-4">
          <h4 className={`text-xs font-semibold ${HOST_INK}`}>{P.hostCalls}</h4>
          <ol aria-live="off" className="mt-2 space-y-1 font-mono text-[12px] leading-5">
            {state.host.map((call, i) => (
              <HostRow key={i} call={call} enter={enter} />
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

/** A Chat row: the person's sentence on gray, the agent's tool call on its tint, its reply plain. */
function ChatRow({ line, enter }: { line: ChatLine; enter: string }) {
  const P = S.a2app.player;
  switch (line.kind) {
    case "say":
      return (
        <li
          className={`rounded-md bg-gray-100 px-2.5 py-2 text-[13px] leading-5 text-gray-900 dark:bg-gray-800 dark:text-gray-100 ${enter}`}
        >
          {line.text}
        </li>
      );
    case "reply":
      return (
        <li
          className={`px-2.5 py-1 text-[13px] leading-5 text-gray-800 dark:text-gray-200 ${enter}`}
        >
          {line.text}
        </li>
      );
    case "tool":
    case "load":
      return (
        <li
          className={`grid grid-cols-[10ch_minmax(0,1fr)] gap-x-2 px-2.5 py-1 font-mono text-[12px] leading-5 ${AGENT_ROW} ${enter}`}
        >
          <span className={AGENT_INK}>{line.kind === "tool" ? line.tool : "read_file"}</span>
          <span className="text-gray-700 [overflow-wrap:anywhere] dark:text-gray-300">
            {line.kind === "tool" ? (
              line.path
            ) : (
              <>
                .build/status.json <span className="text-gray-400 dark:text-gray-500">→</span>{" "}
                <span className={`font-semibold ${AGENT_INK}`}>{P.loaded}</span>
              </>
            )}
          </span>
        </li>
      );
  }
}

/** A call from the workbench's server to the agent, with what it answered. */
function HostRow({ call, enter }: { call: HostCall; enter: string }) {
  // The text a turn sends wraps as one piece, not at a hyphen inside it.
  const args =
    call.method === "createSession" ? (
      "()"
    ) : call.method === "run" ? (
      <>
        (sessionId, [{"{ "}text: <span className="whitespace-nowrap">"{call.text}"</span>
        {" }"}])
      </>
    ) : (
      "(sessionId)"
    );
  const result =
    call.method === "createSession"
      ? { text: "{ sessionId }", tone: "text-gray-600 dark:text-gray-300" }
      : call.method === "sessionResult"
        ? call.status === "completed"
          ? { text: "completed", tone: `font-semibold ${AGENT_INK}` }
          : { text: "running", tone: "text-gray-500 dark:text-gray-400" }
        : null;
  return (
    <li className={`px-2.5 py-1 [overflow-wrap:break-word] ${HOST_ROW} ${enter}`}>
      {call.method === "run" && call.at !== undefined && (
        <span className="mr-2 text-gray-500 tabular-nums dark:text-gray-400">{call.at}</span>
      )}
      <span className={HOST_INK}>host.{call.method}</span>
      <span className="text-gray-700 dark:text-gray-300">{args}</span>
      {result && (
        <>
          {" "}
          <span className="text-gray-400 dark:text-gray-500">→</span>{" "}
          <span className={result.tone}>{result.text}</span>
        </>
      )}
    </li>
  );
}

/**
 * The Web App's window: its tab strip, where the workbench's tab appears beside Chat on the
 * first load with its revision and History, the History list once opened, then the page.
 */
function AppWindow({
  scenario,
  state,
  enter,
}: {
  scenario: A2appScenario;
  state: A2appState;
  enter: string;
}) {
  const P = S.a2app.player;
  const loaded = state.page !== null;
  return (
    <div className="mt-2.5 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      <div className="flex min-h-9 flex-wrap items-stretch gap-x-1 border-b border-gray-200 px-2 dark:border-gray-800">
        <span className="flex items-center border-b-2 border-transparent px-2 text-xs text-gray-500 dark:text-gray-400">
          {P.chat}
        </span>
        {loaded && (
          <>
            <span
              className={`flex items-center border-b-2 border-brand-600 px-2 text-xs font-medium text-gray-900 dark:border-brand-400 dark:text-gray-100 ${enter}`}
            >
              {P.scenarios[scenario.id]}
            </span>
            <span className={`ml-auto flex items-center gap-2.5 py-1.5 ${enter}`}>
              <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
                {state.versions[0]}
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 text-xs whitespace-nowrap ${
                  state.historyOpen
                    ? "border-gray-300 bg-gray-100 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    : "border-gray-200 text-gray-600 dark:border-gray-800 dark:text-gray-300"
                }`}
              >
                {P.history}
              </span>
            </span>
          </>
        )}
      </div>
      {loaded && state.historyOpen && (
        <ul
          className={`divide-y divide-gray-100 border-b border-gray-200 dark:divide-gray-800 dark:border-gray-800 ${enter}`}
        >
          {state.versions.map((revision, i) => (
            <li key={revision} className="flex items-center gap-3 px-3 py-1.5 text-xs">
              <span className="font-mono text-gray-700 dark:text-gray-300">{revision}</span>
              <span className="flex-1" />
              {i === 0 ? (
                <span className={AGENT_INK}>{P.current}</span>
              ) : (
                <span className="rounded-md border border-gray-200 px-2 py-0.5 text-gray-600 dark:border-gray-800 dark:text-gray-300">
                  {P.restore}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {state.page && (
        <div className={`p-3 ${enter}`}>
          <Page page={state.page} />
        </div>
      )}
    </div>
  );
}

function Page({ page }: { page: AppPage }) {
  switch (page.kind) {
    case "contracts":
      return <ContractDesk riskColumn={page.riskColumn} files={page.files} />;
    case "answers":
      return <DocsQa question={page.question} answer={page.answer} />;
    case "board":
      return <MarketBoard page={page} />;
  }
}

const TH = "pb-1 text-left text-[11px] font-medium text-gray-500 dark:text-gray-400";
const TD = "border-t border-gray-100 py-1.5 align-middle dark:border-gray-800";

const STATUS_TONE = { queued: "neutral", running: "brand-outline", done: "brand" } as const;

function ContractDesk({ riskColumn, files }: { riskColumn: boolean; files: ContractRow[] }) {
  const W = S.a2app.player.page;
  return (
    <div className="space-y-3 text-[13px]">
      <div className="rounded-md border border-dashed border-gray-300 py-2.5 text-center text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {W.upload}
      </div>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-[40%]`}>{W.file}</th>
            {riskColumn && <th className={TH}>{W.risk}</th>}
            <th className={TH}>{W.status}</th>
            <th className={TH}>{W.report}</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.name}>
              <td
                className={`${TD} truncate font-mono text-[12px] text-gray-900 dark:text-gray-100`}
              >
                {file.name}
              </td>
              {riskColumn && (
                <td className={`${TD} text-gray-900 dark:text-gray-100`}>
                  {file.risk === null ? "" : W.risks[file.risk]}
                </td>
              )}
              <td className={TD}>
                <SitePill tone={STATUS_TONE[file.status]}>{W.statuses[file.status]}</SitePill>
              </td>
              <td className={TD}>
                {file.status === "done" ? (
                  <span className="text-brand-700 underline decoration-brand-300 underline-offset-2 dark:text-brand-300 dark:decoration-brand-700">
                    {W.download}
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** An answer's `[n]` marks, drawn as citations. */
function withCitations(text: string): ReactNode[] {
  return text.split(/(\[\d+\])/).map((part, i) =>
    /^\[\d+\]$/.test(part) ? (
      <span key={i} className={`text-[11px] ${AGENT_INK}`}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function DocsQa({
  question,
  answer,
}: {
  question: string | null;
  answer: Extract<AppPage, { kind: "answers" }>["answer"];
}) {
  const W = S.a2app.player.page;
  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex gap-2">
        <div className="min-h-8 min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 leading-5 text-gray-900 dark:border-gray-700 dark:text-gray-100">
          {question}
        </div>
        <span className="flex items-center rounded-md bg-gray-900 px-3 font-medium whitespace-nowrap text-white dark:bg-gray-100 dark:text-gray-900">
          {W.ask}
        </span>
      </div>
      {answer?.status === "running" && <SitePill tone="brand-outline">{W.answering}</SitePill>}
      {answer?.status === "done" && (
        <div className="space-y-2">
          <p className="leading-6 text-gray-800 dark:text-gray-200">{withCitations(answer.text)}</p>
          <p className="flex flex-wrap gap-x-3 text-xs text-gray-500 dark:text-gray-400">
            <span>{W.sources}</span>
            {answer.sources.map((source, i) => (
              <span key={source}>
                <span className={AGENT_INK}>[{i + 1}]</span>{" "}
                <span className="font-mono">{source}</span>
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

function MarketBoard({ page }: { page: Extract<AppPage, { kind: "board" }> }) {
  const W = S.a2app.player.page;
  return (
    <div className="space-y-2 text-[13px]">
      <div className="flex h-6 items-center justify-between gap-3 text-xs text-gray-500 tabular-nums dark:text-gray-400">
        <span>{page.updated !== null && W.updated(page.updated)}</span>
        {page.refreshing && <SitePill tone="brand-outline">{W.refreshing}</SitePill>}
      </div>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-[30%]`}>{W.sector}</th>
            <th className={`${TH} w-[18%]`}>{W.change}</th>
            <th className={TH}>{W.factor}</th>
          </tr>
        </thead>
        <tbody>
          {page.sectors.map((sector) => (
            <tr key={sector.name}>
              <td className={`${TD} truncate text-gray-900 dark:text-gray-100`}>{sector.name}</td>
              <td className={`${TD} text-gray-900 tabular-nums dark:text-gray-100`}>
                {sector.change}
              </td>
              <td className={`${TD} leading-5`}>
                <span className="text-gray-800 dark:text-gray-200">{sector.note}</span>
                <span className="block text-[11px] text-gray-500 tabular-nums dark:text-gray-400">
                  {sector.source}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
