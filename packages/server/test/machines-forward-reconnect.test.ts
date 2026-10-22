/**
 * The held session's reconnect, from the machine page's side of it: when the ssh session a
 * machine's forward rides is killed from this side (the hub), what the requests of the
 * reconnect window see — and what the transport does about it on its own.
 *
 * - A session is not up until its first command has completed over the ssh child: no "up"
 *   event, no cached session, and the dials of that opening window ride the one open — five
 *   dials, one ssh, all answered. (The window where the page said "connected" while ssh was
 *   still authenticating — 2026-10-21's ECONNREFUSED — is closed from this side.)
 * - A held session killed from the hub side: every dial of the reconnect window merges into
 *   the ONE reopen the transport schedules — five dials, no second ssh — and they all
 *   answer once the session is back, without any of them opening anything.
 * - A dial whose SOCKS listener died under a live session rides one reconnect and dials
 *   once more — bounded: one redial, then the failure is the caller's.
 * - A machine nothing is held to: a dial answers at once and opens nothing.
 * - The reopen streak is bounded and said aloud: eight attempts that never came up, each
 *   one and its wait in the log, and then the transport stops reopening on its own.
 *
 * The `ssh` on PATH is a Node stub: it answers the session's framed commands, binds the
 * `-D` port as a real SOCKS5 server reaching a local echo server, and can be killed or
 * poisoned from the test — POSIX only, like the other stub-ssh suites.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeConnectionTo,
  connectionTo,
  heldSessionOf,
  onSessionChange,
} from "../src/machines/transport/index.js";

// The stub's remote shell is /bin/sh; like the other stub-ssh suites, POSIX only.
const posixOnly = process.platform === "win32" ? describe.skip : describe;

/**
 * A stub `ssh` for the session argv (`… -D 127.0.0.1:<port> <alias> sh`): after
 * FAKE_SSH_DELAY_MS (the TCP + handshake + authentication a real ssh does before it binds
 * the `-D` listener) it binds a SOCKS5 server on that port — a CONNECT there is piped to
 * `127.0.0.1:<target port>`, as a real ssh's channel is — and answers the framed commands
 * on its stdin. Every invocation is appended to FAKE_SSH_LOG (one line per spawn: the
 * count is the "no second ssh" assertion). An alias containing `gone` is a machine that
 * never answers: ssh's own exit, every time — the streak's failure. A `poison` file in
 * FAKE_SSH_CONTROL closes the SOCKS listener and exits FAKE_SSH_EXIT_MS later: the child
 * a live session rode, dying under it.
 */
const STUB_SSH = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const argv = process.argv.slice(2);
const d = argv.indexOf("-D");
const port = d === -1 ? 0 : Number.parseInt(argv[d + 1].split(":").pop(), 10);
const delay = Number.parseInt(process.env.FAKE_SSH_DELAY_MS || "300", 10);
const control = process.env.FAKE_SSH_CONTROL || "";
const exitMs = Number.parseInt(process.env.FAKE_SSH_EXIT_MS || "800", 10);
if (process.env.FAKE_SSH_LOG) fs.appendFileSync(process.env.FAKE_SSH_LOG, argv.join(" ") + "\n");
if (argv.some((a) => a.includes("gone"))) {
  process.stderr.write("ssh: connect to host gone.example port 22: Connection refused\n");
  process.exit(255);
}

// The remote sh: one framed command per line — ( <command> ) 2>&1 ; printf '\n<mark> %s\n' "$?"
// — answered with the command's merged output and the mark line. Queued until the session
// has come up, as a real ssh answers nothing before authentication.
const waiting = [];
let ready = false;
function answer(line) {
  const at = line.indexOf("printf '\\n");
  if (at === -1) return;
  const mark = line.slice(at + 10, line.indexOf(" %s", at));
  const close = line.indexOf(" ) 2>&1 ;");
  const command = line.slice(2, close);
  let code = 0;
  let output = "";
  if (command !== ":") {
    const ran = spawnSync("/bin/sh", ["-c", command], { encoding: "utf8" });
    code = ran.status === null ? 255 : ran.status;
    output = (ran.stdout || "") + (ran.stderr || "");
  }
  process.stdout.write(output + "\n" + mark + " " + code + "\n");
}
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.endsWith('"$?"')) return;
  if (!ready) waiting.push(line);
  else answer(line);
});

