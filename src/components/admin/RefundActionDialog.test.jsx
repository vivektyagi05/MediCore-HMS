import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({ approveRequest: vi.fn(), rejectRequest: vi.fn(), retryRequest: vi.fn(), reconcileRequest: vi.fn() }));
vi.mock("../../api/refundApi", () => ({ refundApi: api }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
import RefundActionDialog from "./RefundActionDialog";

const refund = { _id: "r1", amount: 400 };
const payment = { totalAmount: 1000, refundedAmount: 0, currency: "INR" };
const setup = (props = {}) => {
  const onClose = vi.fn(); const onDone = vi.fn();
  render(<RefundActionDialog refundRequest={refund} payment={payment} mode="reject" onClose={onClose} onDone={onDone} {...props} />);
  return { onClose, onDone };
};
beforeEach(() => Object.values(api).forEach((f) => f.mockReset().mockResolvedValue({ message: "ok" })));

describe("RefundActionDialog (admin)", () => {
  it("lets the admin type a whole rejection reason: focus never leaves the box (the reported bug)", async () => {
    const user = userEvent.setup(); setup();
    const box = screen.getByLabelText(/Rejection reason/);
    expect(box).toHaveFocus();
    await user.type(box, "The consultation took place and was completed in full");
    expect(box).toHaveFocus();
    expect(box).toHaveValue("The consultation took place and was completed in full");
  });

  it("requires a meaningful reason to reject and never calls the API without one", async () => {
    const user = userEvent.setup(); setup();
    await user.click(screen.getByRole("button", { name: "Reject Refund" }));
    expect(await screen.findByText("A rejection reason is required")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Rejection reason/), "no");
    expect(screen.getByText(/at least 5 characters \(now 2\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject Refund" })).toBeDisabled();
    expect(api.rejectRequest).not.toHaveBeenCalled();
  });

  it("sends the trimmed reason once, even on a double click", async () => {
    const user = userEvent.setup(); let release; api.rejectRequest.mockReturnValue(new Promise((r) => { release = r; }));
    const { onDone } = setup();
    await user.type(screen.getByLabelText(/Rejection reason/), "   Duplicate request, already refunded   ");
    await user.dblClick(screen.getByRole("button", { name: "Reject Refund" }));
    expect(api.rejectRequest).toHaveBeenCalledTimes(1);
    expect(api.rejectRequest).toHaveBeenCalledWith("r1", { note: "Duplicate request, already refunded" });
    release({ message: "done" }); await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("cannot be dismissed while the request is in flight (Escape, Back)", async () => {
    const user = userEvent.setup(); let release; api.rejectRequest.mockReturnValue(new Promise((r) => { release = r; }));
    const { onClose } = setup();
    await user.type(screen.getByLabelText(/Rejection reason/), "A valid reason here");
    await user.click(screen.getByRole("button", { name: "Reject Refund" }));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    release({});
  });

  it("shows the server's refusal inside the dialog and keeps the reason", async () => {
    const user = userEvent.setup(); api.rejectRequest.mockRejectedValue({ response: { data: { message: "Refund request is no longer pending" } } });
    setup();
    await user.type(screen.getByLabelText(/Rejection reason/), "Policy does not allow this");
    await user.click(screen.getByRole("button", { name: "Reject Refund" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer pending");
    expect(screen.getByLabelText(/Rejection reason/)).toHaveValue("Policy does not allow this");
  });

  it("approve: note is optional, shows the amount and the remaining balance; warns when stale data would go negative", async () => {
    const user = userEvent.setup(); const { onDone } = setup({ mode: "approve" });
    expect(screen.getByText(/Approve refund of/)).toHaveTextContent("₹400.00");
    expect(screen.getByText(/Remaining refundable amount after approval: ₹600.00/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve Refund" }));
    await waitFor(() => expect(api.approveRequest).toHaveBeenCalledWith("r1", {}));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("approve with a stale snapshot shows a warning instead of a negative remaining amount", () => {
    setup({ mode: "approve", payment: { totalAmount: 1000, refundedAmount: 800, currency: "INR" } });
    expect(screen.queryByText(/Remaining refundable amount/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/more than what is left/);
  });
});
