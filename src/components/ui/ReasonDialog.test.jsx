import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReasonDialog from "./ReasonDialog";

const fields = [{ name: "reason", label: "Reason", min: 10, max: 40, multiline: true }];
const setup = (props = {}) => {
  const onSubmit = props.onSubmit || vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const ui = render(<ReasonDialog isOpen title="Do it" fields={fields} confirmLabel="Go" onSubmit={onSubmit} onClose={onClose} {...props} />);
  return { onSubmit, onClose, ...ui };
};

describe("ReasonDialog", () => {
  it("accepts a full sentence without losing focus (inline callbacks, re-rendering parent)", async () => {
    const user = userEvent.setup(); setup();
    const box = screen.getByLabelText(/Reason/); await user.type(box, "wrong amount refunded");
    expect(box).toHaveFocus(); expect(box).toHaveValue("wrong amount refunded");
  });

  it("blocks submit and explains why: empty, too short, whitespace-only", async () => {
    const user = userEvent.setup(); const { onSubmit } = setup();
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByText(/Reason is required/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason/), "          short  ");
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByText(/at least 10 characters \(now 5\)/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits trimmed values once; a double click cannot submit twice", async () => {
    const user = userEvent.setup(); let release; const gate = new Promise((r) => { release = r; });
    const { onSubmit } = setup({ onSubmit: vi.fn(() => gate) });
    await user.type(screen.getByLabelText(/Reason/), "   duplicate charge confirmed   ");
    const go = screen.getByRole("button", { name: "Go" });
    await user.dblClick(go);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ reason: "duplicate charge confirmed" });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled(); // cannot dismiss mid-flight
    release();
  });

  it("shows the server's rejection inside the dialog and keeps what was typed", async () => {
    const user = userEvent.setup(); const onSubmit = vi.fn().mockRejectedValue(new Error("This request is already resolved"));
    setup({ onSubmit });
    await user.type(screen.getByLabelText(/Reason/), "needs another look please");
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already resolved");
    expect(screen.getByLabelText(/Reason/)).toHaveValue("needs another look please");
    await waitFor(() => expect(screen.getByRole("button", { name: "Go" })).toBeEnabled()); // can retry
  });

  it("shows a character counter and enforces the max", async () => {
    const user = userEvent.setup(); const { onSubmit } = setup();
    await user.type(screen.getByLabelText(/Reason/), "x".repeat(60));
    expect(screen.getByText(/\/ 40/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByText(/at most 40 characters/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("starts empty every time it is reopened", async () => {
    const user = userEvent.setup();
    const { rerender, onSubmit, onClose } = setup();
    await user.type(screen.getByLabelText(/Reason/), "first attempt text");
    rerender(<ReasonDialog isOpen={false} title="Do it" fields={fields} onSubmit={onSubmit} onClose={onClose} />);
    rerender(<ReasonDialog isOpen title="Do it" fields={fields} onSubmit={onSubmit} onClose={onClose} />);
    expect(screen.getByLabelText(/Reason/)).toHaveValue("");
  });
});
