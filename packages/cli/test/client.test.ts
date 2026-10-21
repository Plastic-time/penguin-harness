/**
 * Server-client plumbing: connection resolution order (--server > PENGUIN_API_URL >
 * live server.lock > auto-start), the remote-token gate, the SSE parser, and session
 * reference resolution (full id / unique fragment / ambiguity).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  autoStartEntry,
  connectionLabel,
  normalizeServerUrl,
  parseSseBody,
  resolveAgentId,
  resolveConnection,
  resolveProjectId,
  resolveSessionRef,
  ServerClient,
  shortSessionId,
  stopAutoStartedServer,
  waitForServerReady,
} from "../src/client.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");

const ENV_KEYS = [
  "PENGUIN_API_URL",
  "PENGUIN_API_TOKEN",
  "PENGUIN_HOME",
  "PENGUIN_PROJECT_ID",
  "PENGUIN_AGENT_ID",
];
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});
afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("connection resolution", () => {
  it("--server wins over PENGUIN_API_URL; trailing slashes are stripped", async () => {
    process.env.PENGUIN_API_URL = "http://127.0.0.1:7001";
    const conn = await resolveConnection({ server: "http://localhost:7002/" }, t);
    expect(conn.baseUrl).toBe("http://localhost:7002");
    expect(conn.loopback).toBe(true);
    expect(conn.autoStarted).toBe(false);
    // A named server is labelled by its URL alone: no data root stands behind the choice.
    expect(connectionLabel(conn)).toBe("http://localhost:7002");
  });

  it("PENGUIN_API_URL is used when --server is absent", async () => {
    process.env.PENGUIN_API_URL = "http://127.0.0.1:7001";
    const conn = await resolveConnection({}, t);
    expect(conn.baseUrl).toBe("http://127.0.0.1:7001");
  });

  it("a remote URL without PENGUIN_API_TOKEN is refused with the token hint", async () => {
    await expect(resolveConnection({ server: "https://box.example.com" }, t)).rejects.toThrow(
      /PENGUIN_API_TOKEN/,
    );
    process.env.PENGUIN_API_TOKEN = "remote-token";
    const conn = await resolveConnection({ server: "https://box.example.com" }, t);
    expect(conn.baseUrl).toBe("https://box.example.com");
    expect(conn.loopback).toBe(false);
  });

  it("junk URLs are rejected with a localized message", () => {
    expect(() => normalizeServerUrl("not a url", t)).toThrow(/Invalid server URL/);
    expect(() => normalizeServerUrl("ftp://x", t)).toThrow(/Invalid server URL/);
  });

  it("a live server.lock on the data root resolves to http://localhost:<port>", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-lock-"));
    process.env.PENGUIN_HOME = root;
    // Liveness needs a real pid AND an accepting port: use this process and a real listener.
    const listener = net.createServer();
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const port = (listener.address() as net.AddressInfo).port;
    fs.writeFileSync(
      path.join(root, "server.lock"),
      `${JSON.stringify({ pid: process.pid, port, startedAt: "now" })}\n`,
    );
    try {
      const conn = await resolveConnection({}, t);
      expect(conn.baseUrl).toBe(`http://localhost:${port}`);
      expect(conn.autoStarted).toBe(false);
      // Found through the root, so the banner names the root: that tells two local
      // instances apart where the port alone would not.
      expect(connectionLabel(conn)).toBe(`http://localhost:${port} (${root})`);
    } finally {
      listener.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("no server + autoStart disabled -> the no-server error; a stale lock does not count", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-stale-"));
    process.env.PENGUIN_HOME = root;
    // A lock whose port nothing accepts is stale and must be ignored.
    fs.writeFileSync(
      path.join(root, "server.lock"),
      `${JSON.stringify({ pid: process.pid, port: 1, startedAt: "now" })}\n`,
    );
    try {
      await expect(resolveConnection({ autoStart: false }, t)).rejects.toThrow(t.client.noServer());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("autoStartEntry accepts plain-node entries only (a tsx .ts dev entry cannot re-run)", () => {
    expect(autoStartEntry("/x/dist/penguin.js")).toBe(path.resolve("/x/dist/penguin.js"));
    expect(autoStartEntry("/x/dist/penguin.mjs")).not.toBeNull();
    expect(autoStartEntry("/x/src/penguin.ts")).toBeNull();
    expect(autoStartEntry(undefined)).toBeNull();
  });

  it("the auto-started banner names the address, the log, and how to stop the server", () => {
    for (const lang of ["en", "zh"] as const) {
      const text = getMessages(lang).client.autoStarted("http://localhost:42424", "/log/x.log");
      expect(text).toContain("http://localhost:42424");
      expect(text).toContain("/log/x.log");
      expect(text).toContain("penguin server stop");
    }
  });
});

describe("auto-start readiness", () => {
  it("a live lock is not a ready server: the 503 'starting' answer is waited out, any other response is ready", async () => {
    const answers = [
      new Response("penguin-server is starting", { status: 503, headers: { "retry-after": "1" } }),
      new Response("penguin-server is starting", { status: 503 }),
      // The auth middleware's 401 is the App answering — ready.
      new Response("nope", { status: 401 }),
    ];
    let i = 0;
    const fetchFn = (() => Promise.resolve(answers[i++])) as typeof fetch;
    const out = await waitForServerReady("http://localhost:7399", { fetchFn, intervalMs: 1 });
    expect(out).toEqual({ ready: true });
    expect(i).toBe(3);
  });

  it("a 503 that never ends reports the server's own words as the reason", async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response("penguin-server is starting", { status: 503 }))) as typeof fetch;
    const out = await waitForServerReady("http://localhost:7399", {
      fetchFn,
      timeoutMs: 20,
      intervalMs: 5,
    });
    expect(out).toEqual({ ready: false, last: "penguin-server is starting" });
  });

  it("a refused connection keeps polling and resolves when the server comes up", async () => {
    let calls = 0;
    const fetchFn = (() => {
      calls++;
      if (calls < 3) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    const out = await waitForServerReady("http://localhost:7399", { fetchFn, intervalMs: 1 });
    expect(out).toEqual({ ready: true });
    expect(calls).toBe(3);
  });

  it("stopAutoStartedServer reaps a child that ignores SIGTERM (grace, then SIGKILL)", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    // Let the child install its SIGTERM handler before it is asked to die.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await stopAutoStartedServer(child, { graceMs: 500 });
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});

describe("the server's two plain-text 503s", () => {
  const conn = {
    baseUrl: "http://localhost:7399",
    root: "/no-such-root",
    autoStarted: false,
    loopback: true,
    fromRoot: false,
  };
  const cases: Array<{ body: string; code: string; match: RegExp }> = [
    {
      body: "penguin-server is starting",
      code: "starting",
      match: /still starting/,
    },
    {
      body: "penguin-server has no running platform: no generation",
      code: "no_platform",
      match: /no running platform: no generation/,
    },
  ];
  for (const { body, code, match } of cases) {
    it(`a 503 "${body.slice(0, 24)}…" becomes an actionable message, not a bare http_error`, async () => {
      const saved = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(body, { status: 503, headers: { "content-type": "text/plain" } }),
        )) as typeof globalThis.fetch;
      try {
        const client = new ServerClient(conn, t);
        await expect(client.request("GET", "/api/version")).rejects.toMatchObject({
          status: 503,
          code,
          message: expect.stringMatching(match),
        });
      } finally {
        globalThis.fetch = saved;
      }
    });
  }

  it("a 503 with a JSON error body keeps the generic rendering (the server's code is the message)", async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "browser_unavailable", message: "not in the desktop app" },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      )) as typeof globalThis.fetch;
    try {
      const client = new ServerClient(conn, t);
      await expect(client.request("GET", "/api/version")).rejects.toMatchObject({
        status: 503,
        code: "browser_unavailable",
        message: expect.stringContaining("not in the desktop app"),
      });
    } finally {
      globalThis.fetch = saved;
    }
  });
});

describe("SSE parsing", () => {
  async function frames(text: string) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
    const out = [];
    for await (const frame of parseSseBody(body)) out.push(frame);
    return out;
  }

  it("parses id/event/data frames, ignores heartbeat comments, tolerates CRLF", async () => {
    const out = await frames(
      ': ping\r\n\r\nid: 7-1\nevent: server_event\ndata: {"type":"hello"}\n\n' +
        'id: 7-2\ndata: {"a":1}\r\n\r\n',
    );
    expect(out).toEqual([
      { id: "7-1", event: "server_event", data: '{"type":"hello"}' },
      { id: "7-2", data: '{"a":1}' },
    ]);
  });

  it("joins multi-line data with newlines and handles chunk splits mid-line", async () => {
    const text = "data: line1\ndata: line2\n\n";
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(text.slice(0, 9)));
        controller.enqueue(enc.encode(text.slice(9)));
        controller.close();
      },
    });
    const out = [];
    for await (const frame of parseSseBody(body)) out.push(frame);
    expect(out).toEqual([{ data: "line1\nline2" }]);
  });
});

describe("session references", () => {
  it("shortSessionId is the 8-hex tail", () => {
    expect(shortSessionId("session-2026-08-25-10-00-00-00c0ffee")).toBe("00c0ffee");
    expect(shortSessionId("weird")).toBe("weird");
  });

  it("full id passes through; a unique fragment resolves; ambiguity lists candidates; misses error", async () => {
    const server = new FakeServer();
    const restore = server.install();
    try {
      const a = server.addSession({ sessionId: "session-2026-08-25-10-00-00-aaaa1111" });
      server.addSession({ sessionId: "session-2026-08-25-11-00-00-bbbb1111" });
      const client = new ServerClient(await resolveConnection({}, t), t);
      await expect(resolveSessionRef(client, "default_project", a.sessionId, t)).resolves.toBe(
        a.sessionId,
      );
      await expect(resolveSessionRef(client, "default_project", "aaaa1111", t)).resolves.toBe(
        a.sessionId,
      );
      await expect(resolveSessionRef(client, "default_project", "1111", t)).rejects.toThrow(
        /matches 2 sessions/,
      );
      await expect(resolveSessionRef(client, "default_project", "nope", t)).rejects.toThrow(
        /No session matching/,
      );
    } finally {
      restore();
    }
  });
});

describe("option defaults", () => {
  it("project/agent ids: flag > env > built-in default", () => {
    expect(resolveProjectId(undefined)).toBe("default_project");
    expect(resolveAgentId(undefined)).toBe("default_agent");
    process.env.PENGUIN_PROJECT_ID = "env-project";
    process.env.PENGUIN_AGENT_ID = "env-agent";
    expect(resolveProjectId(undefined)).toBe("env-project");
    expect(resolveAgentId(undefined)).toBe("env-agent");
    expect(resolveProjectId("flag-project")).toBe("flag-project");
    expect(resolveAgentId("flag-agent")).toBe("flag-agent");
  });
});
