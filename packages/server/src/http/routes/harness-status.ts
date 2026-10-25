/**
 * The harness status bar's one poll: POST /api/harness-status (admin-only — the counts and
 * the list span every Project and every user's Sessions, so a non-admin gets 403 and the bar
 * stays hidden).
 *
 * One request carries everything the bar repaints with. The body names the Session ids this
 * browser has OPENED — the answer's rows are those the harness still holds, with their live run
 * status, so the bar's list and its idle marks can follow them wherever they live — TOGETHER
 * with every ACTIVE session, opened or not: the list the counts open shows the sessions behind
 * the first number, and a row the user never opened rides the answer only while it is active
 * (an idle one is the opened set's business alone, so it drops out at the next poll). The
 * counts stay over the WHOLE harness either way: `running` is every Session with a Task in
 * progress or a compaction running, all Projects and clients alike.
 *
 * The harness the answer spans is this server AND the machines it holds connections to: a
 * machine asked here answers through its own copy of this route with `own` set — its own
 * Sessions and its own machine's load, never fanning out further (the flag is what keeps one
 * server's poll from recursing through a machine that lists it back). A machine that cannot
 * answer — not connected, or a build from before this route existed — contributes nothing
 * silently: its share is simply missing until it is connected and current, the same deal
 * every other machine surface makes with an unreachable server. Each row names the machine it
 * lives on, and the organization that holds it when one does (`orgId`, from the answering
 * server's own caches) — the pair the bar's click needs to take the shell to the company a
 * Session belongs to before it asks the sidebar to locate the row.
 *
 * The bar polls at a human cadence and pauses while the tab is hidden, so the route is
 * read-only and serves the local system sampler's cached answer (services/system-status.ts).
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type {
  HarnessStatusMachine,
  HarnessStatusRequest,
  HarnessStatusResponse,
  HarnessStatusSession,
  HarnessStatusSystem,
} from "../../api/types.js";
import { HttpError } from "../errors.js";
import { badRequest, readJson } from "../validate.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { SessionIndex } from "../../mechanisms/sessions.js";
import type { OrgCache } from "../../mechanisms/organization.js";
import { Sessions as ManagerIface } from "../../runtime/session-manager.js";
import type { Machines } from "../../machines/service.js";
import type { SystemStatus } from "../../services/system-status.js";

/** What this route group reaches — bound by its component below. */
export interface HarnessStatusRouteDeps {
  sessionsRepo: SessionIndex;
  manager: ManagerIface;
  system: SystemStatus;
  /** The machines this server holds out to; the fan-out asks each one's own copy of this route. */
  machines: Pick<Machines, "connectedApis">;
  /**
   * The organization caches, for the `orgId` each row carries: the desk ledger and the
   * tickets' sessions, projected (reconcile.ts), so a point query names the organization a
   * Session belongs to — the fact the bar's click needs to reach the right company.
   */
  orgCache: Pick<OrgCache, "ownerOfSession">;
}

/** How many opened ids one poll may name — the same cap the bar's own sets keep. */
export const STATUS_BAR_OPEN_LIMIT = 200;

/**
 * How long one machine's share of the answer may take. A machine that misses the deadline
 * contributes nothing this poll; the next one asks again. Short, because the whole answer
 * waits for the slowest machine that is asked.
 */
export const MACHINE_ANSWER_TIMEOUT_MS = 4_000;

/** One request body, read and validated; invalid ids are dropped rather than refused — a poll
 * carrying a stale or malformed id must keep answering, not die on it. */
function readOpenIds(body: Record<string, unknown>): string[] {
  const raw = body.open;
  if (raw === undefined) throw badRequest("open must be an array of Session ids.");
  if (!Array.isArray(raw)) throw badRequest("open must be an array of Session ids.");
  if (raw.length > STATUS_BAR_OPEN_LIMIT) {
    throw badRequest(`open must hold at most ${STATUS_BAR_OPEN_LIMIT} Session ids.`);
  }
  return raw.filter(
    (id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id),
  );
}

/**
 * A machine's answer, or null when it is not one this code can use — a 404 from a build
 * before this route existed, a gateway error, a body that is not this response's shape. The
 * row-level checks keep a machine's malformed row from taking the whole answer down.
 */
function machineAnswerOf(
  text: string,
): Pick<HarnessStatusResponse, "running" | "sessions" | "system"> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const answer = parsed as Record<string, unknown>;
  const system = systemOf(answer.system);
  if (
    typeof answer.running !== "number" ||
    !Array.isArray(answer.sessions) ||
    !Number.isFinite(answer.running) ||
    answer.running < 0 ||
    system === null
  ) {
    return null;
  }
  const sessions: HarnessStatusSession[] = [];
  for (const row of answer.sessions) {
    const session = sessionOf(row);
    if (session !== null) sessions.push(session);
  }
  return { running: Math.round(answer.running), sessions, system };
}

