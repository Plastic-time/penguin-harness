/**
 * The harness status bar's one poll: GET /api/harness-status (admin-only — the counts and
 * the list span every Project and every user's Sessions, so a non-admin gets 403 and the bar
 * stays hidden).
 *
 * One request carries everything the bar repaints with: the session counts over the WHOLE
 * harness (not the Project the sidebar lists — an organization's desk and ticket sessions,
 * CLI and API rows, archived rows alike), the newest rows its list shows with their live
 * run status, and the machine's CPU/memory. The bar polls at a human cadence and pauses
 * while the tab is hidden, so the route is read-only, needs no per-request state and serves
 * the system sampler's cached answer (services/system-status.ts).
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { HarnessStatusResponse, HarnessStatusSession } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { SessionIndex } from "../../mechanisms/sessions.js";
import { Sessions as ManagerIface } from "../../runtime/session-manager.js";
import type { SystemStatus } from "../../services/system-status.js";

/** What this route group reaches — bound by its component below. */
export interface HarnessStatusRouteDeps {
  sessionsRepo: SessionIndex;
  manager: ManagerIface;
  system: SystemStatus;
}

/** How many of the newest rows ride one answer; the counts stay over the full list either way. */
export const STATUS_BAR_SESSION_LIMIT = 100;

export function harnessStatusRoutes(deps: HarnessStatusRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
    await next();
  });

  app.get("/", (c) => {
    const rows = deps.sessionsRepo.listAll();
    const sessions: HarnessStatusSession[] = [];
    let running = 0;
    for (const row of rows) {
      // A row with no runtime entry is idle (an entry exists exactly while the Session is
      // loaded; a running one always is), so statusOf answers the truth for every row.
      const status = deps.manager.statusOf(row.sessionId);
      if (status !== "idle") running++;
      if (sessions.length < STATUS_BAR_SESSION_LIMIT) {
        sessions.push({
          sessionId: row.sessionId,
          projectId: row.projectId,
          agentId: row.agentId,
          title: row.title,
          workspace: row.workspace,
          client: row.client ?? null,
          status,
          lastActiveAt: row.lastActiveAt,
        });
      }
    }
    return c.json({
      running,
      total: rows.length,
      sessions,
      system: deps.system.read(),
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
  @Bind("harness-status.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = harnessStatusRoutes({
      sessionsRepo: this.sessionsRepo,
      manager: this.manager,
      system: this.system,
    });
  }
}
