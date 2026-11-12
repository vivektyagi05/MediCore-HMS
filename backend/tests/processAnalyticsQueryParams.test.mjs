import assert from "assert";
import { rangeDaysFromQuery, versionFromQuery } from "../controllers/admin/processAnalyticsController.js";

const req = (query) => ({ query });
assert.strictEqual(rangeDaysFromQuery(req({})), 30);
assert.strictEqual(rangeDaysFromQuery(req({}), 90), 90);
assert.strictEqual(rangeDaysFromQuery(req({ rangeDays: "7" })), 7);
assert.strictEqual(rangeDaysFromQuery(req({ rangeDays: "90" })), 90);
assert.strictEqual(rangeDaysFromQuery(req({ rangeDays: "100000" })), 90, "capped: no unbounded lookback");
assert.strictEqual(rangeDaysFromQuery(req({ rangeDays: "abc" })), 30, "NaN no longer reaches the date math");
assert.strictEqual(rangeDaysFromQuery(req({ rangeDays: "-5" })), 30);
assert.strictEqual(rangeDaysFromQuery(req({ rangeDays: "0" })), 30);
assert.strictEqual(rangeDaysFromQuery(req({ rangeDays: ["7", "30"] })), 30);
assert.strictEqual(rangeDaysFromQuery(req({ rangeDays: "Infinity" })), 30);

assert.strictEqual(versionFromQuery(req({})), null);
assert.strictEqual(versionFromQuery(req({ version: "3" })), 3);
for (const bad of ["abc", "0", "-1", "1.5", ["1", "2"]]) {
  assert.throws(() => versionFromQuery(req({ version: bad })), (e) => e.statusCode === 400, String(bad));
}
assert.throws(() => versionFromQuery(req({}), "versionA", { required: true }), (e) => e.statusCode === 400);
assert.strictEqual(versionFromQuery(req({ versionA: "2" }), "versionA", { required: true }), 2);
console.log("PASS: process analytics rangeDays is clamped and version params are validated (400, not CastError/500)");
