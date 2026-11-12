import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({
  getUnifiedOperationsQueue: vi.fn(),
  getAdmins: vi.fn(),
  getSlaOverview: vi.fn(),
  getWorkflowRegistry: vi.fn(),
}));
const realtime = vi.hoisted(() => ({ tick: 0 }));
vi.mock("../../api/adminApi", () => ({ adminApi: api }));
vi.mock("../../context/RealtimeContext", () => ({ useRealtime: () => ({ dashboardSyncTick: realtime.tick }) }));
vi.mock("../../components/admin/OperationsWorkspaceDrawer", () => ({ default: () => null }));

import AdminOperationsCenter from "./AdminOperationsCenter";

const queueResponse = (page = 1, total = 250) => ({
  data: { items: [], counts: {}, pagination: { page, pageSize: 50, total, totalPages: 5 } },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const queueCalls = () => api.getUnifiedOperationsQueue.mock.calls.map(([params]) => params);

beforeEach(() => {
  realtime.tick = 0;
  api.getUnifiedOperationsQueue.mockReset().mockImplementation(async (params) => queueResponse(params.page));
  api.getAdmins.mockReset().mockResolvedValue({ data: { admins: [] } });
  api.getSlaOverview.mockReset().mockResolvedValue({ data: null });
  api.getWorkflowRegistry.mockReset().mockResolvedValue({ data: { workflows: [] } });
});

const mount = async () => {
  const utils = render(<AdminOperationsCenter />);
  await screen.findByText(/Page 1 of 5/);
  return utils;
};

describe("AdminOperationsCenter request hygiene", () => {
  it("loads the queue once on mount", async () => {
    await mount();
    expect(queueCalls()).toHaveLength(1);
    expect(queueCalls()[0]).toMatchObject({ page: 1, pageSize: 50 });
  });

  it("a filter change while on page 3 issues exactly one request (page 1 with the new filter)", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Page 2 of 5/);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Page 3 of 5/);
    api.getUnifiedOperationsQueue.mockClear();

    await user.selectOptions(document.getElementById("ops-priority"), "critical");
    await screen.findByText(/Page 1 of 5/);
    await new Promise((r) => setTimeout(r, 50)); // let any stray second request show up

    expect(queueCalls()).toHaveLength(1);
    expect(queueCalls()[0]).toMatchObject({ page: 1, priority: "critical" });
  });

  it("a filter change on page 1 still issues exactly one request", async () => {
    const user = userEvent.setup();
    await mount();
    api.getUnifiedOperationsQueue.mockClear();
    await user.selectOptions(document.getElementById("ops-priority"), "high");
    await waitFor(() => expect(queueCalls()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(queueCalls()).toHaveLength(1);
    expect(queueCalls()[0]).toMatchObject({ page: 1, priority: "high" });
  });

  it("a slow response for an older filter cannot overwrite the newer result", async () => {
    const user = userEvent.setup();
    await mount();
    const slowOlder = deferred();
    api.getUnifiedOperationsQueue.mockReset()
      .mockImplementationOnce(() => slowOlder.promise) // priority=high (older, slow)
      .mockImplementationOnce(async () => queueResponse(1, 222)); // priority=critical (newer, fast)

    await user.selectOptions(document.getElementById("ops-priority"), "high");
    await user.selectOptions(document.getElementById("ops-priority"), "critical");
    await screen.findByText(/222 matching/);

    await act(async () => { slowOlder.resolve(queueResponse(1, 111)); await Promise.resolve(); });
    expect(screen.getByText(/222 matching/)).toBeInTheDocument();
    expect(screen.queryByText(/111 matching/)).not.toBeInTheDocument();
  });

  it("a realtime tick refreshes the current page once and keeps the current filters", async () => {
    const user = userEvent.setup();
    const { rerender } = await mount();
    await user.selectOptions(document.getElementById("ops-status"), "claimed");
    await waitFor(() => expect(queueCalls().at(-1)).toMatchObject({ status: "claimed" }));
    api.getUnifiedOperationsQueue.mockClear();
    realtime.tick = 1;
    rerender(<AdminOperationsCenter />);
    await waitFor(() => expect(queueCalls()).toHaveLength(1));
    expect(queueCalls()[0]).toMatchObject({ page: 1, status: "claimed" });
  });
});
