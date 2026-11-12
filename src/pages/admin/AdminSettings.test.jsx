import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn() }));
vi.mock("../../api/adminApi", () => ({ adminApi: api }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("../../i18n/I18nContext", () => ({ useI18n: () => ({ t: (k) => ({ "common.saved": "Saved", "common.saving": "Saving…", "common.error": "Error" })[k] || k }) }));

import AdminSettings from "./AdminSettings";

const base = () => ({
  hospitalName: "City Hospital", logoUrl: "", supportEmail: "help@city.test", phone: "", timezone: "Asia/Kolkata",
  appointmentLimits: { dailyPerDoctor: 30, bookingWindowDays: 30 }, paymentSettings: { currency: "INR", taxRate: 18, refundsEnabled: true },
  operationsCapacity: { maxOpenItemsPerAdmin: 12, overloadThresholdPct: 85 },
  governancePolicy: { approvalRequiredTiers: [], simulationRequiredTiers: [], documentationRequiredTiers: [], segregationOfDutiesTiers: [] },
});
beforeEach(() => { api.getSettings.mockReset().mockResolvedValue({ data: { settings: base() } }); api.updateSettings.mockReset().mockResolvedValue({}); });
const open = async (tab) => { const user = userEvent.setup(); render(<AdminSettings />); await screen.findByText("Central control panel"); if (tab) await user.click(screen.getByRole("button", { name: tab })); return user; };

describe("AdminSettings", () => {
  it("does not write anything just because the page was opened", async () => {
    await open();
    await new Promise((r) => setTimeout(r, 900));
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("never saves an emptied tax rate as 0: it shows an error and holds the save", async () => {
    const user = await open("Payments");
    const tax = screen.getByLabelText(/Tax rate/); await user.clear(tax);
    expect(await screen.findByText("A number from 0 to 100")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Nothing is saved/);
    await new Promise((r) => setTimeout(r, 900));
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("saves a valid edit once, as a number, after the debounce", async () => {
    const user = await open("Payments");
    const tax = screen.getByLabelText(/Tax rate/); await user.clear(tax); await user.type(tax, "5");
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(api.updateSettings.mock.calls[0][0].paymentSettings.taxRate).toBe(5);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("rejects out-of-range and invalid values per field", async () => {
    const user = await open("Appointments");
    const daily = screen.getByLabelText(/Daily limit/); await user.clear(daily); await user.type(daily, "9999");
    expect(await screen.findByText("Whole number from 1 to 500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hospital" }));
    const email = screen.getByLabelText(/Support email/); await user.clear(email); await user.type(email, "not-an-email");
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 900));
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("asks before turning refunds off, and does nothing if cancelled", async () => {
    const user = await open("Payments");
    await user.click(screen.getByLabelText("Refunds enabled"));
    expect(await screen.findByText("Turn refunds off?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await new Promise((r) => setTimeout(r, 900));
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Refunds enabled")).toBeChecked();
    await user.click(screen.getByLabelText("Refunds enabled"));
    await user.click(await screen.findByRole("button", { name: "Turn refunds off" }));
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(api.updateSettings.mock.calls[0][0].paymentSettings.refundsEnabled).toBe(false);
  });

  it("shows a retryable error state when settings cannot load", async () => {
    api.getSettings.mockRejectedValueOnce(new Error("boom"));
    render(<AdminSettings />);
    expect(await screen.findByText("Settings unavailable")).toBeInTheDocument();
  });
});
