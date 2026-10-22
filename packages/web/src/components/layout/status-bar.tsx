/**
 * The status bar along the bottom of the shell — this round a fixed part of the Web App's
 * layout (a plugin's own bar can follow later; the seam is this one component).
 *
 * The admin's own view of their harness: the machine on the left, the harness on the right.
 * One poll (GET /api/harness-status) repaints everything — CPU and memory of the machine
 * the server runs on, and over the WHOLE harness (not the Project the sidebar lists) the
 * session counts `session: ${running} / ${all}` and the list they open. The route answers
 * 403 for a non-admin, and the bar treats that as "not for this user" and unmounts itself.
 *
 * Collection is deliberately dull: one request every 10 seconds, stopped while the tab is
 * hidden and resumed (with an immediate poll) when it shows again. Nothing is sampled on
 * the main thread beyond painting the numbers; the CPU's window is measured server-side.
 *
 * Counting and marking follow the ticket's own words, spelled out in lib/status-bar-model:
 * a row's x removes it from the list and is the 「移除即关闭」 that makes `all` go down by
 * one; a Session the user has opened carries a one-time 「已空闲」 mark from the poll that
 * first sees it idle after a running one, until they look at it again.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router";
import { Badge, CloseIcon, Dropdown } from "@prismshadow/penguin-ui";
import type { HarnessStatusResponse, SessionStatus } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { workspaceLabel } from "../../lib/session-grouping";
import {
  CLOSED_KEY,
  MARKS_KEY,
  OPENED_KEY,
  IdSet,
  gigabytes,
  loadIdSet,
  marksForTransitions,
  pageStorage,
  saveIdSet,
  trackedTotal,
  visibleRows,
} from "../../lib/status-bar-model";
import { toneDot } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { useSessions } from "../../state/sessions";
import { parseOrgKey } from "../../features/company/company-nav";

/** One poll every 10 seconds: a status bar cadence, not a monitoring one. */
const POLL_MS = 10_000;

/** The route-ids that are not Sessions: the new-chat page and its parked drafts. */
const notASession = (id: string): boolean => id === "new" || id.startsWith("draft-");

