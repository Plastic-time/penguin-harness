/**
 * The status bar's locate asks (lib/sidebar-locate.ts): one ask at a time, published when the
 * bar's list opens a Session and answered by whichever sidebar is on screen. The store is the
 * whole module — the hook is a one-line useSyncExternalStore over it, and the two consumers
 * (the development list, the company's groups) are held to their side of that seam in their
 * own suites:
 *
 * - Publishing replaces whatever ask was standing, and hands out the same object until the
 *   next one, so a re-render costs nothing.
 * - Every ask carries a fresh nonce, so a consumer can tell a new ask from a re-render of
 *   the same one — even two asks for the same Session in a row.
 * - A title the bar's row never had reads as the empty string; the ask is plain data, and
 *   a sidebar that never gets one answers nothing.
 * - Subscribers hear of a publish and nothing else, and stop when they leave.
 */
import { describe, expect, it } from "vitest";
import { createSidebarLocateStore } from "../src/lib/sidebar-locate";

describe("the locate store", () => {
  it("holds nothing before the first publish, and hands the same ask out until the next", () => {
    const store = createSidebarLocateStore();
    expect(store.current()).toBeNull();
    store.publish("s1", "helper", "Deploy check");
    const ask = store.current();
    expect(ask).toMatchObject({ sessionId: "s1", agentId: "helper", title: "Deploy check" });
    expect(store.current()).toBe(ask); // a re-render reads the same object
  });

  it("marks every ask with a fresh nonce, even two for the same Session in a row", () => {
    const store = createSidebarLocateStore();
    store.publish("s1", "helper", null);
    const first = store.current()!;
    store.publish("s1", "helper", null); // the sidebar may have folded again: still an ask
    expect(store.current()!.nonce).not.toBe(first.nonce);
    // Each store counts on its own, so tests never share one counter.
    expect(createSidebarLocateStore().current()).toBeNull();
  });

  it("reads a title the bar's row never had as the empty string", () => {
    const store = createSidebarLocateStore();
    store.publish("s1", "helper", null);
    expect(store.current()).toMatchObject({ title: "" });
  });

  it("tells subscribers of a publish and nothing else, and stops when they leave", () => {
    const store = createSidebarLocateStore();
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.publish("s1", "helper", null);
    expect(notified).toBe(1);
    store.publish("s2", "helper", null);
    expect(notified).toBe(2);
    unsubscribe();
    store.publish("s3", "helper", null);
    expect(notified).toBe(2); // gone: no later ask reaches it
    expect(store.current()).toMatchObject({ sessionId: "s3" }); // the store keeps answering
  });
});
