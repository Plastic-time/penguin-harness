/**
 * The status bar across the bottom of the shell — this round a fixed part of the Web App's
 * layout (a plugin's own bar can follow later; the seam is this one component).
 *
 * The admin's own view of their harness: the machine they work on on the left, the harness
 * on the right. One poll (POST /api/harness-status, carrying the Session ids this browser
 * has opened) repaints everything — the load of the machine the most recently viewed
 * Session lives on (this server's when nothing viewed is in the answer), the harness-wide
 * active count summed over every machine that answered, and the rows of exactly the Sessions
 * the user has opened, wherever in the harness they live. The route answers 403 for a
 * non-admin, and the bar treats that as "not for this user" and unmounts itself.
 *
 * Collection is deliberately dull: one request every 10 seconds, stopped while the tab is
 * hidden and resumed (with an immediate poll) when it shows again, and re-asked the moment
 * the shell moves onto another Session — the row it lands on is the one the bar's workdir
 * and machine read. Nothing is sampled on the main thread beyond painting the numbers; the
 * CPU's window is measured server-side.
 *
 * Counting and marking follow the ticket's own words, spelled out in lib/status-bar-model:
 * `session: ${active} / ${viewed}` — active is the server's live truth over the whole
 * harness, viewed is this browser's own opened set, and a row's x is the 「移除即关闭」 that
 * makes that count go down by one; a Session the user has opened carries a one-time
 * 「已空闲」 mark from the poll that first sees it idle after a running one, until they look
 * at it again.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router";
import { Badge, CloseIcon, Dropdown } from "@prismshadow/penguin-ui";
import type {
  HarnessStatusResponse,
  HarnessStatusSession,
  HarnessStatusSystem,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { workspaceLabel } from "../../lib/session-grouping";
import {
  MARKS_KEY,
  OPENED_KEY,
  IdSet,
  byLatest,
  gigabytes,
  loadIdSet,
  marksForTransitions,
  pageStorage,
  saveIdSet,
  viewedCount,
  workingMachineOf,
} from "../../lib/status-bar-model";
import { rememberSessionMachine } from "../../lib/session-machines";
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

  /** The harness's last answer; null until the first poll lands (and forever on a 403). */
  const [data, setData] = useState<HarnessStatusResponse | null>(null);
  /** Bumped whenever one of the tracked sets changed, so the rows re-read the refs. */
  const [, setBookkeeping] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  /** Bumped by a removal, so the poll asks again at once — the row leaves the list now. */
  const [pollNonce, setPollNonce] = useState(0);

  /** The bar's own bookkeeping, loaded once and saved on every change (best-effort). */
  const opened = useRef<IdSet | null>(null);
  const marks = useRef<IdSet | null>(null);
  if (opened.current === null) {
    const storage = pageStorage();
    opened.current = loadIdSet(storage, OPENED_KEY);
    marks.current = loadIdSet(storage, MARKS_KEY);
  }
  /** Every set change persists; one function so no change path forgets the save. */
  const note = () => {
    const storage = pageStorage();
    saveIdSet(storage, OPENED_KEY, opened.current!);
    saveIdSet(storage, MARKS_KEY, marks.current!);
    setBookkeeping((v) => v + 1);
  };

  /** The statuses the previous poll observed — the before-side of every mark's transition. */
  const prevStatuses = useRef<ReadonlyMap<string, SessionStatus> | null>(null);

  // Looking at a Session opens it (it becomes one the bar marks when it goes idle) and
  // clears any idle mark it carries — the mark has done its job once it brought the user
  // here. Declared above the poll, so the poll a route change restarts asks with the row it
  // landed on already in the opened set.
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

  // The one poll: every POLL_MS while the tab shows, stopped while it hides (resumed with an
  // immediate poll on show), and started over when the shell moves onto another Session or a
  // removal shrinks the opened set — the row it lands on, and the row that left, are in the
  // answer at once. A 403 is the endpoint saying "not this user" — the bar stops for good;
  // any other failure is transient and the next tick tries again with the last data still
  // painted.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      let forbidden = false;
      try {
        const next = await api.getHarnessStatus(opened.current!.toArray());
        if (cancelled) return;
        setData(next);
        // Where each row lives, so the two dozen Session-scoped calls about it reach the
        // machine that holds it — the poll's rows are the authority the lists rebuilt anyway.
        for (const row of next.sessions) rememberSessionMachine(row.sessionId, row.machineId);
        const newlyMarked = marksForTransitions(
          next.sessions,
          prevStatuses.current ?? new Map(),
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
  }, [routeSessionId, pollNonce]);

  /** The x: stop keeping the Session — the ticket's 「移除即关闭」, so `viewed` goes down by one. */
  const remove = (sessionId: string) => {
    opened.current!.delete(sessionId);
    marks.current!.delete(sessionId);
    note();
    setPollNonce((v) => v + 1); // ask again now: the row leaves the list in this breath
  };

  // The right side's first two fields. The workdir: the chat's own row first — the poll's
  // rows span every machine, so a Session that lives on one resolves here — then the
  // shell's session store; null when there is nothing to name. The company: the
  // organization the shell has open, and when the shell's own state names none, the
  // machine the current Session lives on is asked for the organizations of that row's
  // Project — one organization there is the company whose Session this is.
  const currentRow = useMemo(
    () => data?.sessions.find((s) => s.sessionId === routeSessionId) ?? null,
    [data, routeSessionId],
  );
  const workdir = useMemo(() => {
    const id = routeSessionId;
    if (id === null || notASession(id)) return null;
    return currentRow?.workspace ?? sessions.find((s) => s.sessionId === id)?.workspace ?? null;
  }, [routeSessionId, currentRow, sessions]);
  const org = useMemo(() => {
    const parsed = parseOrgKey(company.currentOrgKey ?? company.lastOrgKey);
    if (parsed === null) return null;
    return (
      company.organizations.find(
        (o) => o.projectId === parsed.projectId && o.orgId === parsed.orgId,
      ) ?? null
    );
  }, [company.currentOrgKey, company.lastOrgKey, company.organizations]);

  /** The machine-side company answer, keyed by the (machine, Project) it was read for. */
  const [machineCompany, setMachineCompany] = useState<{ key: string; name: string | null } | null>(
    null,
  );
  const companyCache = useRef(new Map<string, Promise<string | null>>());
  const companyKey =
    currentRow !== null && currentRow.machineId !== null
      ? `${currentRow.machineId}/${currentRow.projectId}`
      : null;
  useEffect(() => {
    if (org !== null || companyKey === null) return;
    let read = companyCache.current.get(companyKey);
    if (read === undefined) {
      const [machineId, projectId] = companyKey.split("/");
      read = api
        .listOrganizations(projectId!, machineId!)
        .then((res) =>
          res.organizations.length === 1 ? (res.organizations[0]!.name ?? null) : null,
        )
        .catch(() => null); // A machine that cannot be asked names no company; its load says so.
      companyCache.current.set(companyKey, read);
    }
    let cancelled = false;
    void read.then((name) => {
      if (!cancelled) setMachineCompany({ key: companyKey, name });
    });
    return () => {
      cancelled = true;
    };
  }, [org, companyKey]);
  const companyName =
    org?.name ??
    (machineCompany !== null && machineCompany.key === companyKey ? machineCompany.name : null) ??
    null;

  if (data === null) return null; // nothing polled yet, or a 403: no bar

  // The left side's machine: the one the most recently viewed Session lives on — the load
  // that matters is the load of whatever the user last worked on, which for a company on
  // its own machine is that machine. This server's when nothing viewed is in the answer.
  const working = workingMachineOf(opened.current!, data.sessions);
  const workingEntry =
    working === null ? null : (data.machines.find((m) => m.machineId === working) ?? null);
  const system: HarnessStatusSystem | null =
    working === null ? data.system : (workingEntry?.system ?? null);

  return (
    <StatusBarView
      running={data.running}
      rows={data.sessions}
      system={system}
      systemAlias={working === null ? null : workingEntry?.alias ?? null}
      companyName={companyName}
      workdir={workdir}
      marks={marks.current!}
      opened={opened.current!}
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
  running,
  rows,
  system,
  systemAlias,
  companyName,
  workdir,
  marks,
  opened,
  listOpen,
  onListOpen,
  onOpenSession,
  onRemove,
}: {
  /** The harness-wide active count: every machine that answered, summed. */
  running: number;
  /** The opened Sessions this poll still holds; the view orders them newest first. */
  rows: readonly HarnessStatusSession[];
  /** The machine the left side reads; null when that machine did not answer this poll. */
  system: HarnessStatusSystem | null;
  /** The alias of the machine the left side reads; null when it is this server. */
  systemAlias: string | null;
  companyName: string | null;
  /** The Session's full workspace path; the bar shows its last segment, the tooltip the path. */
  workdir: string | null;
  marks: ReadonlySet<string>;
  /** The Sessions this browser has opened and still keeps — the second count. */
  opened: ReadonlySet<string>;
  listOpen: boolean;
  /** The list's open state, handed both ways (the trigger toggles, the shell closes). */
  onListOpen: (open: boolean) => void;
  onOpenSession: (sessionId: string) => void;
  onRemove: (sessionId: string) => void;
}) {
  // The counts: active is the harness's live truth over every machine; viewed is this
  // browser's own opened set. The list shows exactly that set's rows.
  const all = viewedCount(opened);
  const list = byLatest(rows);
  const machineSuffix = systemAlias === null ? "" : `: ${systemAlias}`;

  return (
    <footer
      data-slot="status-bar"
      className="flex h-7 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-line bg-surface-muted px-3 text-xs text-fg-muted"
    >
      {/* Left: the machine the user works on. Two facts, no more (no disk — the ticket
          names CPU and memory alone), read from the poll, never measured here. A machine
          that did not answer this poll shows no numbers at all rather than another
          machine's. */}
      <div className="flex min-w-0 items-center gap-4">
        <span
          className="whitespace-nowrap"
          data-tooltip={`${S.statusBar.cpuTooltip}${machineSuffix}`}
        >
          {S.statusBar.cpu}{" "}
          {system === null
            ? "—"
            : system.cpuPercent === null
              ? S.statusBar.measuring
              : `${system.cpuPercent}%`}
        </span>
        <span
          className="whitespace-nowrap"
          data-tooltip={`${S.statusBar.memoryTooltip}${machineSuffix}`}
        >
          {S.statusBar.memory}{" "}
          {system === null
            ? "—"
            : S.statusBar.memoryOf(
                gigabytes(system.memoryUsedBytes),
                gigabytes(system.memoryTotalBytes),
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
            {list.length === 0 ? (
              <p className="px-3 py-3 text-xs text-fg-muted">{S.statusBar.listEmpty}</p>
            ) : (
              list.map((row) => {
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
          </div>
        </Dropdown>
      </div>
    </footer>
  );
}