export function StatusBar() {
  const navigate = useNavigate();
  const company = useCompany();
  const { sessions } = useSessions();
  /** The Session the shell is on, if it is on one (the draft page's ids are not Sessions). */
  const routeSessionId = useMatch("/chat/:sessionId")?.params.sessionId ?? null;
  const onConversation = routeSessionId !== null && !notASession(routeSessionId);

  /** The harness's last answer; null until the first poll lands (and forever on a 403). */
  const [data, setData] = useState<HarnessStatusResponse | null>(null);
  /** Bumped whenever one of the tracked sets changed, so the rows re-read the refs. */
  const [, setBookkeeping] = useState(0);
  const [listOpen, setListOpen] = useState(false);

  /** The bar's own bookkeeping, loaded once and saved on every change (best-effort). */
  const opened = useRef<IdSet | null>(null);
  const marks = useRef<IdSet | null>(null);
  const closed = useRef<IdSet | null>(null);
  if (opened.current === null) {
    const storage = pageStorage();
    opened.current = loadIdSet(storage, OPENED_KEY);
    marks.current = loadIdSet(storage, MARKS_KEY);
    closed.current = loadIdSet(storage, CLOSED_KEY);
  }
  /** Every set change persists; one function so no change path forgets the save. */
  const note = () => {
    const storage = pageStorage();
    saveIdSet(storage, OPENED_KEY, opened.current!);
    saveIdSet(storage, MARKS_KEY, marks.current!);
    saveIdSet(storage, CLOSED_KEY, closed.current!);
    setBookkeeping((v) => v + 1);
  };

  /** The statuses the previous poll observed — the before-side of every mark's transition. */
  const prevStatuses = useRef<ReadonlyMap<string, SessionStatus>>(new Map());

  // The one poll: every POLL_MS while the tab shows, stopped while it hides (resumed with an
  // immediate poll on show). A 403 is the endpoint saying "not this user" — the bar stops
  // for good; any other failure is transient and the next tick tries again with the last
  // data still painted.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      let forbidden = false;
      try {
        const next = await api.getHarnessStatus();
        if (cancelled) return;
        setData(next);
        const newlyMarked = marksForTransitions(
          next.sessions,
          prevStatuses.current,
          opened.current!,
          marks.current!,
        );
        for (const id of newlyMarked) marks.current!.add(id);
        prevStatuses.current = new Map(next.sessions.map((row) => [row.sessionId, row.status]));
        if (newlyMarked.length > 0) {
          saveIdSet(pageStorage(), MARKS_KEY, marks.current!);
          setBookkeeping((v) => v + 1);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) forbidden = true;
      }
      if (cancelled || forbidden) return; // not this user's bar: no data, no retries
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        void tick();
      } else if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Looking at a Session opens it (it becomes one the bar marks when it goes idle) and
  // clears any idle mark it carries — the mark has done its job once it brought the user
  // here. A Session closed out of the list stays closed: the x was the stronger statement.
  useEffect(() => {
    const id = routeSessionId;
    if (id === null || notASession(id)) return;
    let changed = !opened.current!.has(id);
    opened.current!.add(id);
    if (marks.current!.has(id)) {
      marks.current!.delete(id);
      changed = true;
    }
    if (changed) note();
  }, [routeSessionId]);

  /** The x: remove from the list — the ticket's 「移除即关闭」, so `all` goes down by one. */
  const remove = (sessionId: string) => {
    closed.current!.add(sessionId);
    marks.current!.delete(sessionId);
    opened.current!.delete(sessionId);
    note();
  };

  // The right side's first two fields, from the shell's own state: the organization
  // currently open, and the workspace of the Session the shell is on (the chat's own row
  // first — the freshest — then the poll's rows; null when there is nothing to name).
  const org = useMemo(() => {
    const parsed = parseOrgKey(company.currentOrgKey ?? company.lastOrgKey);
    if (parsed === null) return null;
    return (
      company.organizations.find(
        (o) => o.projectId === parsed.projectId && o.orgId === parsed.orgId,
      ) ?? null
    );
  }, [company.currentOrgKey, company.lastOrgKey, company.organizations]);
  const workdir = useMemo(() => {
    const id = routeSessionId;
    if (id === null || notASession(id)) return null;
    return (
      sessions.find((s) => s.sessionId === id)?.workspace ??
      data?.sessions.find((s) => s.sessionId === id)?.workspace ??
      null
    );
  }, [routeSessionId, sessions, data]);

  if (data === null) return null; // nothing polled yet, or a 403: no bar

  return (
    <StatusBarView
      data={data}
      companyName={org?.name ?? null}
      workdir={workdir}
      marks={marks.current!}
      closed={closed.current!}
      listOpen={listOpen}
      onListOpen={setListOpen}
      onOpenSession={(sessionId) => {
        setListOpen(false);
        navigate(`/chat/${sessionId}`);
      }}
      onRemove={remove}
    />
  );
}

