import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVisiblePolling } from "./useVisiblePolling";

let hidden = false;
const setHidden = (value) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete document.hidden;
});

describe("useVisiblePolling", () => {
  it("runs the task every interval while the tab is visible", () => {
    const task = vi.fn();
    renderHook(() => useVisiblePolling(task, 1000));
    vi.advanceTimersByTime(3000);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("skips a tick while the previous request is still in flight (no overlapping requests)", () => {
    const task = vi.fn();
    let busy = true;
    renderHook(() => useVisiblePolling(task, 1000, { isBusy: () => busy }));
    vi.advanceTimersByTime(3000);
    expect(task).not.toHaveBeenCalled();
    busy = false;
    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("pauses while hidden, then refreshes once on return only if an interval has elapsed", () => {
    const task = vi.fn();
    renderHook(() => useVisiblePolling(task, 1000));
    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalledTimes(1);
    setHidden(true);
    vi.advanceTimersByTime(10_000);
    expect(task).toHaveBeenCalledTimes(1); // nothing while hidden
    setHidden(false);
    expect(task).toHaveBeenCalledTimes(2); // one catch-up refresh, not ten
    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalledTimes(3); // interval resumed
  });

  it("does not refresh on return when the tab was hidden for less than one interval", () => {
    const task = vi.fn();
    renderHook(() => useVisiblePolling(task, 1000));
    vi.advanceTimersByTime(1000);
    setHidden(true);
    vi.advanceTimersByTime(300);
    setHidden(false);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("does not start polling when mounted in a hidden tab until it becomes visible", () => {
    hidden = true;
    const task = vi.fn();
    renderHook(() => useVisiblePolling(task, 1000));
    vi.advanceTimersByTime(5000);
    expect(task).not.toHaveBeenCalled();
    setHidden(false);
    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalled();
  });

  it("always calls the latest task closure and stops on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ task }) => useVisiblePolling(task, 1000), { initialProps: { task: first } });
    rerender({ task: second });
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    vi.advanceTimersByTime(5000);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
