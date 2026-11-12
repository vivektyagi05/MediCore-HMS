import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({ getWidgetData: vi.fn() }));
const realtime = vi.hoisted(() => ({ tick: 0 }));
vi.mock("../../api/adminApi", () => ({ adminApi: api }));
vi.mock("../../context/RealtimeContext", () => ({ useRealtime: () => ({ dashboardSyncTick: realtime.tick }) }));

import WidgetShell from "./WidgetShell";

const meta = { key: "demo", title: "Demo widget", supportsDateRange: true, allowed: true };
const body = (data) => <p>{`days=${data?.days}`}</p>;
const ui = () => <WidgetShell meta={meta} renderBody={body} />;
let hidden = false;
const setHidden = (value) => { hidden = value; document.dispatchEvent(new Event("visibilitychange")); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  hidden = false;
  realtime.tick = 0;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  api.getWidgetData.mockReset().mockImplementation(async (_key, params) => ({ data: { days: params.days } }));
});
afterEach(() => { delete document.hidden; });

describe("WidgetShell request hygiene", () => {
  it("fetches once on mount", async () => {
    render(ui());
    await flush();
    expect(api.getWidgetData).toHaveBeenCalledTimes(1);
    expect(api.getWidgetData).toHaveBeenCalledWith("demo", { days: 30 });
  });

  it("a slow response for the previous date range cannot overwrite the newer range", async () => {
    const slow30 = deferred();
    api.getWidgetData.mockReset()
      .mockImplementationOnce(() => slow30.promise) // initial 30d load, slow
      .mockImplementationOnce(async (_k, params) => ({ data: { days: params.days } })); // 7d, fast
    render(ui());
    await flush();
    await act(async () => { screen.getByRole("button", { name: "7d" }).click(); });
    await flush();
    expect(screen.getByText("days=7")).toBeInTheDocument();
    await act(async () => { slow30.resolve({ data: { days: 30 } }); });
    await flush();
    expect(screen.getByText("days=7")).toBeInTheDocument();
    expect(screen.queryByText("days=30")).not.toBeInTheDocument();
  });

  it("a realtime tick refetches once when visible", async () => {
    const { rerender } = render(ui());
    await flush();
    realtime.tick = 1;
    rerender(ui());
    await flush();
    expect(api.getWidgetData).toHaveBeenCalledTimes(2);
  });

  it("ticks that arrive while the tab is hidden cause no request until it is visible, then exactly one", async () => {
    const { rerender } = render(ui());
    await flush();
    setHidden(true);
    for (const t of [1, 2, 3]) { realtime.tick = t; rerender(ui()); }
    await flush();
    expect(api.getWidgetData).toHaveBeenCalledTimes(1);
    setHidden(false);
    await flush();
    expect(api.getWidgetData).toHaveBeenCalledTimes(2);
  });
});
