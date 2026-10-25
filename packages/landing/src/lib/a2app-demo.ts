/**
 * The runs the home page's A2APP player replays: one per mini app on the Web App's start page
 * (the legal agent's contract desk, the docs expert's Q&A, the analyst's market board), scripted
 * by hand (no model was called). What happens and in what order follows the product as it ships:
 *
 * - one sentence in Chat asks for the agent and its workbench; the agent writes the workbench's
 *   files (`package.json`, the server code in `index.ts`, the page in `ui/index.html`) and reads
 *   `.build/status.json`, where the server reports whether the workbench loaded;
 * - the server loads every version that type-checks, so the workbench's tab appears beside Chat
 *   on the first load, and every load is a version in its History (newest current, older ones
 *   restorable);
 * - the workbench's server calls the agent over the host API, never through the page: it opens a
 *   Session (`createSession`), sends it text one turn at a time (`run`), and polls a snapshot of
 *   the turn (`sessionResult`, running until the turn ends, then completed); the agent sees only
 *   that text, and the page shows what the server makes of the answer;
 * - asking in Chat for a change makes the same agent edit the workbench's files; the edit loads
 *   as a new version and the open tab reloads by itself.
 *
 * The words come from the dictionaries (`a2app.player.runs`), handed to `a2appScenarios`, so
 * this module holds no copy and both languages replay the same steps. The file names, revisions,
 * clock times and percentages are illustrative. test/a2app-demo.test.ts holds the runs to the
 * rules above.
 */

export type ScenarioId = "legal" | "docs" | "market";

/** A contract on the desk, as its page lists it. */
export interface ContractRow {
  name: string;
  status: "queued" | "running" | "done";
  /** Read from the agent's review; shown once the page has a risk column. */
  risk: "high" | "medium" | null;
}

export interface SectorRow {
  name: string;
  change: string;
  note: string;
  source: string;
}

/** The workbench's page: what each mini app shows, at one moment. */
export type AppPage =
  | { kind: "contracts"; riskColumn: boolean; files: ContractRow[] }
  | {
      kind: "answers";
      question: string | null;
      answer: null | { status: "running" } | { status: "done"; text: string; sources: string[] };
    }
  | { kind: "board"; updated: string | null; refreshing: boolean; sectors: SectorRow[] };

/** A call the workbench's server makes to its agent. */
export type HostCall =
  | { method: "createSession" }
  | {
      method: "run";
      text: string;
      /** The clock time a scheduled call fires at (the market board refreshes on a timer). */
      at?: string;
    }
  | { method: "sessionResult"; status: "running" | "completed" };

/** What a step adds, and how long the replay waits before showing it. */
export type A2appStep = { ms: number } & (
  | { kind: "say"; text: string }
  | { kind: "tool"; tool: "write_file" | "edit_file"; path: string }
  | { kind: "load"; revision: string; page: AppPage }
  | { kind: "reply"; text: string }
  | { kind: "use"; page: AppPage }
  | { kind: "host"; call: HostCall; page?: AppPage }
  | { kind: "history" }
);

export interface A2appScenario {
  id: ScenarioId;
  steps: A2appStep[];
}

/** The words the runs need, per scenario: a dictionary's `a2app.player.runs`. */
export interface A2appWords {
  legal: {
    ask: string;
    built: string;
    review: (file: string) => string;
    edit: string;
    edited: string;
  };
  docs: {
    ask: string;
    built: string;
    question: string;
    answer: string;
  };
  market: {
    ask: string;
    built: string;
    refresh: string;
    sectors: readonly { name: string; note: string; source: string }[];
  };
}

/** The three files every workbench starts with, written in this order. */
const BUILD: A2appStep[] = [
  { kind: "tool", tool: "write_file", path: "package.json", ms: 1100 },
  { kind: "tool", tool: "write_file", path: "index.ts", ms: 800 },
  { kind: "tool", tool: "write_file", path: "ui/index.html", ms: 800 },
];

const NDA = "NDA-2026.pdf";
const MSA = "MSA-2026.pdf";

const contracts = (riskColumn: boolean, ...files: ContractRow[]): AppPage => ({
  kind: "contracts",
  riskColumn,
  files,
});

