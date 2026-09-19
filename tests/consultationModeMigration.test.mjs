import assert from "assert";
import { normalizeConsultationModeValue } from "../migrations/002_normalize_consultation_mode.js";

// 1. Documented legacy mappings from the bug report.
assert.deepStrictEqual(normalizeConsultationModeValue(["both"]).normalized, ["online", "offline"]);
assert.deepStrictEqual(normalizeConsultationModeValue(["in_person"]).normalized, ["offline"]);
console.log("PASS: 'both' -> ['online','offline'], 'in_person' -> ['offline']");

// 2. Already-canonical values are left byte-for-byte unchanged, and
//    reported as unchanged (so a migration run does not re-touch them).
for (const already of [["online"], ["offline"], ["home_visit"], ["online", "offline"], ["online", "offline", "home_visit"]]) {
  const { normalized, changed } = normalizeConsultationModeValue(already);
  assert.deepStrictEqual(normalized, already);
  assert.strictEqual(changed, false);
}
console.log("PASS: already-canonical arrays are unchanged and marked unchanged");

// 3. Idempotency: running normalization on its own output is a no-op.
for (const input of [["both"], ["in_person"], ["both", "in_person"], ["online", "both"]]) {
  const first = normalizeConsultationModeValue(input).normalized;
  const second = normalizeConsultationModeValue(first);
  assert.deepStrictEqual(second.normalized, first);
  assert.strictEqual(second.changed, false);
}
console.log("PASS: normalization is idempotent");

// 4. Mixed legacy + canonical values dedupe correctly.
assert.deepStrictEqual(normalizeConsultationModeValue(["online", "both"]).normalized, ["online", "offline"]);
assert.deepStrictEqual(normalizeConsultationModeValue(["both", "in_person"]).normalized, ["online", "offline"]);
console.log("PASS: mixed legacy/canonical values dedupe into the canonical set");

// 5. A bare (pre-array-validation) string is treated as a single-element array.
assert.deepStrictEqual(normalizeConsultationModeValue("offline").normalized, ["offline"]);
assert.deepStrictEqual(normalizeConsultationModeValue("both").normalized, ["online", "offline"]);
console.log("PASS: legacy bare-string values (non-array) are handled");

// 6. Missing/empty/wholly-unrecognized input never gets guessed at -- it
//    normalizes to an empty result and is flagged, never silently defaulted.
assert.deepStrictEqual(normalizeConsultationModeValue(undefined).normalized, []);
assert.deepStrictEqual(normalizeConsultationModeValue([]).normalized, []);
const garbage = normalizeConsultationModeValue(["telemedicine"]);
assert.deepStrictEqual(garbage.normalized, []);
assert.strictEqual(garbage.hadUnrecognizedValue, true);
console.log("PASS: unrecognized/empty input normalizes to [] and is flagged, not guessed");
