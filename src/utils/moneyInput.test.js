import { describe, expect, it } from "vitest";
import { parseMoney } from "./moneyInput";

describe("parseMoney", () => {
  it("accepts plain amounts with up to 2 decimals", () => {
    for (const [raw, v] of [["1", 1], ["1000", 1000], ["10.5", 10.5], ["10.55", 10.55], [" 25 ", 25], ["0.01", 0.01]]) expect(parseMoney(raw, { min: 0.01 })).toEqual({ value: v, error: "" });
  });
  it("rejects empty, scientific notation, negatives, text, commas and 3+ decimals", () => {
    for (const raw of ["", "  ", "1e3", "-5", "abc", "1,000", "1.", ".5", "+5", "0x10", "NaN", "Infinity"]) expect(parseMoney(raw).value, raw).toBeNull();
    expect(parseMoney("1.999").error).toBe("Use at most 2 decimal places");
    expect(parseMoney("").error).toBe("Enter amount");
  });
  it("enforces min and max with a readable message", () => {
    expect(parseMoney("0.5", { min: 1 }).error).toBe("Amount must be at least ₹1");
    expect(parseMoney("100001", { max: 100000 }).error).toBe("Amount cannot be more than ₹1,00,000");
    expect(parseMoney("100000", { max: 100000 }).value).toBe(100000);
  });
  it("allowEmpty returns null without an error (optional fields)", () => {
    expect(parseMoney("", { allowEmpty: true })).toEqual({ value: null, error: "" });
  });
});
