/**
 * What the Web App's roadmaps reads do when the link to an organization's machine dies, and
 * when it returns (roadmaps-backoff.ts): a hub and one machine (machine.mjs), the organization
 * running on the machine, one roadmap with its room, and a browser on the room's page.
 *
 * The machine's server is then ended — the hub-to-machine link dying, the same half of the
 * incident of 2026-10-21 the server's own cooldown took — and for a measured window the page
 * navigates between the room and the organization's overview every two seconds, the way a
 * person clicking around does (in-app history: the page is never reloaded, which is also what
 * keeps the backoff's ladders alive). Every roadmaps read the window causes lands in the hub's
 * request log, so the window's count is the incident's number measured in isolation — every
 * roadmaps read of the organization, prefixed or not: the sidebar's list (the incident's own
 * surface, re-read on every navigation), the room column's poll, the channel page's lookup.
 * The sidebar's read goes through the hub's proxy like the rest (the client routes org-scoped
 * calls there), so on a dead link every one of them fails — the reads the backoff throttles.
 * With `BACKOFF_MEASURE_ONLY=1` the numbers are printed without the thresholds (for running
 * the same spec on the base, where the fix is absent).
 *
 * The recovery is measured against what the page can only know by reading again: once the
 * machine is back and connected, the spec renames the roadmap through the proxy, and the
 * clock stops when the SIDEBAR's row shows the new name — the one roadmaps surface mounted
 * through the whole window, healed by the backoff's own retry with no one clicking. (A room
 * whose channel read failed while the link was down stays on its error line until a
 * navigation — the channel surface's own shape, the base's too — so the room's column is
 * checked after one click, not clocked.) The rename is issued the moment the proxy answers:
 * the read the backoff has waiting is all but certain to land after it and see the new name,
 * and one that slips in between is a re-run, not a product flaw.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD } from "./auth.mjs";
import { startHubWithMachine } from "./machine.mjs";

const MOCK = process.env.MOCK_URL;
const HUB_PORT = Number(process.env.E2E_HUB_PORT ?? 8944);
const MACHINE_PORT = Number(process.env.E2E_MACHINE_PORT ?? 8945);
/** Print the measurements without asserting them: for the same spec on the unfixed base. */
const MEASURE_ONLY = process.env.BACKOFF_MEASURE_ONLY === "1";

const MODEL = {
  defaultModel: { provider: "custom", modelId: "claude-4-8" },
  models: [
    {
      provider: "custom",
      modelId: "claude-4-8",
      apiKey: "sk-mock",
      baseUrl: MOCK,
      contextWindow: 200000,
    },
  ],
};

// Unique per run: the organization belongs to its Project's data, and a rerun must not meet it.
const ORG = `backoff${Date.now().toString(36)}`;
const ROADMAP_NAME = "Client backoff read";
const RENAMED_NAME = "Client backoff healed";
const MISSION =
  "测量失败后的重拉节奏：读这份组织路线图的客户端退避，并给出恢复读数。";
/** The window's shape: one navigation every two seconds for about a minute. */
const NAVIGATIONS = 30;
const NAVIGATION_GAP_MS = 2_000;
/** What a healed page must beat: the ladder's worst wait, plus a read and the reconnect's skew. */
const HEAL_BUDGET_MS = 45_000;

let harness;

test.beforeAll(async () => {
  harness = await startHubWithMachine({
    hubPort: HUB_PORT,
    machinePort: MACHINE_PORT,
    model: MODEL,
    plugins: [
      "@prismshadow/penguin-plugin-company-proposals",
      "@prismshadow/penguin-plugin-company-roadmaps",
    ],
  });
});

test.afterAll(async () => {
  await harness?.admin.dispose();
  await harness?.stop();
});

