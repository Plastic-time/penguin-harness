/**
 * The status bar's click and the left column's answer: a small pub-sub that carries one
 * "locate this Session" ask from whoever opens a Session to whichever sidebar is on screen.
 *
 * The bar's list holds Sessions the sidebars do not (another employee's desk or ticket
 * Session, one living on another machine), and the sidebars hold state the bar does not
 * (which groups are folded, which page of them is shown). So the click does not reach for
 * the sidebar itself: it publishes an ask here, and the sidebar that is mounted — the
 * company's groups or the development list, never both at once — answers it on its own
 * terms: unfold the group the row lives in, list a ticket session exactly as opening it
 * from its ticket would have, and bring the row into view. An ask no sidebar can answer
 * (a Session of another organization, or of a Project that is not on screen) simply sits
 * until the next publish replaces it.
 *
 * The ask carries what either answer needs: the Session id (the row to find), the Agent
 * (whose group a company Session belongs to), and the title the bar's row carried (a
 * ticket entry's fallback name). A fresh `nonce` marks every publish, so a consumer can
 * tell a new ask from a re-render of the same one and act on it once.
 *
 * The store is one module singleton over nothing but memory: it holds one ask at a time —
 * the newest click wins outright, and clicking the Session the bar already sits on still
 * publishes, since the sidebar may have folded its group since — and keeps the same object
 * between publishes, as useSyncExternalStore's snapshot needs. The tests build their own
 * store; the module keeps its singleton out of their way.
 */
import { useSyncExternalStore } from "react";

/** One "locate this Session" ask, published when the bar's list opens one. */
export interface SidebarLocateRequest {
  sessionId: string;
  /** The row's Agent: the employee whose group a company Session belongs to. */
  agentId: string;
  /** The title the bar's row carried — a ticket entry's fallback name until its own. */
  title: string;
  /** Fresh on every publish: tells a repeated ask from a new one for the same Session. */
  nonce: number;
}

export interface SidebarLocateStore {
  /** The ask a sidebar has yet to answer; null before the first publish. */
  current(): SidebarLocateRequest | null;
  publish(sessionId: string, agentId: string, title: string | null): void;
  subscribe(listener: () => void): () => void;
}

/**
 * One ask at a time, over plain memory: `current` hands out the same object until the next
 * publish, so React re-renders only when an ask actually changes.
 */
export function createSidebarLocateStore(): SidebarLocateStore {
  let held: SidebarLocateRequest | null = null;
  let nonce = 0;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    current: () => held,
    publish(sessionId, agentId, title) {
      held = { sessionId, agentId, title: title ?? "", nonce: ++nonce };
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one store. */
const store = createSidebarLocateStore();

/** The ask the sidebar on screen has yet to answer; null before the first publish. */
export function useSidebarLocate(): SidebarLocateRequest | null {
  return useSyncExternalStore(store.subscribe, store.current, store.current);
}

/**
 * Ask the sidebar to catch up with a Session the user just opened elsewhere (the status
 * bar's list): it unfolds, and brings into view, the row it can answer with — the desk's,
 * or the conversation's. A sidebar that holds no such row does nothing.
 */
export function locateSessionInSidebar(
  sessionId: string,
  agentId: string,
  title: string | null,
): void {
  store.publish(sessionId, agentId, title);
}