function legal(w: A2appWords["legal"]): A2appScenario {
  const ndaDone: ContractRow = { name: NDA, status: "done", risk: "medium" };
  const msaDone: ContractRow = { name: MSA, status: "done", risk: "high" };
  return {
    id: "legal",
    steps: [
      { kind: "say", text: w.ask, ms: 700 },
      ...BUILD,
      { kind: "load", revision: "4f2a9c1e07b3", page: contracts(false), ms: 900 },
      { kind: "reply", text: w.built, ms: 900 },
      {
        kind: "use",
        page: contracts(
          false,
          { name: NDA, status: "queued", risk: null },
          { name: MSA, status: "queued", risk: null },
        ),
        ms: 1400,
      },
      { kind: "host", call: { method: "createSession" }, ms: 900 },
      { kind: "host", call: { method: "run", text: w.review(NDA) }, ms: 800 },
      {
        kind: "host",
        call: { method: "sessionResult", status: "running" },
        page: contracts(
          false,
          { name: NDA, status: "running", risk: null },
          { name: MSA, status: "queued", risk: null },
        ),
        ms: 800,
      },
      {
        kind: "host",
        call: { method: "sessionResult", status: "completed" },
        page: contracts(false, ndaDone, { name: MSA, status: "queued", risk: null }),
        ms: 1800,
      },
      { kind: "host", call: { method: "run", text: w.review(MSA) }, ms: 900 },
      {
        kind: "host",
        call: { method: "sessionResult", status: "running" },
        page: contracts(false, ndaDone, { name: MSA, status: "running", risk: null }),
        ms: 800,
      },
      {
        kind: "host",
        call: { method: "sessionResult", status: "completed" },
        page: contracts(false, ndaDone, msaDone),
        ms: 1800,
      },
      { kind: "say", text: w.edit, ms: 1400 },
      { kind: "tool", tool: "edit_file", path: "ui/index.html", ms: 1100 },
      // The riskiest contract first, as the edit asked.
      { kind: "load", revision: "b81d36e5a0c9", page: contracts(true, msaDone, ndaDone), ms: 900 },
      { kind: "reply", text: w.edited, ms: 900 },
      { kind: "history", ms: 1200 },
    ],
  };
}

function docs(w: A2appWords["docs"]): A2appScenario {
  return {
    id: "docs",
    steps: [
      { kind: "say", text: w.ask, ms: 700 },
      ...BUILD,
      {
        kind: "load",
        revision: "7c03e5d91a24",
        page: { kind: "answers", question: null, answer: null },
        ms: 900,
      },
      { kind: "reply", text: w.built, ms: 900 },
      {
        kind: "use",
        page: { kind: "answers", question: w.question, answer: null },
        ms: 1400,
      },
      { kind: "host", call: { method: "createSession" }, ms: 900 },
      { kind: "host", call: { method: "run", text: w.question }, ms: 800 },
      {
        kind: "host",
        call: { method: "sessionResult", status: "running" },
        page: { kind: "answers", question: w.question, answer: { status: "running" } },
        ms: 800,
      },
      {
        kind: "host",
        call: { method: "sessionResult", status: "completed" },
        page: {
          kind: "answers",
          question: w.question,
          answer: { status: "done", text: w.answer, sources: ["hooks.md", "settings.md"] },
        },
        ms: 2000,
      },
    ],
  };
}

/** Each refresh's change per sector, in the order of the dictionary's sectors. */
const CHANGES = {
  "10:00": ["+2.1%", "+1.4%", "−0.3%"],
  "10:05": ["+2.4%", "+1.2%", "−0.2%"],
} as const;

function market(w: A2appWords["market"]): A2appScenario {
  const board = (time: keyof typeof CHANGES | null, refreshing: boolean): AppPage => ({
    kind: "board",
    updated: time,
    refreshing,
    sectors:
      time === null
        ? []
        : w.sectors.map((sector, i) => ({ ...sector, change: CHANGES[time][i] ?? "" })),
  });
  return {
    id: "market",
    steps: [
      { kind: "say", text: w.ask, ms: 700 },
      ...BUILD,
      { kind: "load", revision: "e95b20c4f716", page: board(null, false), ms: 900 },
      { kind: "reply", text: w.built, ms: 900 },
      { kind: "host", call: { method: "createSession" }, ms: 1400 },
      { kind: "host", call: { method: "run", text: w.refresh, at: "10:00" }, ms: 800 },
      {
        kind: "host",
        call: { method: "sessionResult", status: "running" },
        page: board(null, true),
        ms: 800,
      },
      {
        kind: "host",
        call: { method: "sessionResult", status: "completed" },
        page: board("10:00", false),
        ms: 1800,
      },
      { kind: "host", call: { method: "run", text: w.refresh, at: "10:05" }, ms: 1600 },
      {
        kind: "host",
        call: { method: "sessionResult", status: "running" },
        page: board("10:00", true),
        ms: 800,
      },
      {
        kind: "host",
        call: { method: "sessionResult", status: "completed" },
        page: board("10:05", false),
        ms: 1800,
      },
    ],
  };
}

/** The three runs, in the player's tab order, in the words handed in. */
export function a2appScenarios(words: A2appWords): A2appScenario[] {
  return [legal(words.legal), docs(words.docs), market(words.market)];
}