let server = null;
setTimeout(() => {
  server = net.createServer((client) => {
    let stage = 0;
    let buffer = Buffer.alloc(0);
    client.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0) {
        if (buffer.length < 2) return;
        const greeting = 2 + buffer[1];
        if (buffer.length < greeting) return;
        buffer = buffer.subarray(greeting);
        stage = 1;
        client.write(Buffer.from([5, 0]));
      }
      if (stage === 1) {
        if (buffer.length < 10) return;
        stage = 2;
        const target = buffer.readUInt16BE(8);
        buffer = buffer.subarray(10);
        const upstream = net.connect({ host: "127.0.0.1", port: target }, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          if (buffer.length > 0) upstream.write(buffer);
          client.pipe(upstream).pipe(client);
        });
        upstream.on("error", () => client.destroy());
      }
    });
    client.on("error", () => {});
  });
  server.on("error", (err) => {
    process.stderr.write(
      "ssh: error: channel_setup_fwd_listener: cannot listen to port: " + err.code + "\n",
    );
    process.exit(255);
  });
  server.listen(port, "127.0.0.1", () => {
    ready = true;
    for (const line of waiting.splice(0)) answer(line);
  });
}, delay);
if (control) {
  const watched = setInterval(() => {
    if (!fs.existsSync(path.join(control, "poison"))) return;
    clearInterval(watched);
    if (server) server.close(() => {});
    setTimeout(() => process.exit(255), exitMs).unref?.();
  }, 40);
  watched.unref?.();
}
`;

/** Waits for `what` by turning the event loop, never a timer; the stub's delays are real. */
async function until(what: () => boolean | Promise<boolean>, said: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await what())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${said}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Whether nothing answers on a local port any more — the stub's SOCKS listener, closed. */
function refusedAt(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect({ host: "127.0.0.1", port });
    probe.once("error", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("connect", () => {
      probe.destroy();
      resolve(false);
    });
  });
}

posixOnly("a machine's forward and its reconnect", () => {
  let stubDir: string;
  let logFile: string;
  let originalPath: string | undefined;
  let originalDelay: string | undefined;
  let echo: net.Server;
  let echoPort: number;
  /** What the transport said on the console — the reconnect's own log, captured. */
  let said: string[][];
  let saidLog: ReturnType<typeof vi.spyOn>;

  const spawns = (): number => {
    try {
      return fs
        .readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .filter((l) => l !== "").length;
    } catch {
      return 0;
    }
  };
  const lines = (): string[] => said.map((call) => call.join(" "));

  beforeEach(async () => {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-forward-reconnect-"));
    logFile = path.join(stubDir, "spawns.log");
    fs.writeFileSync(path.join(stubDir, "ssh"), STUB_SSH);
    fs.chmodSync(path.join(stubDir, "ssh"), 0o755);
    fs.mkdirSync(path.join(stubDir, "control"));
    originalPath = process.env.PATH;
    originalDelay = process.env.FAKE_SSH_DELAY_MS;
    process.env.PATH = `${stubDir}${path.delimiter}${originalPath ?? ""}`;
    process.env.FAKE_SSH_LOG = logFile;
    process.env.FAKE_SSH_CONTROL = path.join(stubDir, "control");
    process.env.FAKE_SSH_DELAY_MS = "300";
    said = [];
    saidLog = vi.spyOn(console, "log").mockImplementation((...call) => {
      said.push(call.map(String));
    });
    echo = net.createServer((socket) => {
      socket.on("error", () => {}); // a hung-up client is not this test's failure
      socket.pipe(socket);
    });
    await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
    echoPort = (echo.address() as net.AddressInfo).port;
  });
  afterEach(() => {
    saidLog.mockRestore();
    for (const address of ["ssh:midway", "ssh:nas", "ssh:poisoned", "ssh:gone", "ssh:never"])
      closeConnectionTo(address);
    process.env.PATH = originalPath;
    if (originalDelay === undefined) delete process.env.FAKE_SSH_DELAY_MS;
    else process.env.FAKE_SSH_DELAY_MS = originalDelay;
    delete process.env.FAKE_SSH_LOG;
    delete process.env.FAKE_SSH_CONTROL;
    fs.rmSync(stubDir, { recursive: true, force: true });
    echo.close();
  });

  it("is not up until the first command completes: no up event in the window, and the dials of the window ride the one open", async () => {
    process.env.FAKE_SSH_DELAY_MS = "1200";
    const events: string[] = [];
    const unwatch = onSessionChange((address, up) =>
      events.push(`${address} ${up ? "up" : "down"}`),
    );
    try {
      const conn = connectionTo({ alias: "midway", user: "deploy" });
      const held = conn.hold(); // in flight through the whole window, not awaited yet

      await until(() => spawns() === 1, "ssh to be spawned");
      // The window: ssh is spawned and handshaking, and the transport says NOTHING is up.
      expect(heldSessionOf("ssh:midway")).toBeNull();
      expect(events).toEqual([]);

      // A page's worth of dials arrives inside the window: every one of them merges
      // into the one open that is already in flight — none opens anything of its own.
      const dials = Array.from({ length: 5 }, () =>
        conn.dial(echoPort).then(
          () => "ok",
          (err: Error) => `err: ${err.message}`,
        ),
      );
      const opened = await held;
      expect(opened.ok).toBe(true);

      expect(await Promise.all(dials)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
      expect(spawns()).toBe(1); // the five dials did not grow a second ssh
      expect(events).toEqual(["ssh:midway up"]); // said once — at the mark, not at spawn
    } finally {
      unwatch();
    }
  });

  it("a session killed from this side: every dial of the reconnect window merges into the one reopen", async () => {
    const events: string[] = [];
    const unwatch = onSessionChange((address, up) =>
      events.push(`${address} ${up ? "up" : "down"}`),
    );
    try {
      const conn = connectionTo({ alias: "nas", user: "deploy" });
      const opened = await conn.hold();
      expect(opened.ok).toBe(true);
      await until(() => events.includes("ssh:nas up"), "the session to be announced up");

      // Kill the ssh session from the hub side, as a dead link or a restart would.
      const session = heldSessionOf("ssh:nas");
      expect(session).not.toBeNull();
      process.kill(session!.pid, "SIGKILL");
      await until(() => events.includes("ssh:nas down"), "the session's death to land");

      // The reconnect window: five dials — a page's worth of requests — arrive while
      // the session is down. All of them wait on the transport's own reopen, and none
      // of them opens a connection: the "no second ssh" the incident asked for.
      const dials = Array.from({ length: 5 }, () =>
        conn.dial(echoPort).then(
          () => "ok",
          (err: Error) => `err: ${err.message}`,
        ),
      );
      expect(await Promise.all(dials)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
      expect(spawns()).toBe(2); // the killed child, and the ONE reopen — nothing beside it
      expect(events).toEqual(["ssh:nas up", "ssh:nas down", "ssh:nas up"]);
      // The reopen said itself in the log: which attempt, and the wait it used.
      expect(lines().some((l) => l.includes("attempt 1 of 8, in 1000 ms"))).toBe(true);
    } finally {
      unwatch();
    }
  });

  it(
    "redials once, bounded, when the SOCKS listener dies under a live session",
    { timeout: 10_000 }, // real children on real timers: a poison exit, a reopen wait, a boot
    async () => {
      const events: string[] = [];
      const unwatch = onSessionChange((address, up) =>
        events.push(`${address} ${up ? "up" : "down"}`),
      );
      try {
        const conn = connectionTo({ alias: "poisoned", user: "deploy" });
        const opened = await conn.hold();
        expect(opened.ok).toBe(true);
        const session = heldSessionOf("ssh:poisoned");
        expect(session).not.toBeNull();

        // The child dies under the session: its SOCKS listener goes first (a dial meets
        // ECONNREFUSED while the session still reads as up), the process FAKE_SSH_EXIT_MS
        // later. The dial must ride the transport's own reopen and try exactly once more.
        fs.writeFileSync(path.join(stubDir, "control", "poison"), "");
        await until(async () => await refusedAt(session!.socksPort), "the SOCKS listener to close");
        const dialled = conn.dial(echoPort);
        await until(
          () => lines().some((l) => l.includes("riding its reconnect")),
          "the dial to say it is riding the reconnect",
        );
        const socket = await dialled;
        socket.destroy();
        expect(spawns()).toBe(2); // the poisoned child, and the one reopen the redial rode
        expect(events).toEqual(["ssh:poisoned up", "ssh:poisoned down", "ssh:poisoned up"]);
      } finally {
        unwatch();
      }
    },
  );

  it("answers a dial at once when nothing is held to the machine — and opens nothing", async () => {
    const conn = connectionTo({ alias: "never", user: "deploy" });
    await expect(conn.dial(echoPort)).rejects.toThrow(/no live session/);
    expect(spawns()).toBe(0); // a dial never turns a machine it cannot reach into a spawn
  });

  it("stops reopening on its own after eight attempts that never came up, and says each one in the log", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const conn = connectionTo({ alias: "gone", user: "deploy" });
      const held = conn.hold(); // spawn 1: ssh's own refusal, before it ever came up
      await until(
        () => lines().some((l) => l.includes("attempt 1 of 8 did not come up")),
        "the first attempt to fail",
      );
      expect((await held).ok).toBe(false);

      // The streak: each failed attempt doubles the wait, to the cap. The waits are the
      // transport's own schedule; the failures are real (the stub exits at once).
      const waits = [1000, 2000, 4000, 8000, 16000, 32000, 60000]; // attempts 2 through 8
      let attempt = 2;
      for (const wait of waits) {
        await vi.advanceTimersByTimeAsync(wait);
        await until(
          () => lines().some((l) => l.includes(`attempt ${attempt} of 8 did not come up`)),
          `attempt ${attempt} to fail`,
        );
        attempt += 1;
      }
      await until(
        () => lines().some((l) => l.includes("stopped reopening on its own")),
        "the streak to stop",
      );
      expect(spawns()).toBe(8); // one ssh per attempt, and no other connection anywhere

      // Each attempt said its wait, and the last one the cap — the log a person reads.
      expect(lines().some((l) => l.includes("attempt 2 of 8, in 1000 ms"))).toBe(true);
      expect(lines().some((l) => l.includes("attempt 8 of 8, in 60000 ms"))).toBe(true);

      // Nothing more: ten minutes of schedule (fake time) spawn nothing.
      await vi.advanceTimersByTimeAsync(600_000);
      await new Promise((resolve) => setImmediate(resolve));
      expect(spawns()).toBe(8);
    } finally {
      vi.useRealTimers();
    }
  });
});
