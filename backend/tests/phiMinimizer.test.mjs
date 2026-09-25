import assert from "assert";
import { minimizeForExternalAI, restoreTokens } from "../ai/providers/phiMinimizer.js";

const ctx = {
  patientName: "Asha Verma",
  patientId: "abc",
  paid: true,
  valid: 1,
  email: "a@b.c",
  phoneNumber: "9999999999",
  dob: "1990-01-01",
  symptoms: ["fever"],
  nested: { doctorName: "Dr X", appointmentId: "z", span: 3, address: "12 Road" },
  list: [{ name: "Asha Verma" }, { name: "Ravi" }],
};
const { sanitized, tokens, removedKeys } = minimizeForExternalAI(ctx);

assert.deepStrictEqual(sanitized, {
  patientName: "[NAME_1]",
  paid: true,
  valid: 1,
  symptoms: ["fever"],
  nested: { doctorName: "[NAME_2]", span: 3 },
  list: [{ name: "[NAME_1]" }, { name: "[NAME_3]" }],
});
assert.strictEqual(removedKeys, 6);
console.log("PASS: identifiers dropped, names tokenised consistently, ordinary keys ending in 'id' preserved");

assert.deepStrictEqual(
  restoreTokens({ t: "Hi [NAME_1], see [NAME_2] and [NAME_3]", arr: ["[NAME_1]"] }, tokens),
  { t: "Hi Asha Verma, see Dr X and Ravi", arr: ["Asha Verma"] },
);
console.log("PASS: tokens are restored locally");

assert.deepStrictEqual(minimizeForExternalAI(null).sanitized, null);
assert.deepStrictEqual(minimizeForExternalAI({ when: new Date("2026-01-01T00:00:00Z") }).sanitized, { when: "2026-01-01T00:00:00.000Z" });
console.log("PASS: null and Date inputs are handled");
