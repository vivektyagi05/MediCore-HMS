import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSyncRefresh } from "./useSyncRefresh";

let hidden = false;
const setHidden = (value) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};
beforeEach(() => {
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => {
  delete document.hidden;
});

describe("useSyncRefresh", () => {
  it("does not load on mount, loads on each tick change while visible", () => {
    const load = vi.fn();
    const { rerender } = renderHook(({ tick }) => useSyncRefresh(load, tick), { initialProps: { tick: 0 } });
    expect(load).not.toHaveBeenCalled();
    rerender({ tick: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    rerender({ tick: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    rerender({ tick: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("defers ticks that arrive while hidden into a single refresh when visible again", () => {
    const load = vi.fn();
    const { rerender } = renderHook(({ tick }) => useSyncRefresh(load, tick), { initialProps: { tick: 0 } });
    setHidden(true);
    rerender({ tick: 1 });
    rerender({ tick: 2 });
    rerender({ tick: 3 });
    expect(load).not.toHaveBeenCalled();
    setHidden(false);
    expect(load).toHaveBeenCalledTimes(1);
    setHidden(true);
    setHidden(false);
    expect(load).toHaveBeenCalledTimes(1); // nothing pending any more
  });

  it("calls the latest load closure", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ load, tick }) => useSyncRefresh(load, tick), { initialProps: { load: first, tick: 0 } });
    rerender({ load: second, tick: 1 });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
