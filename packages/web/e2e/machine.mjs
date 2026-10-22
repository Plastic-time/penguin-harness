/**
 * e2e helper: a hub and one connected machine on this box, for specs about what the Web App does
 * through the hub's `/server/<machineId>/` proxy.
 *
 * Both are real servers from this checkout's build, each on a temp data root of its own, and the
 * hub reaches the machine the way it reaches any machine: one `ssh` session whose shell runs the
 * machine's commands and whose `-D` port carries every connection to it. Only two things stand
 * in for a real remote:
 *
 * - `ssh` itself. The hub finds a small script of that name first on its PATH; it runs `/bin/sh`
 *   with the machine's HOME and answers SOCKS5 on the `-D` port, which is all the hub asks of an
 *   ssh session. No sshd, no keys, and the account's own `~/.ssh` and `~/.penguin` are never
 *   touched (the hub's HOME is a temp directory holding the one `Host` entry).
 * - The install. A hub run from a checkout has no release to install, so the machine's program
 *   directory is laid out by hand (the bundled runtime as a link to this Node, the CLI entry as
 *   an import of this checkout's CLI), its server is started here, and the hub's record that it
 *   installed there is written into its database. Connecting is then the hub's own job: probe,
 *   hold the session, mint a token over there, hand over the Model config.
 *
 * The spec owns the processes: `stop()` ends both servers, the machine's own connect-started
 * one included (it is not a child of anything here), and removes the temp directory.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { request } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD } from "./auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVER_ENTRY = path.join(ROOT, "packages/server/dist/index.js");
const CLI_ENTRY = path.join(ROOT, "packages/cli/dist/penguin.js");
const WEB_DIST = path.join(ROOT, "packages/web/dist");
const ALIAS = "e2e-machine";
const ADDRESS = `ssh:${ALIAS}`;
/** What the hub's record says it installed; only compared against, never run. */
const VERSION = "0.0.0-e2e";

/** `ssh`, as far as the hub can tell: a shell on the machine, and SOCKS5 on the `-D` port. */
const FAKE_SSH = `#!/usr/bin/env node
const net = require("node:net");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const home = process.env.PENGUIN_E2E_MACHINE_HOME;
let socksPort = null;
const words = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-D") socksPort = Number(args[++i].split(":").pop());
  // -S names the control socket this session masters (the ssh kind's "M -S <path>" on POSIX):
  // its value is a path, not the host, and must not be read as a command word.
  else if (args[i] === "-o" || args[i] === "-S") i++;
  else if (!args[i].startsWith("-")) words.push(args[i]);
}
const command = words[1];
// A spec holding the machine's server down (stopMachine) parks this file in the machine's
// HOME: starting it again is refused, whatever on the hub side asks — the hub brings a
// dead machine's server back within seconds on its own (the reconnect ladder's
// ensure-server, arriving as a command over this very session), which would end the
// "link is down" window before it began. One-shot execs and the held session's own command
// lines are both covered; every other command runs as before.
const hold = () => fs.existsSync(home + "/.penguin-hold-server");
// A clean environment: the hub's own PENGUIN_* would make the machine answer as the hub.
const env = { PATH: process.env.PATH, HOME: home, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
const run = () => {
  if (hold() && command !== undefined && /penguin-hmr\\.js" server --host/.test(command)) {
    process.exit(1);
  }
  const session = command === "sh";
  const shell = spawn("/bin/sh", session ? [] : ["-c", command], {
    cwd: home,
    env,
    // A held session's commands arrive on this stdin one line at a time (the host frames
    // each as a single newline-ended line), so the hold's refusal has to live HERE as well:
    // the hub's own restart of the machine's server comes as one of those lines, not as a
    // one-shot exec. The start line is answered with a failing echo inside its own frame,
    // so the hub reads a clean failure and its ladder backs off rather than waiting out a
    // hung session; every other line passes through untouched.
    ...(session ? { stdio: ["pipe", "inherit", "inherit"] } : { stdio: "inherit" }),
  });
  if (session) {
    let pending = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      pending += chunk;
      for (;;) {
        const nl = pending.indexOf("\\n");
        if (nl === -1) break;
        const line = pending.slice(0, nl + 1);
        pending = pending.slice(nl + 1);
        shell.stdin.write(
          hold() && /penguin-hmr\\.js" server --host/.test(line)
            ? line.replace(/^\\(.*\\) 2>&1 ;/, '( echo "server start held down" >&2; exit 1 ) 2>&1 ;')
            : line,
        );
      }
    });
    process.stdin.on("end", () => {
      shell.stdin.write(pending);
      shell.stdin.end();
    });
  }
  shell.on("exit", (code) => process.exit(code ?? 255));
};
if (socksPort === null) run();
else {
  // Just enough SOCKS5 to answer a CONNECT to an IPv4 address: greet, connect, pipe.
  net
    .createServer((client) => {
      let stage = 0;
      let buffer = Buffer.alloc(0);
      client.on("error", () => {});
      client.on("data", (chunk) => {
        if (stage === 2) return;
        buffer = Buffer.concat([buffer, chunk]);
        if (stage === 0) {
          if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
          buffer = buffer.subarray(2 + buffer[1]);
          stage = 1;
          client.write(Buffer.from([5, 0]));
        }
        if (stage === 1) {
          if (buffer.length < 10) return;
          stage = 2;
          const port = buffer.readUInt16BE(8);
          const rest = buffer.subarray(10);
          const upstream = net.connect({ host: "127.0.0.1", port }, () => {
            client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
            if (rest.length > 0) upstream.write(rest);
            client.pipe(upstream).pipe(client);
          });
          upstream.on("error", () => client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
        }
      });
    })
    .listen(socksPort, "127.0.0.1", run);
}
`;

