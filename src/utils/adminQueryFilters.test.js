import { describe, expect, it } from "vitest";
import { readAdminFilterState } from "./adminQueryFilters.js";

describe("readAdminFilterState", () => {
  it("hydrates controlled filters from URL parameters", () => {
    const params = new URLSearchParams("search=patient&status=active&patientId=abc123");
    expect(readAdminFilterState(params, ["search", "status", "gender"])).toEqual({
      search: "patient",
      status: "active",
      gender: "",
    });
  });

  it("resets removed filters after browser history navigation", () => {
    const params = new URLSearchParams("patientId=abc123");
    expect(readAdminFilterState(params, ["search", "status", "gender"])).toEqual({
      search: "",
      status: "",
      gender: "",
    });
  });
});
