/**
 * The A2APP player's panes as functions of how many steps of a run have been shown: `foldRun`
 * over the first `count` steps, and the wait before each step. Pure, so the finished state, every
 * frame of the replay and the tests read the same code.
 *
 * The fold reads a run the way the Web App shows it:
 * - Chat lists the person's sentences, the agent's tool calls and its replies, in order;
 * - the workbench has no tab until its first load; every load is a version, newest first, and
 *   the newest is the one serving;
 * - the host log lists the server's calls to the agent, and a `sessionResult` poll that follows
 *   a running one replaces it in place (one row per turn, reading its latest snapshot);
 * - the page is the latest one a step showed.
 */
import type { A2appStep, AppPage, HostCall } from "./a2app-demo";

export type ChatLine =
  | { kind: "say"; text: string }
  | { kind: "tool"; tool: string; path: string }
  /** The agent reading `.build/status.json` after the server loaded the workbench. */
  | { kind: "load" }
  | { kind: "reply"; text: string };

export interface A2appState {
  chat: ChatLine[];
  host: HostCall[];
  /** Null until the workbench first loads: until then there is no tab for it. */
  page: AppPage | null;
  /** The revisions that loaded, newest (the current one) first. */
  versions: string[];
  /** The History list is open under the workbench's bar. */
  historyOpen: boolean;
}

/** The panes after the first `count` steps of a run. */
export function foldRun(steps: readonly A2appStep[], count: number): A2appState {
  const chat: ChatLine[] = [];
  const host: HostCall[] = [];
  let page: AppPage | null = null;
  let versions: string[] = [];
  let historyOpen = false;

  for (const step of steps.slice(0, count)) {
    switch (step.kind) {
      case "say":
      case "reply":
        chat.push({ kind: step.kind, text: step.text });
        break;
      case "tool":
        chat.push({ kind: "tool", tool: step.tool, path: step.path });
        break;
      case "load":
        chat.push({ kind: "load" });
        // A revision loaded before (a restore) moves to the front rather than repeating.
        versions = [step.revision, ...versions.filter((revision) => revision !== step.revision)];
        page = step.page;
        break;
      case "use":
        page = step.page;
        break;
      case "host": {
        const last = host.at(-1);
        if (
          step.call.method === "sessionResult" &&
          last?.method === "sessionResult" &&
          last.status === "running"
        ) {
          host[host.length - 1] = step.call;
        } else {
          host.push(step.call);
        }
        if (step.page) page = step.page;
        break;
      }
      case "history":
        historyOpen = true;
        break;
    }
  }
  return { chat, host, page, versions, historyOpen };
}

/**
 * The pace of the replay: each step waits the time its script gives it, held within these
 * bounds, so a row is on screen long enough to read before the next one comes.
 */
export const MIN_STEP_MS = 600;
export const MAX_STEP_MS = 2000;

/** Milliseconds to wait before showing step i. */
export function stepDelays(steps: readonly A2appStep[]): number[] {
  return steps.map((step) => Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, step.ms)));
}