/** The bar's presentational half, props only — tests render it without the app around it. */
export function StatusBarView({
  data,
  companyName,
  workdir,
  marks,
  closed,
  listOpen,
  onListOpen,
  onOpenSession,
  onRemove,
}: {
  data: HarnessStatusResponse;
  companyName: string | null;
  /** The Session's full workspace path; the bar shows its last segment, the tooltip the path. */
  workdir: string | null;
  marks: ReadonlySet<string>;
  closed: ReadonlySet<string>;
  listOpen: boolean;
  /** The list's open state, handed both ways (the trigger toggles, the shell closes). */
  onListOpen: (open: boolean) => void;
  onOpenSession: (sessionId: string) => void;
  onRemove: (sessionId: string) => void;
}) {
  // The counts: running is the server's live truth over the whole harness; all is the
  // harness's every Session minus the ones this browser closed out of the list.
  const running = data.running;
  const all = trackedTotal(data.total, closed);
  const rows = visibleRows(data.sessions, closed);
  // The list caps at what the server sent; what sits below the cap is older, not removed.
  const olderCount = Math.max(0, data.total - data.sessions.length);

  return (
    <footer
      data-slot="status-bar"
      className="flex h-7 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-line bg-surface-muted px-3 text-xs text-fg-muted"
    >
      {/* Left: the machine this harness runs on. Two facts, no more (no disk — the ticket
          names CPU and memory alone), read from the poll, never measured here. */}
      <div className="flex min-w-0 items-center gap-4">
        <span className="whitespace-nowrap" data-tooltip={S.statusBar.cpuTooltip}>
          {S.statusBar.cpu}{" "}
          {data.system.cpuPercent !== null ? `${data.system.cpuPercent}%` : S.statusBar.measuring}
        </span>
        <span className="whitespace-nowrap" data-tooltip={S.statusBar.memoryTooltip}>
          {S.statusBar.memory}{" "}
          {S.statusBar.memoryOf(
            gigabytes(data.system.memoryUsedBytes),
            gigabytes(data.system.memoryTotalBytes),
          )}
        </span>
      </div>
      {/* Right: the user's own three fields — the company currently open, the workdir of
          the Session the shell is on, and the session counts whose click opens the list. */}
      <div className="flex min-w-0 items-center gap-4">
        <span
          className="max-w-48 truncate"
          data-tooltip={
            companyName === null
              ? S.statusBar.companyTooltip
              : `${S.statusBar.companyTooltip}: ${companyName}`
          }
        >
          {S.statusBar.companyLabel}: {companyName ?? "—"}
        </span>
        <span
          className="max-w-64 truncate"
          data-tooltip={workdir === null ? S.statusBar.workdirTooltip : workdir}
        >
          {S.statusBar.workdirLabel}: {workdir === null ? "—" : workspaceLabel(workdir)}
        </span>
        <Dropdown
          open={listOpen}
          setOpen={onListOpen}
          portal={{ direction: "up", align: "right" }}
          button={
            <button
              type="button"
              aria-label={S.statusBar.sessionsTooltip}
              aria-expanded={listOpen}
              data-tooltip={S.statusBar.sessionsTooltip}
              onClick={() => onListOpen(!listOpen)}
              className="whitespace-nowrap rounded px-1 font-medium text-fg transition-colors hover:bg-fg/5"
            >
              {S.statusBar.sessions(running, all)}
            </button>
          }
          menuClass="w-80"
        >
          <div className="max-h-[60vh] overflow-y-auto">
            <p className="px-3 py-1.5 text-xs font-medium text-fg">{S.statusBar.listTitle}</p>
            {rows.length === 0 ? (
              <p className="px-3 py-3 text-xs text-fg-muted">{S.statusBar.listEmpty}</p>
            ) : (
              rows.map((row) => {
                const marked = marks.has(row.sessionId);
                const runningRow = row.status !== "idle";
                const title = row.title ?? S.company.sessionList.untitledSession;
                const statusWord = runningRow ? S.statusBar.runningLabel : S.statusBar.idleLabel;
                return (
                  <div key={row.sessionId} className="group flex items-center gap-2 px-2 py-1.5">
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        runningRow ? toneDot.busy : toneDot.muted
                      }`}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-xs text-fg hover:underline"
                      aria-label={`${title} · ${statusWord}`}
                      onClick={() => onOpenSession(row.sessionId)}
                    >
                      {title}
                      <span className="ml-2 text-fg-muted">{workspaceLabel(row.workspace)}</span>
                    </button>
                    {marked && (
                      <Badge tone="attention" variant="soft">
                        {S.statusBar.markedIdle}
                      </Badge>
                    )}
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-fg/5 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                      aria-label={S.statusBar.remove}
                      data-tooltip={S.statusBar.removeHint}
                      onClick={() => onRemove(row.sessionId)}
                    >
                      <CloseIcon size={12} />
                    </button>
                  </div>
                );
              })
            )}
            {olderCount > 0 && (
              <p className="border-t border-line px-3 py-1.5 text-xs text-fg-muted">
                {S.statusBar.olderHidden(olderCount)}
              </p>
            )}
          </div>
        </Dropdown>
      </div>
    </footer>
  );
}
