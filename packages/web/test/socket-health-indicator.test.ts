// @vitest-environment jsdom
/**
 * The layout's quiet indicator (components/layout/socket-health-indicator.tsx): the page's
 * one API socket, as the reader sees the two states that must not pass in silence.
 *
 * - `fine` renders nothing at all — the whole normal life of a tab.
 * - `reconnecting` is one neutral pill: a status, the spinner, the sentence, and no action.
 * - `gaveUp` is the attention tone and an alert, with Reload as its one action — the only
 *   thing that state leaves the reader, so a press must reach it.
 * - Both follow the interface language.
 *
 * The reading itself — which socket state is which word — is the socket's own suite
 * (api-socket.test.ts, "health"); this one pins what each word looks like on the page.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { SocketHealthIndicator } from "../src/components/layout/socket-health-indicator";
import { button, click, hasButton, mount, unmountAll } from "./helpers/dom";

describe("the socket's quiet indicator", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("renders nothing while the socket is fine", async () => {
    const mounted = await mount(h(SocketHealthIndicator, { health: "fine" }));
    expect(mounted.container.childElementCount).toBe(0);
  });

  it("says a reconnect in progress quietly: a neutral status with the spinner, no action", async () => {
    await mount(h(SocketHealthIndicator, { health: "reconnecting" }));
    const strip = document.querySelector("[data-tone]");
    expect(strip?.getAttribute("role")).toBe("status");
    expect(strip?.getAttribute("data-tone")).toBe("neutral");
    expect(strip?.textContent).toBe(en.connection.reconnecting);
    expect(strip?.querySelector('[data-live="spinner"]')).not.toBe(null);
    expect(hasButton(en.connection.reload)).toBe(false);
  });

  it("says the give-up as an attention alert, and Reload is its one action", async () => {
    const reload = vi.fn();
    await mount(h(SocketHealthIndicator, { health: "gaveUp", reload }));
    const strip = document.querySelector("[data-tone]");
    expect(strip?.getAttribute("role")).toBe("alert");
    expect(strip?.getAttribute("data-tone")).toBe("warning"); // the notice hook's word for attention
    expect(strip?.textContent).toContain(en.connection.gaveUp);
    await click(button(en.connection.reload));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("follows the interface language", async () => {
    setActiveStrings(zh);
    const reconnected = await mount(h(SocketHealthIndicator, { health: "reconnecting" }));
    expect(document.querySelector('[data-slot="body"]')?.textContent).toBe(
      zh.connection.reconnecting,
    );
    await reconnected.unmount();
    await mount(h(SocketHealthIndicator, { health: "gaveUp" }));
    expect(document.querySelector('[data-slot="body"]')?.textContent).toBe(zh.connection.gaveUp);
    expect(button(zh.connection.reload).textContent).toBe(zh.connection.reload);
  });
});
