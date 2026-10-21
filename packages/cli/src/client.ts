/**
 * The CLI's server client: connection resolution, Bearer-token auth, JSON requests, and
 * a dependency-free fetch-based SSE consumer (the HMR deploy path bundles this file with
 * esbuild, so everything here rides on globals — fetch above all).
 *
 * Connection resolution order (first hit wins):
 *   1. `--server <url>` — an explicit target. A non-loopback URL requires
 *      PENGUIN_API_TOKEN: the on-disk token file belongs to the LOCAL data root and must
 *      never be sent to a remote host.
 *   2. `PENGUIN_API_URL` — the same, from the environment. Server-driven sessions inject
 *      it (with PENGUIN_API_TOKEN) into tool subprocesses, which is how an agent's own
 *      `penguin` calls find the server that runs them.
 *   3. A live `server.lock` at the data root (PENGUIN_HOME or ~/.penguin/data): attach to
 *      the running local server on `http://localhost:<port>`. A `penguin` started through a
 *      server's `<root>/bin/penguin` shim — in that server's terminals and Agent commands —
 *      gets that server's root as PENGUIN_HOME unless its caller set one (the server's
 *      services/cli-shim.ts), so it attaches to that server rather than the installed one.
 *   4. Auto-start: spawn a detached `node <cli entry> server` with PORT=0, wait for its
 *      lock AND for the server to answer real requests, attach. The loser of a two-CLI
 *      spawn race exits with code 3 ("already running"), which the lock poll absorbs —
 *      it finds the winner's lock either way. A server that never becomes ready is
 *      reaped again (stopAutoStartedServer), so a failed auto-start leaves nothing behind.
 *
 * Token resolution: PENGUIN_API_TOKEN, else `<root>/api-token` (written by the server
 * each boot). A 401 with a file-sourced token re-reads the file once and retries — the
 * server may have restarted (and rotated the token) since the first read.
 *
 * A 403 `human_required` — a write the server takes only from a person's sign-in, such as
 * those that change an Agent's exposure — retries the same request once as the person's
 * stored sign-in (`<root>/cli-session.json`, written by `penguin auth login` or
 * `penguin auth token`), sent as the `penguin_session` cookie in place of the token. Only for
 * a loopback target, only for a sign-in made to a loopback server, and only outside a Session
 * (PENGUIN_SESSION_ID unset): inside one the command is an Agent's, and the refusal is the
 * point. Every other request goes exactly as above.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveRoot } from "@prismshadow/penguin-core";
import { liveServerLock, readServerLock } from "@prismshadow/penguin-server/lock";
import type { ServerLock } from "@prismshadow/penguin-server/lock";
import { readSession } from "./auth-session.js";
import type { Messages } from "./i18n.js";

/** Session-id shape (core's convention); a full id needs no directory search. */
const SESSION_ID_RE = /^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/;

/** Hosts that count as this machine for token-file purposes. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** How the auth token was obtained; decides whether a 401 retries after re-reading the file. */
export type TokenSource = "env" | "file" | "none";

/** The server's session cookie (auth/middleware.ts SESSION_COOKIE): a stored sign-in goes as it. */
const SESSION_COOKIE = "penguin_session";

/** The server's refusal of the local API token on a write only a person may make (requireHuman). */
const HUMAN_REQUIRED = "human_required";

/**
 * The openers of the server's two plain-text 503 bodies (server/src/hmr/starting.ts) —
 * what the entry answers before buildApp() and the HMR seam answers with no platform
 * current. Matched by prefix so wording tweaks beyond the opener do not drift; a body
 * starting with neither keeps the generic `http_error` rendering.
 */
const STARTING_BODY = "penguin-server is starting";
const NO_PLATFORM_BODY = "penguin-server has no running platform: ";