async function waitFor(what, probe, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (err) {
      last = err;
    }
    if (Date.now() > deadline)
      throw new Error(`${what} did not happen in time${last ? `: ${last}` : ""}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** A server of this checkout on `port` and `dataRoot`, with nothing inherited but PATH. */
function startServer({ port, dataRoot, home, extraEnv = {}, logFile }) {
  const log = fs.openSync(logFile, "a");
  return spawn(process.execPath, [SERVER_ENTRY], {
    cwd: home,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PENGUIN_HOME: dataRoot,
      PORT: String(port),
      HOST: "127.0.0.1",
      PENGUIN_SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
      ...extraEnv,
    },
    stdio: ["ignore", log, log],
  });
}

/**
 * Starts a hub and a machine and connects them. `model` is the Project's Model config (PUT
 * /models), handed to the machine as part of connecting. `plugins` names plugin packages both
 * servers are to run (`[plugins]` in the Project's config, `*` for the version — the closure is
 * configuration, plugin/loader.ts), resolved from the checkout's bundled plugin directory
 * (stage it first: `node scripts/build-plugins.mjs --out packages/server/plugins`).
 *
 * Answers the hub's address, the Project, the machine's id as the proxy names it, the machine's
 * address as `connect` takes it, an existing directory on the machine for an organization to
 * name as its shared workspace, an admin request context signed in to the hub,
 * `restartMachine` (the machine's server again, on its same data root and port — a spec kills it
 * to take the link down and restarts it to bring it back), `stopMachine` (ends the machine's
 * servers — the fixture's own and the one `connect` started on the machine, which is the one
 * the proxy reaches — and waits for the exit: the link's death) and `stop`.
 */
export async function startHubWithMachine({ hubPort, machinePort, model, plugins = [] }) {
  for (const built of [SERVER_ENTRY, CLI_ENTRY, path.join(WEB_DIST, "index.html")]) {
    if (!fs.existsSync(built))
      throw new Error(`${built} is missing: build server, cli and web first`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-e2e-machine-"));
  const machineHome = path.join(dir, "machine-home");
  /** An existing directory on the machine an organization can name as its shared workspace. */
  const machineWorkspace = path.join(machineHome, "workspaces");
  const hubHome = path.join(dir, "hub-home");
  const hubData = path.join(dir, "hub-data");
  const program = path.join(machineHome, ".penguin");
  // The machine's data root is where a real install puts it — `<program>/data`, the release
  // layout connect reaches (machines/layout.ts: `$HOME/.penguin/data`) — so the server
  // connect starts there reads the same Project config (and its [plugins] table) as this
  // fixture's own server on the same root.
  const machineDataRoot = path.join(program, "data");
  const bin = path.join(dir, "bin");
  for (const made of [
    `${program}/node/bin`,
    `${program}/lib/dist`,
    `${hubHome}/.ssh`,
    hubData,
    machineDataRoot,
    bin,
    machineWorkspace,
  ]) {
    fs.mkdirSync(made, { recursive: true });
  }
  fs.symlinkSync(process.execPath, `${program}/node/bin/node`);
  fs.writeFileSync(`${program}/lib/package.json`, JSON.stringify({ version: VERSION }));
  fs.writeFileSync(`${program}/lib/dist/penguin-hmr.js`, `import ${JSON.stringify(CLI_ENTRY)};\n`);
  fs.writeFileSync(`${program}/lib/dist/package.json`, JSON.stringify({ type: "module" }));
  fs.writeFileSync(`${hubHome}/.ssh/config`, `Host ${ALIAS}\n  HostName 127.0.0.1\n`);
  fs.writeFileSync(`${bin}/ssh`, FAKE_SSH, { mode: 0o755 });
  // What a fresh data root never has: plugins. The Project asks for them by name (the config
  // is the source of truth for what runs), each server reads its Project's table at boot. A
  // Project is a directory DIRECTLY under the data root — `<root>/<projectId>` — and this
  // fresh root's one Project is the default one (core state/paths.ts projectDir).
  if (plugins.length > 0) {
    const config =
      ["[plugins]", ...plugins.map((name) => `${JSON.stringify(name)} = "*"`)].join("\n") + "\n";
    for (const dataRoot of [hubData, machineDataRoot]) {
      fs.mkdirSync(path.join(dataRoot, "default_project"), { recursive: true });
      fs.writeFileSync(
        path.join(dataRoot, "default_project", ".project_config.toml"),
        config,
      );
    }
  }

  /** Every server process the spec caused: `stop` ends them all, however many restarts. */
  const procs = [];
  /** The machine's live process — the last one started, the initial one or a restart's. */
  let machineProc = startServer({
    port: machinePort,
    dataRoot: machineDataRoot,
    home: machineHome,
    logFile: path.join(dir, "machine.log"),
  });
  procs.push(machineProc);
  procs.push(
    startServer({
      port: hubPort,
      dataRoot: hubData,
      home: hubHome,
      extraEnv: {
        PATH: `${bin}:${process.env.PATH}`,
        PENGUIN_WEB_DIST: WEB_DIST,
        PENGUIN_E2E_MACHINE_HOME: machineHome,
      },
      logFile: path.join(dir, "hub.log"),
    }),
  );
  /** The machine's server again: the same data root, port and log — the link it held is gone
   *  with the old process, and the hub reconnects when the spec connects it again. The hold
   *  a stopMachine parked is lifted first: starting it is allowed again. */
  const restartMachine = () => {
    try {
      fs.rmSync(path.join(machineHome, ".penguin-hold-server"), { force: true });
    } catch {
      // No hold was parked.
    }
    machineProc = startServer({
      port: machinePort,
      dataRoot: machineDataRoot,
      home: machineHome,
      logFile: path.join(dir, "machine.log"),
    });
    procs.push(machineProc);
    return machineProc;
  };
  /** Ends the machine's server — a spec's stand-in for the link dying — and waits for the
   *  exit. That is TWO servers: this fixture's own (in `procs`) and the one `connect` starts
   *  on the machine over the shared shell (nohup … &, not a child of anything here) — the
   *  proxy reaches the latter, so killing the fixture's own alone would not take the link
   *  down. What names the connect-started one is this pair's unique temp path, all its
   *  command line says it is; `endMachineProcesses` ends both and waits until neither is left. */
  const endMachineProcesses = async () => {
    if (machineProc.exitCode === null) machineProc.kill();
    try {
      // Nothing to kill before a connect ran (pgrep's exit 1 says so); the fixture's own
      // server is not matched — its command line is this checkout's dist path, not the temp.
      spawnSync("pkill", ["-f", dir]);
    } catch {
      // penguin's own shell may have ended with the session already.
    }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (spawnSync("pgrep", ["-f", dir]).status !== 0) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (machineProc.exitCode === null)
      await new Promise((resolve) => machineProc.once("exit", resolve));
  };
  /** Ends the machine's server — a spec's stand-in for the link dying — and holds it down:
   *  the hold file makes the fake ssh refuse the hub's own restart of it, which otherwise
   *  happens within seconds and would end the window before it began. Two servers end, this
   *  fixture's own (in `procs`) and the one `connect` started on the machine over the shared
   *  shell (nohup … &, not a child of anything here) — the proxy reaches the latter. */
  const stopMachine = async () => {
    fs.writeFileSync(path.join(machineHome, ".penguin-hold-server"), "1");
    await endMachineProcesses();
  };
  const stop = async () => {
    // The machine's processes first, held down while they go — the hub would restart the
    // connect-started server within seconds otherwise, and outlive this pair as a leak —
    // then the rest (the hub, and any machine process a restart left).
    try {
      fs.writeFileSync(path.join(machineHome, ".penguin-hold-server"), "1");
    } catch {
      // The temp tree is already gone.
    }
    await endMachineProcesses();
    for (const server of procs) if (server.exitCode === null) server.kill();
    await Promise.all(
      procs.map((server) =>
        server.exitCode !== null ? null : new Promise((resolve) => server.once("exit", resolve)),
      ),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  };

  try {
    const base = `http://localhost:${hubPort}`;
    // Any answer BUT the starting placeholder: the port binds before the App exists, and a
    // hub loading plugins answers 503 "penguin-server is starting" for a while (hmr/starting.ts)
    // — /api/me's 401 means ready, the placeholder does not.
    const up = (port) =>
      fetch(`http://localhost:${port}/api/me`).then((res) => res.status !== 503);
    await waitFor("the machine's server starting", () => up(machinePort));
    await waitFor("the hub starting", () => up(hubPort));

    const admin = await request.newContext({ baseURL: base });
    const signedIn = await admin.post("/api/auth/login", {
      data: { userId: ADMIN_ID, password: ADMIN_PASSWORD },
    });
    if (!signedIn.ok()) throw new Error(`hub login failed: ${await signedIn.text()}`);
    const projectId = (await (await admin.get("/api/projects")).json()).projects[0].projectId;
    const models = await admin.put(`/api/projects/${projectId}/models`, { data: model });
    if (!models.ok()) throw new Error(`hub models failed: ${await models.text()}`);

    // The record an install would have left: the hub installed there, and the Project uses it.
    const db = new DatabaseSync(path.join(hubData, "web.db"));
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.prepare(
        "INSERT OR REPLACE INTO machines (address, version, installed_at, platform) VALUES (?, ?, ?, 'linux')",
      ).run(ADDRESS, VERSION, new Date().toISOString());
      db.prepare(
        "INSERT OR REPLACE INTO machine_project (project_id, addresses) VALUES (?, ?)",
      ).run(projectId, JSON.stringify([ADDRESS]));
    } finally {
      db.close();
    }

    const machinesPath = `/api/projects/${projectId}/machines`;
    const connect = await admin.post(`${machinesPath}/${encodeURIComponent(ADDRESS)}/connect`);
    if (!connect.ok())
      throw new Error(`connect refused: ${connect.status()} ${await connect.text()}`);
    const machineId = await waitFor(
      "the machine connecting",
      async () => {
        const listing = await (await admin.get(machinesPath)).json();
        const failed = (listing.jobs ?? []).find((job) => job.result && job.result.ok === false);
        if (failed) throw new Error(`connect failed: ${JSON.stringify(failed.result)}`);
        const machine = listing.machines.find((entry) => entry.id === ADDRESS);
        return machine?.connection && machine.machineId ? machine.machineId : null;
      },
      60_000,
    );
    await waitFor("the proxy answering", async () =>
      (await admin.get(`/server/${machineId}/api/projects`)).ok(),
    );
    return {
      base,
      projectId,
      machineId,
      address: ADDRESS,
      /** An existing directory on the machine, for an organization created on it to name. */
      workspace: machineWorkspace,
      /** The log of the server connect starts on the machine — a spec's failure detail. */
      machineServerLog: path.join(machineDataRoot, "server.log"),
      admin,
      logs: dir,
      restartMachine,
      stopMachine,
      stop,
    };
  } catch (err) {
    const tail = (file) => {
      try {
        return fs.readFileSync(file, "utf8").split("\n").slice(-25).join("\n");
      } catch {
        return "";
      }
    };
    const logs =
      `--- hub.log ---\n${tail(path.join(dir, "hub.log"))}` +
      `\n--- machine.log ---\n${tail(path.join(dir, "machine.log"))}` +
      `\n--- machine's server.log (connect-started) ---\n${tail(path.join(machineDataRoot, "server.log"))}`;
    await stop();
    throw new Error(`${err instanceof Error ? err.message : err}\n${logs}`);
  }
}
