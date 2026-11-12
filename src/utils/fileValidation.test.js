import { describe, expect, it } from "vitest";
import { UPLOAD_LIMITS, validateUpload } from "./fileValidation";
const f = (type, size) => ({ type, size });
describe("validateUpload", () => {
  it("accepts pdf/png/jpeg within the limit and treats no file as not-an-error", () => {
    for (const t of ["application/pdf", "image/png", "image/jpeg"]) expect(validateUpload(f(t, 1000))).toBe("");
    expect(validateUpload(null)).toBe(""); expect(validateUpload(undefined)).toBe("");
  });
  it("rejects empty, wrong-type and oversize files with a reason", () => {
    expect(validateUpload(f("application/pdf", 0))).toMatch(/empty/);
    for (const t of ["application/zip", "text/html", "image/svg+xml", "", "application/x-msdownload"]) expect(validateUpload(f(t, 100))).toMatch(/PDF, PNG or JPG/);
    expect(validateUpload(f("application/pdf", UPLOAD_LIMITS.patientBytes + 1))).toMatch(/larger than 8 MB/);
    expect(validateUpload(f("application/pdf", UPLOAD_LIMITS.patientBytes))).toBe("");
  });
  it("uses the doctor limit when asked", () => {
    expect(validateUpload(f("image/png", 6 * 1024 * 1024), { maxBytes: UPLOAD_LIMITS.doctorBytes })).toMatch(/larger than 5 MB/);
  });
});