export interface Connection {
  /** Normalized base URL, no trailing slash. */
  baseUrl: string;
  /** Data root used for the token file and the lock (resolution-time value). */
  root: string;
  /** Whether this call auto-started the server (surfaced to the user on stderr). */
  autoStarted: boolean;
  /** Whether the target host is loopback (gates the file-token fallback). */
  loopback: boolean;
  /**
   * Whether the server was found through `root` — its live lock, or one auto-started there —
   * rather than named by `--server` / PENGUIN_API_URL; then the root says which instance it is.
   */
  fromRoot: boolean;
}

/**
 * Which server a connection talks to, as the chat and run banners show it: the URL, and the
 * data root behind it when that is how it was found — the part that tells two local
 * instances apart, the installed app and a development server among them.
 */
export function connectionLabel(conn: Connection): string {
  return conn.fromRoot ? `${conn.baseUrl} (${conn.root})` : conn.baseUrl;
}

/** One parsed SSE frame; `data` is the raw payload (possibly multi-line joined). */
export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

export function isLoopbackUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

/** Strips trailing slashes and validates the scheme; throws a localized error on junk. */
export function normalizeServerUrl(raw: string, t: Messages): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(t.client.invalidServerUrl(raw));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(t.client.invalidServerUrl(raw));
  }
  return url;
}

/** The token file the server writes each boot (kept in sync with the server's auth/api-token.ts). */
export function apiTokenPath(root: string): string {
  return path.join(root, "api-token");
}

function readTokenFile(root: string): string | null {
  try {
    const value = fs.readFileSync(apiTokenPath(root), "utf8").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * The person's stored sign-in on this data root, for the one retry after a `human_required`
 * refusal (see the module doc); null inside a Session, where the command is an Agent's, and for a
 * sign-in to a server elsewhere, whose session must not be sent to this one.
 */
function readStoredSignIn(root: string): string | null {
  if (process.env.PENGUIN_SESSION_ID?.trim()) return null;
  const session = readSession(root);
  if (session === null) return null;
  try {
    return isLoopbackUrl(new URL(session.server)) ? session.token : null;
  } catch {
    return null;
  }
}

/** The error code of a JSON error body (`{error: {code}}`), or null for any other body. */
async function errorCodeOf(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } } | null;
    return typeof body?.error?.code === "string" ? body.error.code : null;
  } catch {
    return null;
  }
}

/**
 * The CLI entry script for auto-start, or null when this process cannot re-run itself
 * with plain node (a tsx dev run has a .ts entry) — same rule as serve.ts's cliEntryFor.
 */
export function autoStartEntry(argv1: string | undefined): string | null {
  if (!argv1) return null;
  return /\.(js|mjs|cjs)$/i.test(argv1) ? path.resolve(argv1) : null;
}

/** yyyy-mm-dd of the local clock (log file naming). */
function localDate(d = new Date()): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * One readiness probe's verdict: ready, or the server's own last word on why not (the
 * text of its last 503, or the fetch error) — what an auto-start failure reports.
 */
export type ReadinessOutcome = { ready: true } | { ready: false; last: string };

/**
 * Waits until a server answers real requests. A live lock is NOT that: the server entry
 * binds its port and records the data-root lock BEFORE the App exists, and until
 * buildApp() every request — the CLI's first included — is answered 503
 * "penguin-server is starting" (plain text, `retry-after: 1`) without ever reaching the
 * access log. Ready is therefore any response that is not a 503: the auth middleware
 * answering 401 proves the App is up — and that its boot token is on disk, since
 * createApp mints it before the entry can route anything.
 */
export async function waitForServerReady(
  baseUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number; fetchFn?: typeof fetch } = {},
): Promise<ReadinessOutcome> {
  const fetchFn = opts.fetchFn ?? fetch;
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  let last = "no response yet";
  for (;;) {
    try {
      // Each probe is capped so a port held by something that never answers cannot wedge
      // the loop; `redirect: "manual"` keeps a loopback canonicalization 302 from being
      // followed — the probe only asks whether the App is behind the port.
      const res = await fetchFn(`${baseUrl}/api/version`, {
        redirect: "manual",
        signal: AbortSignal.timeout(1000),
      });
      if (res.status !== 503) {
        void res.body?.cancel();
        return { ready: true };
      }
      last = (await res.text()).trim();
    } catch (err) {
      // Refused/reset mid-boot: the listener is not answering yet; keep polling.
      last = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() >= deadline) return { ready: false, last };
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs ?? 250));
  }
}

