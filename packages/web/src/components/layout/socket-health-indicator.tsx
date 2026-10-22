/**
 * The page's own connection, said quietly: one floating pill over the top of whatever page is
 * showing, there only while it is true.
 *
 * The page's one API socket (api/socket.ts) carries every live thing a tab has — this server's
 * events, the machines aggregate, each open conversation. When it drops, the calls quietly go
 * back to fetch and the streams park, and for the reader that was the whole story: a page that
 * stopped following itself, with nothing anywhere saying why. The socket's situation is now a
 * reading of its own (`SocketHealth`), and this indicator is the layout's use of it, per the two
 * states that must not pass in silence:
 *
 * - `reconnecting` — a socket that was up (or handshakes that have already failed) is being
 *   brought back on the backoff: a neutral pill with the spinner and one sentence. It is quiet
 *   on purpose: a blip that mends itself should be a line the eye can skip, not a banner.
 * - `gaveUp` — three handshakes never opened against a server that kept answering `/api/me`:
 *   the page keeps working over HTTP, but its live updates are over until it reloads, so the
 *   pill is the attention tone and carries the reload — the one action that state leaves.
 *
 * Both disappear the moment the socket is back. `fine` renders nothing at all, which is what
 * the reader sees for essentially the whole life of a tab.
 */
import { useEffect, useState } from "react";
import { NoticeStrip, Spinner } from "@prismshadow/penguin-ui";
import { apiSocket } from "../../api/socket";
import type { SocketHealth } from "../../api/socket";
import { S } from "../../lib/strings";

/** The socket's situation, live: the current reading on mount, and every change after it. */
export function useSocketHealth(): SocketHealth {
  const [health, setHealth] = useState<SocketHealth>(() => apiSocket.health());
  useEffect(() => apiSocket.onHealth(setHealth), []);
  return health;
}

/**
 * The quiet indicator itself, floating over the top centre of the page (the layout gives it a
 * positioned column to float in). The socket is passed in rather than read here, so the
 * indicator is a pure function of its prop — the suites pin the reading (api-socket.test.ts)
 * and the words separately. `reload` is the give-up line's one action; the parameter is the
 * seam the suites drive, the browser's own reload the default the page gets.
 */
export function SocketHealthIndicator({
  health,
  reload = () => window.location.reload(),
}: {
  health: SocketHealth;
  /** The gave-up line's one action: reload the page, the only way the streams come back. */
  reload?: () => void;
}) {
  if (health === "fine") return null;
  const gaveUp = health === "gaveUp";
  return (
    <NoticeStrip
      tone={gaveUp ? "attention" : "neutral"}
      // The give-up arrives on its own and ends the page's live updates: alert. A reconnect
      // in progress is news that can wait its turn: status. The shadow is the shell's
      // floating surfaces' own (the toaster, the tooltip, every menu: shadow-lg — the
      // de-slop rules allow no other step here).
      role={gaveUp ? "alert" : "status"}
      className="absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-xs shadow-lg"
    >
      {gaveUp ? (
        <>
          <span data-slot="body">{S.connection.gaveUp}</span>
          <button
            type="button"
            onClick={reload}
            className="shrink-0 font-medium underline underline-offset-2 opacity-90 transition-opacity duration-150 hover:opacity-100"
          >
            {S.connection.reload}
          </button>
        </>
      ) : (
        <>
          <span data-slot="icon" aria-hidden className="flex shrink-0">
            <Spinner size="sm" label={S.connection.reconnecting} />
          </span>
          <span data-slot="body">{S.connection.reconnecting}</span>
        </>
      )}
    </NoticeStrip>
  );
}
