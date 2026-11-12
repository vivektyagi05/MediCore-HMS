import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render as rtlRender, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({
  getMissionControl: vi.fn(),
  getSmartAlerts: vi.fn(),
  getInfrastructureStatus: vi.fn(),
  getActionCenter: vi.fn(),
  getDecisionCards: vi.fn(),
  getExecutiveRecommendations: vi.fn(),
  getExecutiveTimeline: vi.fn(),
}));
const realtime = vi.hoisted(() => ({ tick: 0 }));
vi.mock("../../api/adminApi", () => ({ adminApi: api }));
vi.mock("../../context/RealtimeContext", () => ({ useRealtime: () => ({ dashboardSyncTick: realtime.tick }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import AdminMissionControl from "./AdminMissionControl";
import AdminExecutiveActionCenter from "./AdminExecutiveActionCenter";

let hidden = false;
const setHidden = (value) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  hidden = false;
  realtime.tick = 0;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.useFakeTimers();
  Object.values(api).forEach((fn) => fn.mockReset().mockResolvedValue({ data: {} }));
});
afterEach(() => {
  vi.useRealTimers();
  delete document.hidden;
});

describe("AdminMissionControl polling", () => {
  it("does not stack a new poll behind a slow in-flight load, and resumes polling once it settles", async () => {
    const slow = deferred();
    api.getMissionControl.mockReset().mockImplementationOnce(() => slow.promise).mockResolvedValue({ data: {} });
    render(<AdminMissionControl />);
    await flush();
    expect(api.getMissionControl).toHaveBeenCalledTimes(1);

    await advance(45_000); // three poll intervals while the first load is still pending
    expect(api.getMissionControl).toHaveBeenCalledTimes(1);

    slow.resolve({ data: {} });
    await flush();
    await advance(15_000);
    expect(api.getMissionControl).toHaveBeenCalledTimes(2);
  });

  it("makes no poll requests while the tab is hidden and refreshes once when it is visible again", async () => {
    render(<AdminMissionControl />);
    await flush();
    expect(api.getMissionControl).toHaveBeenCalledTimes(1);

    setHidden(true);
    await advance(120_000);
    expect(api.getMissionControl).toHaveBeenCalledTimes(1);

    setHidden(false);
    await flush();
    expect(api.getMissionControl).toHaveBeenCalledTimes(2);
  });

  it("a realtime tick while hidden is deferred to a single refresh on return", async () => {
    const { rerender } = render(<AdminMissionControl />);
    await flush();
    setHidden(true);
    realtime.tick = 1; rerender(<MemoryRouter><AdminMissionControl /></MemoryRouter>);
    realtime.tick = 2; rerender(<MemoryRouter><AdminMissionControl /></MemoryRouter>);
    await flush();
    expect(api.getMissionControl).toHaveBeenCalledTimes(1);
    setHidden(false);
    await flush();
    expect(api.getMissionControl).toHaveBeenCalledTimes(2);
  });

  it("keeps the manual Refresh button working while a poll is in flight, and the newest response wins", async () => {
    const olderPoll = deferred();
    const presence = (doctorsOnline) => ({ data: { presence: { doctorsOnline, patientsOnline: 0, activeSessions: 0 } } });
    api.getMissionControl.mockReset()
      .mockResolvedValueOnce(presence(5)) // first load
      .mockImplementationOnce(() => olderPoll.promise) // 15s poll, slow
      .mockResolvedValueOnce(presence(7)); // manual refresh, fast
    render(<AdminMissionControl />);
    await flush();
    await advance(15_000);
    expect(api.getMissionControl).toHaveBeenCalledTimes(2);

    await act(async () => { screen.getByRole("button", { name: /Refresh now/ }).click(); });
    await flush();
    expect(api.getMissionControl).toHaveBeenCalledTimes(3);
    expect(screen.getByText("7")).toBeInTheDocument();

    await act(async () => { olderPoll.resolve(presence(1)); });
    await flush();
    expect(screen.getByText("7")).toBeInTheDocument(); // the slower, older response was dropped
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });
});

describe("AdminExecutiveActionCenter polling", () => {
  it("skips the 20s poll while the previous load is pending and pauses while hidden", async () => {
    const slow = deferred();
    api.getActionCenter.mockReset().mockImplementationOnce(() => slow.promise).mockResolvedValue({ data: {} });
    render(<AdminExecutiveActionCenter />);
    await flush();
    await advance(60_000);
    expect(api.getActionCenter).toHaveBeenCalledTimes(1);

    slow.resolve({ data: {} });
    await flush();
    setHidden(true);
    await advance(100_000);
    expect(api.getActionCenter).toHaveBeenCalledTimes(1);

    setHidden(false);
    await flush();
    expect(api.getActionCenter).toHaveBeenCalledTimes(2);
  });
});