/**
 * Stops a server this invocation spawned: SIGTERM, a bounded wait, then SIGKILL. On POSIX
 * the spawn was detached, so the child leads its own process group and one negative-pid
 * signal reaches the supervising CLI process AND the service under it (the lock's pid);
 * Windows has no group signals, so the pids this flow knows are signalled one by one.
 * SIGTERM lets a finished boot drain and release its root; a server still before
 * buildApp() never reacts to it (its shutdown path needs deps it does not have yet), and
 * a server that never served a request is exactly what must not be left running.
 */
export async function stopAutoStartedServer(
  child: ChildProcess,
  opts: { root?: string; lockPid?: number; graceMs?: number } = {},
): Promise<void> {
  const grace = opts.graceMs ?? 5_000;
  const group = process.platform !== "win32";
  const pids: number[] = [];
  if (typeof opts.lockPid === "number") pids.push(opts.lockPid);
  if (typeof child.pid === "number") pids.push(child.pid);
  const signal = (sig: NodeJS.Signals): void => {
    for (const pid of pids) {
      try {
        process.kill(group ? -pid : pid, sig);
      } catch {
        // Already gone (or never there): the polls below observe it.
      }
    }
  };
  const childGone = (): boolean => child.exitCode !== null || child.signalCode !== null;
  // The server side of the stop is done when the lock no longer names it (a graceful
  // exit releases the lock; a stale file left by SIGKILL is overwritten by the next boot).
  const lockReleased = (): boolean => {
    if (opts.root === undefined || opts.lockPid === undefined) return true;
    const held = readServerLock(opts.root);
    return held === null || held.pid !== opts.lockPid;
  };
  signal("SIGTERM");
  const deadline = Date.now() + grace;
  for (;;) {
    if (childGone() && lockReleased()) return;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  signal("SIGKILL");
  // SIGKILL leaves no graceful path to observe: wait out only the child's exit event.
  const killDeadline = Date.now() + Math.min(grace, 2_000);
  while (!childGone() && Date.now() < killDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Spawns a detached local server (PORT=0 → ephemeral port), logs to
 * `<root>/logs/server-auto-<date>.log`, waits for a live lock on the root AND for the
 * server behind it to answer real requests. The lock poll accepts ANY live server on
 * the root: if a concurrent CLI won the spawn race, our child exits 3 and the winner's
 * lock satisfies the wait just the same. A boot that fails or never becomes ready is
 * reaped (stopAutoStartedServer) before the error is thrown, so this flow leaves no
 * server behind that the user never got anything from.
 */
export async function autoStartServer(
  root: string,
  t: Messages,
  opts: { timeoutMs?: number; readyTimeoutMs?: number } = {},
): Promise<{ port: number; logPath: string }> {
  const entry = autoStartEntry(process.argv[1]);
  if (entry === null) throw new Error(t.client.autoStartUnavailable());
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  const logPath = path.join(root, "logs", `server-auto-${localDate()}.log`);
  const fd = fs.openSync(logPath, "a");
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [entry, "server"], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, PORT: "0" },
    });
  } finally {
    fs.closeSync(fd);
  }
  let exitCode: number | null = null;
  child.on("error", () => {
    exitCode = -1;
  });
  child.on("exit", (code) => {
    exitCode = code ?? -1;
  });
  child.unref();

  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  let lock: ServerLock;
  for (;;) {
    const found = await liveServerLock(root);
    if (found !== null) {
      lock = found;
      break;
    }
    // Exit 3 = "another server owns this root" — the race's loser; keep polling for the
    // winner's lock. Any other exit is a startup failure: reap ours and point at the log.
    if (exitCode !== null && exitCode !== 3) {
      await stopAutoStartedServer(child, { root });
      throw new Error(t.client.autoStartFailed(logPath));
    }
    if (Date.now() >= deadline) {
      await stopAutoStartedServer(child, { root });
      throw new Error(t.client.autoStartFailed(logPath));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // The lock is live, but the server answers 503 "starting" until its App is built —
  // that window is exactly where a lock-only wait loses the user's request.
  const ready = await waitForServerReady(`http://localhost:${lock.port}`, {
    timeoutMs: opts.readyTimeoutMs ?? 30_000,
  });
  if (ready.ready) return { port: lock.port, logPath };
  // A server our own child is still supervising is ours to reap; one a concurrent CLI
  // won the race with (our child exited 3, or died under us) is not — say where it is
  // and how to stop it instead, and a server that already died needs neither.
  const ours = child.exitCode === null && child.signalCode === null;
  const url = `http://localhost:${lock.port}`;
  if (ours) {
    await stopAutoStartedServer(child, { root, lockPid: lock.pid });
    throw new Error(t.client.autoStartStopped(url, ready.last, logPath));
  }
  if ((await liveServerLock(root)) !== null) {
    throw new Error(t.client.autoStartStillRunning(url, ready.last, logPath));
  }
  throw new Error(t.client.autoStartFailed(logPath));
}

/** Resolves where to connect (see the module doc for the order); may auto-start a server. */
export async function resolveConnection(
  opts: { server?: string; autoStart?: boolean },
  t: Messages,
): Promise<Connection> {
  const root = resolveRoot();
  const explicit = opts.server?.trim() || process.env.PENGUIN_API_URL?.trim() || "";
  if (explicit !== "") {
    const url = normalizeServerUrl(explicit, t);
    const loopback = isLoopbackUrl(url);
    if (!loopback && !process.env.PENGUIN_API_TOKEN?.trim()) {
      throw new Error(t.client.remoteNeedsToken(url.origin));
    }
    return { baseUrl: url.origin, root, autoStarted: false, loopback, fromRoot: false };
  }
  const lock = await liveServerLock(root);
  if (lock !== null) {
    return {
      baseUrl: `http://localhost:${lock.port}`,
      root,
      autoStarted: false,
      loopback: true,
      fromRoot: true,
    };
  }
  if (opts.autoStart === false) throw new Error(t.client.noServer());
  const { port, logPath } = await autoStartServer(root, t);
  const conn: Connection = {
    baseUrl: `http://localhost:${port}`,
    root,
    autoStarted: true,
    loopback: true,
    fromRoot: true,
  };
  process.stderr.write(`${t.client.autoStarted(conn.baseUrl, logPath)}\n`);
  return conn;
}

/**
 * Error the client raises for non-2xx responses; `code` is the server's error code when the body
 * carried one, and `body` the parsed JSON body itself (undefined when it was not JSON), for a
 * command that renders the server's own words or reads a field beside the code.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }

  /** The server's own message, unwrapped (empty when the body carried none) — for a caller that localizes the code and still needs the specifics. */
  get detail(): string {
    const message = (this.body as { error?: { message?: unknown } } | null | undefined)?.error
      ?.message;
    return typeof message === "string" ? message : "";
  }
}

