import { describe, expect, it } from "vitest";
import { validateDayConfig as v } from "./scheduleValidation";
const day = (o = {}) => ({ startTime: "09:00", endTime: "17:00", slotDurationMinutes: 30, bufferMinutes: 5, breaks: [{ start: "13:00", end: "14:00" }], emergencySlotsPerDay: 0, ...o });
describe("validateDayConfig", () => {
  it("accepts the default working day", () => expect(v(day())).toEqual([]));
  it("flags end before/equal start and bad times", () => {
    expect(v(day({ endTime: "08:00" }))).toContain("End time must be after start time."); expect(v(day({ endTime: "09:00" }))).toContain("End time must be after start time."); expect(v(day({ startTime: "" }))[0]).toMatch(/valid start and end/);
  });
  it("flags cleared or out-of-range numbers instead of silently using 0/30", () => {
    expect(v(day({ slotDurationMinutes: "" })).join()).toMatch(/duration/); expect(v(day({ slotDurationMinutes: 4 })).join()).toMatch(/duration/); expect(v(day({ slotDurationMinutes: 241 })).join()).toMatch(/duration/);
    expect(v(day({ bufferMinutes: 121 })).join()).toMatch(/Buffer/); expect(v(day({ emergencySlotsPerDay: 21 })).join()).toMatch(/Emergency/); expect(v(day({ slotDurationMinutes: 7.5 })).join()).toMatch(/duration/);
  });
  it("treats an empty buffer / emergency box as 0 (allowed)", () => expect(v(day({ bufferMinutes: "", emergencySlotsPerDay: "" }))).toEqual([]));
  it("validates the break: both ends, order, inside working hours; an untouched break is ignored", () => {
    expect(v(day({ breaks: [{ start: "13:00", end: "" }] })[0])).toBeDefined();
    expect(v(day({ breaks: [{ start: "13:00", end: "" }] })).join()).toMatch(/both a break start and a break end/);
    expect(v(day({ breaks: [{ start: "14:00", end: "13:00" }] })).join()).toMatch(/Break end must be after/);
    expect(v(day({ breaks: [{ start: "08:00", end: "10:00" }] })).join()).toMatch(/within working hours/);
    expect(v(day({ breaks: [{ start: "", end: "" }] }))).toEqual([]); expect(v(day({ breaks: [] }))).toEqual([]);
  });
  it("returns nothing for a disabled day", () => expect(v(undefined)).toEqual([]));
});