test("a dead link to the organization's machine is re-asked on a backoff, and the page heals when it returns", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { base, projectId, machineId, address, admin, logs, workspace } = harness;
  const onMachine = (rest) => `${base}/server/${machineId}${rest}`;
  const api = (rest) => `${base}/api/projects/${projectId}${rest}`;

  // Company mode is off on a fresh server, on both servers of this pair: the hub's own
  // organizations route needs it, and so does the machine the organization will run on.
  for (const settings of [`${base}/api/admin/settings`, onMachine("/api/admin/settings")]) {
    const res = await admin.put(settings, { data: { companyMode: true } });
    expect(res.ok(), `company mode on ${settings}: ${await res.text()}`).toBeTruthy();
  }

  // The organization, running on the machine: the hub's create route forwards it there. A
  // shared workspace must be named for it — a directory that exists on the machine — which is
  // what the fixture made `workspace` for.
  const created = await admin.post(api("/organizations"), {
    data: { orgId: ORG, mission: MISSION, workspaceMachine: machineId, workspace },
  });
  expect(created.ok(), `create the organization: ${await created.text()}`).toBeTruthy();
  const ceo = `${ORG}_ceo`;

  // One roadmap, opened through the machine's own route — the same request the Web App's
  // "open a roadmap" dialog sends. It opens the room itself.
  const opened = await admin.post(
    onMachine(`/api/projects/${projectId}/organizations/${ORG}/actions/roadmap.open/runs`),
    { data: { subject: "organization", params: { name: ROADMAP_NAME, employees: [ceo] }, via: "web" } },
  );
  expect(opened.ok(), `open the roadmap: ${await opened.text()}`).toBeTruthy();
  const { roadmap } = (await opened.json()).result;
  const roomPath = `/org/${projectId}/${ORG}/channels/${encodeURIComponent(roadmap.channelId)}`;
  const detailColumn = (name) =>
    page.locator(`aside[aria-label="路线图 #${roadmap.number}"]`).getByText(name);
  // The sidebar's row for the roadmap — the roadmaps surface mounted through the whole window.
  const sideRow = (name) =>
    page.getByRole("region", { name: "路线图", exact: true }).getByRole("link", { name, exact: true });

  // Signed in as the admin, on the room's page: the column has read the roadmap (its name is
  // in the column), which is the surface whose reads reach the machine through the proxy.
  const login = await page.request.post(`${base}/api/auth/login`, {
    data: { userId: ADMIN_ID, password: ADMIN_PASSWORD },
  });
  expect(login.ok(), "login").toBeTruthy();
  await page.goto(`${base}${roomPath}`);
  await expect(detailColumn(ROADMAP_NAME)).toBeVisible();

  // The history the window walks: the overview one click away, the room a back away. In-app
  // only — a reload would hand the page a fresh backoff, and a person clicking around never
  // reloads. Walking history is the same popstate the browser's own back button produces.
  await page.getByRole("link", { name: "概览" }).click();
  await page.evaluate(() => history.back());
  await expect(detailColumn(ROADMAP_NAME)).toBeVisible();

  // The link dies. Two log regions are read around the window: the link's death (the page
  // untouched, its room column's poll riding the backoff alone) and the window itself.
  const hubLog = path.join(logs, "hub.log");
  const logFrom = fs.statSync(hubLog).size;
  const linkDiedAt = Date.now();
  await harness.stopMachine();
  // A window is only a window while the machine's server is really down: the hub brings a
  // dead machine's server back on its own within seconds (the reconnect ladder's
  // ensure-server over the held session), so the fixture's fake ssh refuses that restart
  // while the link is held down. The proxy must fail to reach the machine AND stay failing —
  // one early failure is not a window.
  await expect
    .poll(async () => (await admin.get(onMachine("/api/projects"))).ok(), { timeout: 10_000 })
    .toBe(false);
  await page.waitForTimeout(15_000);
  const stayedDead = await admin.get(onMachine("/api/projects"));
  expect(stayedDead.ok(), "the machine's server stayed down on its own").toBe(false);

  // The window: a person clicking around a page whose organization is unreachable — one
  // history step every two seconds, alternating the room (whose channel read fails, so the
  // room's own column never mounts while the link is down) and the overview. The odd steps
  // land on the room, so the window ends there.
  const windowFrom = fs.statSync(hubLog).size;
  const windowStart = Date.now();
  for (let i = 0; i < NAVIGATIONS; i++) {
    const toRoom = i % 2 === 1;
    await page.evaluate((forward) => {
      if (forward) history.forward();
      else history.back();
    }, !toRoom);
    await page.waitForTimeout(NAVIGATION_GAP_MS);
  }
  const windowTo = fs.statSync(hubLog).size;
  const windowMs = Date.now() - windowStart;

  // The log line has no timestamp, so a region is a byte mark: everything appended between
  // two marks is that stretch's own. Every roadmaps read of the organization counts,
  // whichever way it was sent — the proxy-prefixed reads the link failed and the unprefixed
  // one the incident's URL names.
  const region = (from, to) => {
    const fd = fs.openSync(hubLog, "r");
    const bytes = Buffer.alloc(Math.max(0, to - from));
    fs.readSync(fd, bytes, 0, bytes.length, from);
    fs.closeSync(fd);
    return bytes.toString("utf8").split("\n");
  };
  const prefixes = [
    ...new Set([machineId, encodeURIComponent(machineId)]),
  ].flatMap((id) => [
    [`proxy`, `GET /server/${id}/api/projects/${projectId}/organizations/${ORG}/roadmaps`],
    [`sidebar`, `GET /api/projects/${projectId}/organizations/${ORG}/roadmaps`],
  ]);
  const isRoadmaps = (line) => prefixes.some(([, prefix]) => line.startsWith(prefix));
  const isDetail = (line) => /\/roadmaps\/\d+ /.test(line);
  const isPanel = (line) => line.includes("?channel=");
  const roadmapsOf = (lines) => {
    const reads = lines.filter(isRoadmaps);
    return {
      reads,
      byShape: {
        panel: reads.filter(isPanel).length,
        detail: reads.filter((line) => isDetail(line) && !isPanel(line)).length,
        list: reads.filter((line) => !isPanel(line) && !isDetail(line)).length,
      },
    };
  };

  // The link's death, with nobody clicking: what a dead link is asked by the page itself.
  const death = roadmapsOf(region(logFrom, windowFrom));
  console.log(
    `[backoff] the link's death (${((windowStart - linkDiedAt) / 1000).toFixed(0)}s, page untouched): ${death.reads.length} roadmaps reads\n${death.reads.join("\n")}`,
  );

  // The incident's number, measured: every roadmaps read the window's navigations caused.
  const window = roadmapsOf(region(windowFrom, windowTo));
  const total = window.reads.length;
  const perSecond = total / (windowMs / 1000);
  console.log(`[backoff] AC1 window reads:\n${window.reads.join("\n")}`);
  console.log(
    `[backoff] AC1: ${total} roadmaps reads in ${(windowMs / 1000).toFixed(1)}s (${perSecond.toFixed(1)}/s, ${(total * 60_000 / windowMs).toFixed(0)}/min) — panel: ${window.byShape.panel}, detail: ${window.byShape.detail}, list: ${window.byShape.list}`,
  );
  if (!MEASURE_ONLY) {
    // The incident was 2,248 a minute against this endpoint; this ceiling allows every
    // navigation its one read of each surface plus the ladder's half-dozen retries, and stays
    // an order of magnitude under the incident even so.
    expect(total).toBeLessThan(70);
  }

  // The link returns: the machine's server again, connected as an install would.
  harness.restartMachine();
  const connect = await admin.post(
    `${base}/api/projects/${projectId}/machines/${encodeURIComponent(address)}/connect`,
  );
  expect(connect.ok(), `connect the machine again: ${await connect.text()}`).toBeTruthy();
  const deadline = Date.now() + 60_000;
  for (;;) {
    if ((await admin.get(onMachine("/api/projects"))).ok()) break;
    expect(Date.now(), "the proxy answering again").toBeLessThan(deadline);
    await page.waitForTimeout(250);
  }
  const linkBackAt = Date.now();
  const linkBackFrom = fs.statSync(hubLog).size;
  console.log(`[backoff] link back ${((linkBackAt - windowStart - windowMs) / 1000).toFixed(1)}s after the window`);

  // What the page can only know by reading again: the roadmap renamed under it, issued the
  // moment the proxy answers so the read the backoff has waiting lands after it.
  const renamed = await admin.post(
    onMachine(`/api/projects/${projectId}/organizations/${ORG}/actions/roadmap.rename/runs`),
    {
      data: {
        subject: `roadmap:${roadmap.number}`,
        params: { name: RENAMED_NAME },
        via: "web",
      },
    },
  );
  expect(renamed.ok(), `rename the roadmap: ${await renamed.text()}`).toBeTruthy();

  // AC2: the page heals with no one clicking. The sidebar's row — the roadmaps surface mounted
  // through the whole window — shows the new name when the backoff's own retry reads it. On
  // the base there is no retry (a navigation is what re-reads the list, and there is none),
  // so in the measuring run the wait is printed, not asserted.
  const healed = await sideRow(RENAMED_NAME)
    .waitFor({ state: "visible", timeout: HEAL_BUDGET_MS })
    .then(
      () => true,
      () => false,
    );
  const healMs = Date.now() - linkBackAt;
  console.log(
    healed
      ? `[backoff] AC2: the sidebar's row showed the rename ${healMs}ms after the link returned`
      : `[backoff] AC2: the sidebar's row did not heal within ${HEAL_BUDGET_MS}ms of the link returning`,
  );
  if (!MEASURE_ONLY) expect(healed, "the sidebar healed on its own").toBe(true);

  // The room, whole again. Its channel read failed while the link was down, and that surface
  // has a retry button rather than a clock (the base's shape too), so the column is brought
  // back the way a person would: one click to the room from the overview. Every read answers
  // on a live link, and the column shows the rename.
  await page.evaluate(() => history.forward());
  await page
    .getByRole("region", { name: "路线图", exact: true })
    .locator(`a[href$="/channels/${roadmap.channelId}"]`)
    .click();
  const roomHealed = await detailColumn(RENAMED_NAME)
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(
      () => true,
      () => false,
    );
  console.log(
    `[backoff] the room again: the column ${roomHealed ? "shows the rename after one click" : "did not come back"}`,
  );
  if (!MEASURE_ONLY) expect(roomHealed, "the room's column after one click").toBe(true);

  // The heal's own reads, for the record: everything the page asked from the link's return.
  const heal = roadmapsOf(region(linkBackFrom, fs.statSync(hubLog).size));
  console.log(`[backoff] reads after the link returned:\n${heal.reads.join("\n")}`);
});
