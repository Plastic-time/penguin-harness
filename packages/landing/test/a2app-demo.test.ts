/**
 * The A2APP player's runs, and the panes it folds them into. The runs are scripted by hand, so
 * this is what stops an edit from replaying something the product does not do, in either
 * language.
 *
 * - Given any run, it starts with the person's sentence in Chat and ends with the workbench
 *   loaded and serving.
 * - Given a run before the workbench's first load, there is no tab for it and nothing calls its
 *   agent; from that load on, the tab is there.
 * - Given the calls the workbench makes, its agent works turn by turn: a Session is opened before
 *   the first `run`, and every `run` is answered by a `sessionResult` that ends `completed` before
 *   the next `run` goes out.
 * - Given a `sessionResult` poll that follows a running one, it replaces that row instead of adding
 *   one, and the next turn starts a row of its own.
 * - Given an edit asked for in Chat, the agent edits the workbench's files and the edit loads as a
 *   new current version, the one before it kept to restore; the contract desk then shows what was
 *   asked, a risk column with the riskiest contract first.
 * - Given a revision that loaded before (a restore), it moves to the front of History rather than
 *   appearing twice.
 * - Given any frame of a replay, it holds no more rows than the finished run, which is what the
 *   panel's height is reserved for, and the last frame is the finished run.
 * - Given the script's waits, the replay holds every step within its bounds.
 */
import { describe, expect, it } from "vitest";
import { a2appScenarios } from "../src/lib/a2app-demo";
import type { A2appStep, AppPage } from "../src/lib/a2app-demo";
import { foldRun, MAX_STEP_MS, MIN_STEP_MS, stepDelays } from "../src/lib/a2app-replay";
import type { A2appState } from "../src/lib/a2app-replay";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const LANGUAGES = [
  ["zh", a2appScenarios(zh.a2app.player.runs)],
  ["en", a2appScenarios(en.a2app.player.runs)],
] as const;

const contracts = (riskColumn = false): AppPage => ({ kind: "contracts", riskColumn, files: [] });
const load = (revision: string): A2appStep => ({
  kind: "load",
  revision,
  page: contracts(),
  ms: 900,
});

/** The rows a page shows: what grows its height as a run goes on. */
function pageRows(page: AppPage | null): number {
  if (page === null) return 0;
  switch (page.kind) {
    case "contracts":
      return page.files.length;
    case "board":
      return page.sectors.length;
    case "answers":
      return (page.question === null ? 0 : 1) + (page.answer?.status === "done" ? 2 : 0);
  }
}

