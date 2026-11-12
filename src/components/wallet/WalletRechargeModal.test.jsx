import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({ createWalletRechargeOrder: vi.fn(), cancelWalletRecharge: vi.fn(), verifyWalletRecharge: vi.fn(), getWalletRechargeStatus: vi.fn() }));
vi.mock("../../api/financeApi", () => ({ financeApi: api }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { name: "P", email: "p@x.test" } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
import WalletRechargeModal from "./WalletRechargeModal";

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  window.Razorpay = function Razorpay() { this.open = vi.fn(); this.on = vi.fn(); };
  api.createWalletRechargeOrder.mockResolvedValue({ data: { order: { id: "order_1", amount: 100000, currency: "INR" }, razorpayKeyId: "rzp_test" } });
});

describe("WalletRechargeModal amount validation", () => {
  it("opens checkout with the exact numeric amount for a valid entry", async () => {
    const user = userEvent.setup(); render(<WalletRechargeModal isOpen onClose={() => {}} onSuccess={() => {}} />);
    const box = screen.getByLabelText(/Amount/); await user.clear(box); await user.type(box, "499.50");
    await user.click(screen.getByRole("button", { name: /Continue to Razorpay/ }));
    await waitFor(() => expect(api.createWalletRechargeOrder).toHaveBeenCalledWith({ amount: 499.5 }));
  });

  it.each([["", /Enter amount/], ["0.5", /at least ₹1/], ["100001", /cannot be more than/], ["12.345", /at most 2 decimal/]])("blocks %j and explains why", async (value, message) => {
    const user = userEvent.setup(); render(<WalletRechargeModal isOpen onClose={() => {}} onSuccess={() => {}} />);
    const box = screen.getByLabelText(/Amount/); await user.clear(box); if (value) await user.type(box, value);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to Razorpay/ })).toBeDisabled();
    expect(api.createWalletRechargeOrder).not.toHaveBeenCalled();
  });

  it("a double click creates only one order", async () => {
    const user = userEvent.setup(); let release; api.createWalletRechargeOrder.mockReturnValue(new Promise((r) => { release = r; }));
    render(<WalletRechargeModal isOpen onClose={() => {}} onSuccess={() => {}} />);
    await user.dblClick(screen.getByRole("button", { name: /Continue to Razorpay/ }));
    expect(api.createWalletRechargeOrder).toHaveBeenCalledTimes(1);
    release({ data: { order: { id: "o", amount: 1, currency: "INR" }, razorpayKeyId: "k" } });
  });

  it("starts from a clean 1000 each time it is reopened", async () => {
    const user = userEvent.setup(); const { rerender } = render(<WalletRechargeModal isOpen onClose={() => {}} onSuccess={() => {}} />);
    const box = screen.getByLabelText(/Amount/); await user.clear(box); await user.type(box, "77");
    rerender(<WalletRechargeModal isOpen={false} onClose={() => {}} onSuccess={() => {}} />);
    rerender(<WalletRechargeModal isOpen onClose={() => {}} onSuccess={() => {}} />);
    expect(screen.getByLabelText(/Amount/)).toHaveValue(1000);
  });
});
