import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScheduleGrid from "./ScheduleGrid";

const monday = { dayOfWeek: "monday", startTime: "09:00", endTime: "17:00", slotDurationMinutes: 30, bufferMinutes: 5, breaks: [{ start: "13:00", end: "14:00" }], emergencySlotsPerDay: 0, timeSlots: [] };
const Harness = ({ initial = [monday] }) => { const [a, setA] = useState(initial); return <ScheduleGrid availability={a} setAvailability={setA} />; };

describe("ScheduleGrid", () => {
  it("lets the doctor clear the duration box and type a new value (it used to snap back to 30)", async () => {
    const user = userEvent.setup(); render(<Harness />);
    const box = screen.getByLabelText(/Appointment duration/);
    await user.clear(box);
    expect(box).toHaveValue(null); // empty, not re-filled with the default
    expect(screen.getByText(/duration must be a whole number/)).toBeInTheDocument();
    await user.type(box, "45");
    expect(box).toHaveValue(45);
    expect(screen.queryByText(/duration must be a whole number/)).not.toBeInTheDocument();
  });

  it("explains an end time that is not after the start time, and a break outside working hours", async () => {
    const user = userEvent.setup(); render(<Harness initial={[{ ...monday, endTime: "08:00" }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("End time must be after start time.");
    expect(screen.getByText(/No slots yet/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Appointment duration/)); await user.type(screen.getByLabelText(/Appointment duration/), "20");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the generated slot preview for a valid day", () => {
    render(<Harness />);
    expect(screen.getByText(/slots? will be generated/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