describe.each(LANGUAGES)("the A2APP runs (%s)", (_, scenarios) => {
  it.each(scenarios)("$id starts with the person's sentence and ends serving", ({ steps }) => {
    expect(steps[0]?.kind).toBe("say");
    const finished = foldRun(steps, steps.length);
    expect(finished.chat[0]?.kind).toBe("say");
    expect(finished.page).not.toBeNull();
    expect(finished.versions.length).toBeGreaterThan(0);
  });

  it.each(scenarios)(
    "$id has no tab and no calls to the agent before its first load",
    ({ steps }) => {
      const firstLoad = steps.findIndex((step) => step.kind === "load");
      expect(firstLoad).toBeGreaterThan(0);
      for (let count = 0; count <= firstLoad; count++) {
        const state = foldRun(steps, count);
        expect(state.page).toBeNull();
        expect(state.host).toEqual([]);
      }
      for (let count = firstLoad + 1; count <= steps.length; count++) {
        expect(foldRun(steps, count).page).not.toBeNull();
      }
    },
  );

  it.each(scenarios)("$id calls its agent one turn at a time", ({ steps }) => {
    let session = false;
    let turnOpen = false;
    let turns = 0;
    for (const step of steps) {
      if (step.kind !== "host") continue;
      const { call } = step;
      if (call.method === "createSession") session = true;
      if (call.method === "run") {
        expect(session).toBe(true);
        expect(turnOpen).toBe(false);
        turnOpen = true;
        turns += 1;
      }
      if (call.method === "sessionResult") {
        expect(turnOpen).toBe(true);
        if (call.status === "completed") turnOpen = false;
      }
    }
    expect(turns).toBeGreaterThan(0);
    expect(turnOpen).toBe(false);
  });

  it.each(scenarios)("$id never shows a frame larger than its finished run", ({ steps }) => {
    const finished = foldRun(steps, steps.length);
    for (let count = 0; count <= steps.length; count++) {
      const state: A2appState = foldRun(steps, count);
      expect(state.chat.length).toBeLessThanOrEqual(finished.chat.length);
      expect(state.host.length).toBeLessThanOrEqual(finished.host.length);
      expect(state.versions.length).toBeLessThanOrEqual(finished.versions.length);
      expect(pageRows(state.page)).toBeLessThanOrEqual(pageRows(finished.page));
      if (state.historyOpen) expect(finished.historyOpen).toBe(true);
    }
    expect(foldRun(steps, steps.length)).toEqual(finished);
  });

  it("an edit asked for in Chat loads as a new version, the earlier one kept to restore", () => {
    const { steps } = scenarios.find((scenario) => scenario.id === "legal")!;
    const edit = steps.findIndex((step) => step.kind === "tool" && step.tool === "edit_file");
    expect(steps.slice(0, edit).at(-1)?.kind).toBe("say");
    const reload = steps.findIndex((step, i) => i > edit && step.kind === "load");
    expect(reload).toBeGreaterThan(edit);

    const before = foldRun(steps, edit + 1);
    const after = foldRun(steps, reload + 1);
    expect(after.versions).toHaveLength(before.versions.length + 1);
    expect(after.versions.slice(1)).toEqual(before.versions);
    expect(after.page).toMatchObject({ kind: "contracts", riskColumn: true });
    if (after.page?.kind !== "contracts") throw new Error("not the contract desk");
    expect(after.page.files.map((file) => file.risk)).toEqual(["high", "medium"]);
    expect(foldRun(steps, steps.length).historyOpen).toBe(true);
  });

  it("holds every step within the replay's bounds", () => {
    for (const { steps } of scenarios) {
      for (const delay of stepDelays(steps)) {
        expect(delay).toBeGreaterThanOrEqual(MIN_STEP_MS);
        expect(delay).toBeLessThanOrEqual(MAX_STEP_MS);
      }
    }
  });
});

describe("the folded panes", () => {
  it("replaces a running turn's row with its next poll, and starts a new row for the next turn", () => {
    const steps: A2appStep[] = [
      load("aaaaaaaaaaaa"),
      { kind: "host", call: { method: "createSession" }, ms: 900 },
      { kind: "host", call: { method: "run", text: "one" }, ms: 900 },
      { kind: "host", call: { method: "sessionResult", status: "running" }, ms: 900 },
      { kind: "host", call: { method: "sessionResult", status: "running" }, ms: 900 },
      { kind: "host", call: { method: "sessionResult", status: "completed" }, ms: 900 },
      { kind: "host", call: { method: "run", text: "two" }, ms: 900 },
      { kind: "host", call: { method: "sessionResult", status: "running" }, ms: 900 },
    ];
    expect(foldRun(steps, 6).host).toEqual([
      { method: "createSession" },
      { method: "run", text: "one" },
      { method: "sessionResult", status: "completed" },
    ]);
    expect(foldRun(steps, 8).host.slice(3)).toEqual([
      { method: "run", text: "two" },
      { method: "sessionResult", status: "running" },
    ]);
  });

  it("moves a revision that loaded before to the front of History instead of repeating it", () => {
    const steps = [load("aaaaaaaaaaaa"), load("bbbbbbbbbbbb"), load("aaaaaaaaaaaa")];
    expect(foldRun(steps, 3).versions).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  });

  it("clamps a scripted wait to the replay's bounds", () => {
    const steps: A2appStep[] = [
      { kind: "say", text: "quick", ms: 10 },
      { kind: "say", text: "slow", ms: 60_000 },
    ];
    expect(stepDelays(steps)).toEqual([MIN_STEP_MS, MAX_STEP_MS]);
  });
});
