import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRequestLifecycle } from "./useRequestLifecycle";

describe("useRequestLifecycle", () => {
  it("only the newest request is current; in-flight lasts until every request settles (stale first)", () => {
    const { result } = renderHook(() => useRequestLifecycle());
    const first = result.current.begin();
    const second = result.current.begin();
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    expect(result.current.isInFlight()).toBe(true);
    first.finish(); // stale request settling must not mark the newer one as done
    expect(result.current.isInFlight()).toBe(true);
    second.finish();
    expect(result.current.isInFlight()).toBe(false);
  });

  it("A starts, B starts and finishes first: still in flight until A settles (polling must not start another)", () => {
    const { result } = renderHook(() => useRequestLifecycle());
    const a = result.current.begin();
    const b = result.current.begin();
    expect(b.isCurrent()).toBe(true);
    b.finish(); // newest request settles while A is still running
    expect(a.isCurrent()).toBe(false); // latest-response-wins preserved: A can no longer write state
    expect(b.isCurrent()).toBe(true);
    expect(result.current.isInFlight()).toBe(true); // regression: used to be false here
    a.finish();
    expect(result.current.isInFlight()).toBe(false);
  });

  it("finish is idempotent and a later begin is not cleared by an earlier request's repeated finish", () => {
    const { result } = renderHook(() => useRequestLifecycle());
    const a = result.current.begin();
    a.finish();
    a.finish();
    expect(result.current.isInFlight()).toBe(false);
    const b = result.current.begin();
    a.finish(); // stale duplicate finish must not clear B
    expect(result.current.isInFlight()).toBe(true);
    b.finish();
    expect(result.current.isInFlight()).toBe(false);
  });

  it("error path: a request that fails and finishes in a finally block releases in-flight", async () => {
    const { result } = renderHook(() => useRequestLifecycle());
    const load = async () => {
      const request = result.current.begin();
      try {
        await Promise.reject(new Error("boom"));
      } catch {
        /* handled */
      } finally {
        request.finish();
      }
    };
    const pending = load();
    expect(result.current.isInFlight()).toBe(true);
    await pending;
    expect(result.current.isInFlight()).toBe(false);
  });

  it("a slow earlier response cannot overwrite a newer one", async () => {
    const { result } = renderHook(() => useRequestLifecycle());
    let shown = null;
    const load = async (value, delay) => {
      const request = result.current.begin();
      await new Promise((r) => setTimeout(r, delay));
      if (!request.isCurrent()) return;
      shown = value;
      request.finish();
    };
    await Promise.all([load("older (slow)", 40), load("newer (fast)", 5)]);
    expect(shown).toBe("newer (fast)");
  });

  it("unmounting invalidates outstanding requests and keeps helpers stable across renders", () => {
    const { result, rerender, unmount } = renderHook(() => useRequestLifecycle());
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
    const request = result.current.begin();
    unmount();
    expect(request.isCurrent()).toBe(false);
    expect(result.current.isInFlight()).toBe(false); // unmount clears the outstanding set
    request.finish(); // late finish after unmount is harmless
  });
});
