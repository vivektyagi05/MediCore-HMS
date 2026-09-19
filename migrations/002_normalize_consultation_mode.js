/**
 * Migration 002 — Normalize legacy Doctor.consultationMode values
 *
 * Background (Appointment Regression Repair): Doctor.consultationMode had
 * no validation at all until this repair added it (see
 * backend/controllers/doctor/practiceController.js#updatePracticeSettings
 * and backend/constants/consultationMode.js for the current contract of
 * "online" | "offline" | "home_visit"). Documents written before that
 * validation existed may still hold legacy values:
 *
 *   "both"       — the old single-select UI's "offers both online and
 *                  in-clinic" option. The only faithful reading of "both"
 *                  under the CURRENT contract is that the doctor offers
 *                  both online and in-clinic care, i.e. both "online" and
 *                  "offline" — NOT "home_visit", which "both" never meant
 *                  in the old UI and which this migration must not invent.
 *   "in_person"  — the old UI's in-clinic option, spelled with the
 *                  Appointment-side word instead of the Doctor-side word.
 *                  Same real-world meaning as the current "offline".
 *
 * This is data repair, not a new rule: it does not touch the validation
 * added elsewhere, and it does not add "both"/"in_person" back to any
 * accepted enum. It only rewrites existing documents into values that
 * contract already accepts.
 *
 * Run once against a live MongoDB instance:
 *   node backend/migrations/002_normalize_consultation_mode.js
 *
 * Safe to re-run: every document is normalized independently and a
 * document already holding only canonical values is left untouched (its
 * $set is skipped entirely), so running this migration twice in a row
 * modifies zero documents on the second run.
 */

import mongoose from "mongoose";
import { env } from "../config/env.js";
import { DOCTOR_CONSULTATION_MODES } from "../constants/consultationMode.js";

// Legacy value -> canonical replacement value(s). Anything not listed here
// and not already in DOCTOR_CONSULTATION_MODES is unrecognized (typo,
// corrupted data, etc.) and is intentionally left in place rather than
// guessed at -- see the "needs manual review" reporting below.
const LEGACY_MODE_MAP = Object.freeze({
  both: ["online", "offline"],
  in_person: ["offline"],
});

// Normalizes one document's raw consultationMode field (which pre-dates
// array-only validation and so may be a bare string, missing, or an array
// mixing valid/legacy/unrecognized values) into a deduplicated array of
// only canonical values, expanding legacy values per LEGACY_MODE_MAP and
// dropping anything neither canonical nor a known legacy value.
export function normalizeConsultationModeValue(raw) {
  const asArray = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const result = [];
  let hadUnrecognizedValue = false;

  for (const value of asArray) {
    if (DOCTOR_CONSULTATION_MODES.includes(value)) {
      if (!result.includes(value)) result.push(value);
      continue;
    }
    const mapped = LEGACY_MODE_MAP[value];
    if (mapped) {
      for (const replacement of mapped) {
        if (!result.includes(replacement)) result.push(replacement);
      }
      continue;
    }
    hadUnrecognizedValue = true;
  }

  const changed =
    asArray.length !== result.length || asArray.some((value, i) => value !== result[i]);

  return { normalized: result, changed, hadUnrecognizedValue };
}

const run = async () => {
  await mongoose.connect(env.mongoUri);
  const db = mongoose.connection.db;

  const doctors = await db
    .collection("doctors")
    .find({})
    .project({ consultationMode: 1 })
    .toArray();

  let normalizedCount = 0;
  let alreadyCanonicalCount = 0;
  const needsManualReview = [];

  for (const doc of doctors) {
    const { normalized, changed, hadUnrecognizedValue } = normalizeConsultationModeValue(
      doc.consultationMode,
    );

    if (!changed) {
      alreadyCanonicalCount += 1;
      continue;
    }

    // Never write an empty array: a doctor with a wholly-unrecognized
    // consultationMode (not a known legacy value, not canonical) would
    // otherwise be silently left unbookable. Flag it for a human instead
    // of guessing a mode the doctor never actually chose.
    if (normalized.length === 0) {
      needsManualReview.push({ doctorId: doc._id, original: doc.consultationMode });
      continue;
    }

    await db
      .collection("doctors")
      .updateOne({ _id: doc._id }, { $set: { consultationMode: normalized } });
    normalizedCount += 1;

    if (hadUnrecognizedValue) {
      console.log(
        `doctors — ${doc._id}: normalized to [${normalized.join(", ")}] but also had an ` +
          `unrecognized value that was dropped (original: ${JSON.stringify(doc.consultationMode)})`,
      );
    }
  }

  console.log(
    `doctors — scanned ${doctors.length}, normalized ${normalizedCount}, already canonical ${alreadyCanonicalCount}`,
  );
  if (needsManualReview.length) {
    console.log(
      `doctors — ${needsManualReview.length} doc(s) left UNCHANGED (no canonical/legacy value ` +
        `could be determined) and need manual review:`,
    );
    for (const entry of needsManualReview) {
      console.log(`  ${entry.doctorId}: ${JSON.stringify(entry.original)}`);
    }
  }

  console.log("\n✅ Migration 002 complete");
  await mongoose.disconnect();
};

// Only auto-run when executed directly (`node .../002_normalize_consultation_mode.js`),
// not when imported by tests for normalizeConsultationModeValue.
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
