import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "./Modal";

// Regression: typing in a modal field lost focus after ONE character because Modal's effect depended on `onClose`,
// which callers pass inline (a new function on every render). Each keystroke re-rendered the parent -> effect re-ran ->
// focus jumped to the close button.
function Harness() {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState("");
  return (
    <Modal isOpen={open} title="Reason" onClose={() => setOpen(false)}>
      <textarea aria-label="reason" value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}

describe("Modal", () => {
  it("keeps focus in the field while typing a whole sentence with an inline onClose", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText("reason");
    expect(box).toHaveFocus(); // focuses the first form field, not the close button
    await user.type(box, "refund was issued twice by mistake");
    expect(box).toHaveFocus();
    expect(box).toHaveValue("refund was issued twice by mistake");
  });

  it("closes on Escape, restores scroll, and uses the latest onClose", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("reason")).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("traps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab(); await user.tab(); await user.tab();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement);
  });
});