/** One row of an answer, or null when it is not a row this code can use. */
function sessionOf(raw: unknown): HarnessStatusSession | null {
  if (raw === null || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (
    typeof row.sessionId !== "string" ||
    typeof row.projectId !== "string" ||
    typeof row.agentId !== "string" ||
    typeof row.workspace !== "string" ||
    typeof row.lastActiveAt !== "string" ||
    typeof row.status !== "string"
  ) {
    return null;
  }
  const client = row.client;
  if (
    client !== null &&
    client !== undefined &&
    !["web", "cli", "org", "api", "workbench"].includes(client as string)
  ) {
    return null;
  }
  return {
    sessionId: row.sessionId,
    projectId: row.projectId,
    agentId: row.agentId,
    title: typeof row.title === "string" ? row.title : null,
    workspace: row.workspace,
    client: (client as HarnessStatusSession["client"]) ?? null,
    status: row.status as HarnessStatusSession["status"],
    lastActiveAt: row.lastActiveAt,
    machineId: null,
    // Lenient on purpose: an organization id is a free string, so only its type can be
    // wrong — a machine from a build before this field sends none, and a wrong-typed one
    // costs the click its company, not the row its place in the list.
    orgId: typeof row.orgId === "string" ? row.orgId : null,
  };
}

/** A system block of an answer, or null when it is not one this code can use. */
function systemOf(raw: unknown): HarnessStatusSystem | null {
  if (raw === null || typeof raw !== "object") return null;
  const system = raw as Record<string, unknown>;
  if (
    typeof system.memoryUsedBytes !== "number" ||
    typeof system.memoryTotalBytes !== "number" ||
    !Number.isFinite(system.memoryUsedBytes) ||
    !Number.isFinite(system.memoryTotalBytes)
  ) {
    return null;
  }
  if (system.cpuPercent !== null && typeof system.cpuPercent !== "number") return null;
  return {
    cpuPercent: typeof system.cpuPercent === "number" ? system.cpuPercent : null,
    memoryUsedBytes: system.memoryUsedBytes,
    memoryTotalBytes: system.memoryTotalBytes,
  };
}

/**
 * This server's own share: every Session it holds, counted for `running`; the listed rows are
 * the opened ids this server still holds — whatever their status — plus every ACTIVE one,
 * opened or not, because the active half of the list is the harness's own business, not the
 * browser's bookkeeping.
 */
function localShare(
  deps: HarnessStatusRouteDeps,
  open: ReadonlySet<string>,
): { running: number; sessions: HarnessStatusSession[] } {
  const rows = deps.sessionsRepo.listAll();
  const sessions: HarnessStatusSession[] = [];
  let running = 0;
  for (const row of rows) {
    // A row with no runtime entry is idle (an entry exists exactly while the Session is
    // loaded; a running one always is), so statusOf answers the truth for every row.
    const status = deps.manager.statusOf(row.sessionId);
    if (status !== "idle") running++;
    if (open.has(row.sessionId) || status !== "idle") {
      sessions.push({
        sessionId: row.sessionId,
        projectId: row.projectId,
        agentId: row.agentId,
        title: row.title,
        workspace: row.workspace,
        client: row.client ?? null,
        status,
        lastActiveAt: row.lastActiveAt,
        machineId: null,
        // Which organization holds the Session, when one does — the answering server's own
        // caches say (a machine's answer says it for its own rows the same way), so the
        // bar's click knows which company's column to reach.
        orgId: deps.orgCache.ownerOfSession(row.sessionId)?.orgId ?? null,
      });
    }
  }
  return { running, sessions };
}

export function harnessStatusRoutes(deps: HarnessStatusRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
    await next();
  });

  app.post("/", async (c) => {
    const body = await readJson(c);
    const request: HarnessStatusRequest = {
      open: readOpenIds(body),
      ...(body.own === true ? { own: true } : {}),
    };
    const open = new Set(request.open);

    // The machines' shares ride the same poll, asked in parallel and merged into one answer.
    // `own` on OUR request means somebody is asking US as a machine: this server's share is
    // the whole answer, and the machines this server holds are that asker's business, not ours.
    const machines = request.own
      ? []
      : (await deps.machines.connectedApis()).filter((entry) => entry.api !== null);
    const answers = await Promise.all(
      machines.map(async (entry) => {
        const api = entry.api!;
        try {
          const answer = await api.request(
            "POST",
            "/api/harness-status",
            { open: request.open, own: true },
            MACHINE_ANSWER_TIMEOUT_MS,
          );
          const share = answer.status === 200 ? machineAnswerOf(answer.text) : null;
          return share === null ? null : { entry, share };
        } catch {
          return null; // Not connected mid-ask, or it never answered in time: no share this poll.
        }
      }),
    );

    const local = localShare(deps, open);
    let running = local.running;
    const sessions = [...local.sessions];
    const machineBlocks: HarnessStatusMachine[] = [];
    for (const answer of answers) {
      if (answer === null) continue;
      const { entry, share } = answer;
      running += share.running;
      for (const row of share.sessions) sessions.push({ ...row, machineId: entry.machineId });
      machineBlocks.push({
        machineId: entry.machineId,
        alias: entry.alias,
        system: share.system,
      });
    }

    return c.json({
      running,
      sessions,
      system: deps.system.read(),
      machines: machineBlocks,
    } satisfies HarnessStatusResponse);
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "harness-status.routes",
        prefix: "/api/harness-status",
        auth: "user",
        order: 283,
      },
    ],
  },
})
export class HarnessStatusRoutes {
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly manager!: ManagerIface;
  @Use() private readonly system!: SystemStatus;
  @Use() private readonly machines!: Machines;
  @Use() private readonly orgCache!: OrgCache;
  @Bind("harness-status.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = harnessStatusRoutes({
      sessionsRepo: this.sessionsRepo,
      manager: this.manager,
      system: this.system,
      machines: this.machines,
      orgCache: this.orgCache,
    });
  }
}