export class ServerClient {
  private token: string | null;
  private tokenSource: TokenSource;

  constructor(
    readonly conn: Connection,
    private readonly t: Messages,
  ) {
    const envToken = process.env.PENGUIN_API_TOKEN?.trim();
    if (envToken) {
      this.token = envToken;
      this.tokenSource = "env";
    } else if (conn.loopback) {
      this.token = readTokenFile(conn.root);
      this.tokenSource = this.token !== null ? "file" : "none";
    } else {
      this.token = null;
      this.tokenSource = "none";
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...(this.token !== null ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  /**
   * One JSON request. 401 with a file-sourced token re-reads the file once (the server
   * may have restarted and rotated it) and retries; 403 `human_required` retries once as the
   * person's stored sign-in (see fetchAuthed); every other non-2xx becomes an ApiError
   * carrying the server's code and message.
   */
  async request<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
    const res = await this.fetchAuthed(apiPath, {
      method,
      headers: this.headers(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw await this.toError(res);
    if (res.status === 204 || res.headers.get("content-length") === "0") {
      void res.body?.cancel();
      return undefined as T;
    }
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }

  /**
   * The authenticated fetch: the one-shot 401 file-token refresh, then the one-shot retry of a
   * 403 `human_required` as the person's stored sign-in.
   */
  private async fetchAuthed(apiPath: string, init: RequestInit): Promise<Response> {
    const res = await this.fetchWithToken(apiPath, init);
    return res.status === 403 ? this.retryAsPerson(apiPath, init, res) : res;
  }

  /** The token's fetch, with the one-shot 401 file-token refresh. */
  private async fetchWithToken(apiPath: string, init: RequestInit): Promise<Response> {
    const res = await fetch(`${this.conn.baseUrl}${apiPath}`, init);
    if (res.status !== 401) return res;
    if (this.tokenSource === "env" || !this.conn.loopback) return res;
    const fresh = readTokenFile(this.conn.root);
    if (fresh === null || fresh === this.token) return res;
    void res.body?.cancel();
    this.token = fresh;
    this.tokenSource = "file";
    const headers = { ...(init.headers as Record<string, string>), ...this.headers() };
    return fetch(`${this.conn.baseUrl}${apiPath}`, { ...init, headers });
  }

  /**
   * `refused` was a 403. When it is `human_required` and there is a stored sign-in to use (see the
   * module doc), sends the same request once more as that sign-in — the session cookie, no
   * Bearer, since the server reads a Bearer first — and answers with that. The refusal stands
   * when there is no usable sign-in, and when the server does not accept the sign-in either (a
   * 401: it expired or was revoked), so the caller still sees `human_required`.
   */
  private async retryAsPerson(
    apiPath: string,
    init: RequestInit,
    refused: Response,
  ): Promise<Response> {
    if (!this.conn.loopback) return refused;
    const signIn = readStoredSignIn(this.conn.root);
    if (signIn === null) return refused;
    if ((await errorCodeOf(refused.clone())) !== HUMAN_REQUIRED) return refused;
    const headers: Record<string, string> = { cookie: `${SESSION_COOKIE}=${signIn}` };
    for (const [name, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      if (name.toLowerCase() !== "authorization") headers[name] = value;
    }
    const retried = await fetch(`${this.conn.baseUrl}${apiPath}`, { ...init, headers });
    if (retried.status === 401) {
      void retried.body?.cancel();
      return refused;
    }
    void refused.body?.cancel();
    return retried;
  }

  private async toError(res: Response): Promise<ApiError> {
    let code = "http_error";
    let message = "";
    let payload: unknown;
    const text = await res.text().catch(() => "");
    try {
      payload = JSON.parse(text);
      const body = payload as { error?: { code?: string; message?: string } } | null;
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body: keep the fallback wording.
    }
    if (res.status === 401) {
      return new ApiError(
        401,
        "unauthorized",
        this.token === null
          ? this.t.client.noToken(this.conn.baseUrl, apiTokenPath(this.conn.root))
          : this.t.client.authFailed(this.conn.baseUrl),
      );
    }
    // The server's two known plain-text 503s (see STARTING_BODY) say what is wrong all by
    // themselves; rendering them as a bare "Server error 503 (http_error)" hides the one
    // thing the user can act on.
    if (res.status === 503 && code === "http_error") {
      if (text.startsWith(STARTING_BODY)) {
        return new ApiError(
          503,
          "starting",
          this.t.client.serverStarting(this.conn.baseUrl),
          payload,
        );
      }
      if (text.startsWith(NO_PLATFORM_BODY)) {
        return new ApiError(
          503,
          "no_platform",
          this.t.client.serverNoPlatform(this.conn.baseUrl, text.slice(NO_PLATFORM_BODY.length)),
          payload,
        );
      }
    }
    return new ApiError(
      res.status,
      code,
      this.t.client.httpError(res.status, code, message),
      payload,
    );
  }

  /**
   * Opens one SSE subscription (fetch with headers — EventSource cannot carry the
   * Bearer token) and yields parsed frames. The caller handles reconnects; aborting
   * `signal` ends the generator quietly.
   */
  async *sse(apiPath: string, opts: { lastEventId?: string; signal?: AbortSignal } = {}) {
    const res = await this.fetchAuthed(apiPath, {
      headers: this.headers({
        accept: "text/event-stream",
        ...(opts.lastEventId !== undefined ? { "last-event-id": opts.lastEventId } : {}),
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok || res.body === null) throw await this.toError(res);
    yield* parseSseBody(res.body, opts.signal);
  }
}

/**
 * Minimal SSE parser over a fetch body: `id:` / `event:` / `data:` fields, multi-line
 * data joined with \n, blank line dispatches, `:` comment lines (heartbeats) ignored.
 * Tolerates \r\n line endings.
 */
export async function* parseSseBody(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let id: string | undefined;
  let event: string | undefined;
  let data: string[] = [];
  const flush = (): SseFrame | null => {
    if (data.length === 0 && event === undefined) {
      id = undefined;
      event = undefined;
      return null;
    }
    const frame: SseFrame = {
      ...(id !== undefined ? { id } : {}),
      ...(event !== undefined ? { event } : {}),
      data: data.join("\n"),
    };
    event = undefined;
    data = [];
    return frame;
  };
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          const frame = flush();
          if (frame) yield frame;
          continue;
        }
        if (line.startsWith(":")) continue; // heartbeat comment
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value2 = colon === -1 ? "" : line.slice(colon + 1);
        if (value2.startsWith(" ")) value2 = value2.slice(1);
        if (field === "data") data.push(value2);
        else if (field === "event") event = value2;
        else if (field === "id") id = value2;
        // Other fields (retry) are ignored.
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already closed/errored; nothing to release.
    }
  }
}

// ---------------------------------------------------------------------------
// Session references
// ---------------------------------------------------------------------------

/** The 8-hex tail of a session id — the short form `penguin session ls` prints. */
export function shortSessionId(sessionId: string): string {
  const m = /-([0-9a-f]{8})$/.exec(sessionId);
  return m === null ? sessionId : m[1]!;
}

/** Minimal shape of a session row for reference resolution (matches the server's SessionInfo). */
export interface SessionRef {
  sessionId: string;
  agentId: string;
}

/**
 * Resolves a session argument: a full session id is used as-is; anything else is a
 * fragment matched as a substring over the project's sessions (all agents). Exactly one
 * match resolves; zero or several are errors — the ambiguous error lists the candidates.
 */
export async function resolveSessionRef(
  client: ServerClient,
  projectId: string,
  ref: string,
  t: Messages,
): Promise<string> {
  const trimmed = ref.trim();
  if (SESSION_ID_RE.test(trimmed)) return trimmed;
  const { agents } = await client.request<{ agents: Array<{ agentId: string }> }>(
    "GET",
    `/api/projects/${encodeURIComponent(projectId)}/agents`,
  );
  const candidates: string[] = [];
  for (const agent of agents) {
    const { sessions } = await client.request<{ sessions: SessionRef[] }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent.agentId)}/sessions`,
    );
    for (const s of sessions) {
      if (s.sessionId.includes(trimmed)) candidates.push(s.sessionId);
    }
  }
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) throw new Error(t.client.sessionNotFound(trimmed, projectId));
  throw new Error(t.client.sessionAmbiguous(trimmed, candidates));
}

// ---------------------------------------------------------------------------
// Shared option defaults
// ---------------------------------------------------------------------------

/** `--project-id` default chain: flag > PENGUIN_PROJECT_ID > default_project. */
export function resolveProjectId(flag: string | undefined): string {
  return flag?.trim() || process.env.PENGUIN_PROJECT_ID?.trim() || "default_project";
}

/** `--agent-id` default chain: flag > PENGUIN_AGENT_ID > default_agent. */
export function resolveAgentId(flag: string | undefined): string {
  return flag?.trim() || process.env.PENGUIN_AGENT_ID?.trim() || "default_agent";
}
