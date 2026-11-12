import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLatestRequest } from "./useLatestRequest";

describe("useLatestRequest", () => {
  it("only the most recent request is current; earlier ones become stale", () => {
    const { result } = renderHook(() => useLatestRequest());
    const first = result.current(); expect(first()).toBe(true);
    const second = result.current(); expect(first()).toBe(false); expect(second()).toBe(true);
  });
  it("keeps one stable begin() across renders", () => {
    const { result, rerender } = renderHook(() => useLatestRequest()); const before = result.current; rerender(); expect(result.current).toBe(before);
  });
  it("a slow earlier response cannot overwrite a newer one", async () => {
    const { result } = renderHook(() => useLatestRequest()); let shown = null;
    const load = async (value, delay) => { const isCurrent = result.current(); await new Promise((r) => setTimeout(r, delay)); if (!isCurrent()) return; shown = value; };
    await Promise.all([load("A (slow)", 40), load("B (fast)", 5)]);
    expect(shown).toBe("B (fast)");
  });
});
