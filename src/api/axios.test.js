import { beforeEach, describe, expect, it, vi } from "vitest";
import apiClient, { getApiErrorMessage } from "./axios";

const reject = (status, data = {}) => (config) => Promise.reject(Object.assign(new Error("fail"), { config, response: { status, data, config } }));
const ok = (config) => Promise.resolve({ status: 200, data: {}, config, headers: {} });
let unauthorized;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); unauthorized = vi.fn();
  window.addEventListener("hms:unauthorized", unauthorized, { once: true });
});

describe("apiClient 401 handling", () => {
  it("a wrong-password 401 on login is a form error: no logout, no flag, no event", async () => {
    localStorage.setItem("hms_token", "keep"); apiClient.defaults.adapter = reject(401, { message: "Invalid email or password" });
    await expect(apiClient.post("/auth/login", {})).rejects.toBeTruthy();
    expect(localStorage.getItem("hms_token")).toBe("keep"); expect(sessionStorage.getItem("hms_session_expired")).toBeNull(); expect(unauthorized).not.toHaveBeenCalled();
  });
  it("a 401 on a normal request ends the session once and leaves a note for the login screen", async () => {
    localStorage.setItem("hms_token", "old"); localStorage.setItem("hms_user", "{}"); apiClient.defaults.adapter = reject(401);
    await expect(apiClient.get("/patient/payments", { dedupe: false })).rejects.toBeTruthy();
    expect(localStorage.getItem("hms_token")).toBeNull(); expect(localStorage.getItem("hms_user")).toBeNull();
    expect(sessionStorage.getItem("hms_session_expired")).toBe("1"); expect(unauthorized).toHaveBeenCalledTimes(1);
  });
  it("a 401 with no token (never signed in) does not claim a session expired", async () => {
    apiClient.defaults.adapter = reject(401);
    await expect(apiClient.get("/public/thing", { dedupe: false })).rejects.toBeTruthy();
    expect(sessionStorage.getItem("hms_session_expired")).toBeNull();
  });
});

describe("apiClient timeouts", () => {
  it("uploads get the long timeout; ordinary requests keep 15 s; an explicit timeout wins", async () => {
    const seen = []; apiClient.defaults.adapter = (config) => { seen.push(config.timeout); return ok(config); };
    await apiClient.post("/upload", new FormData()); await apiClient.post("/json", { a: 1 }); await apiClient.post("/upload2", new FormData(), { timeout: 5000 });
    expect(seen).toEqual([90000, 15000, 5000]);
  });
});

describe("getApiErrorMessage", () => {
  it("prefers server field messages, then message, then network/timeout wording", () => {
    expect(getApiErrorMessage({ response: { data: { message: "Some settings are invalid", details: { code: "SETTINGS_INVALID", fieldErrors: { a: "x" } } } } })).toBe("Some settings are invalid");
    expect(getApiErrorMessage({ response: { data: { message: "Validation failed", details: { name: "Name is too short" } } } })).toBe("Name is too short");
    expect(getApiErrorMessage({ code: "ECONNABORTED" })).toMatch(/timed out/); expect(getApiErrorMessage({})).toMatch(/Unable to reach/);
  });
});
