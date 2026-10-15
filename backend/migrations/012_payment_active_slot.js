// Phase 01 migration 012: one ACTIVE payment per appointment.
//
//   node migrations/012_payment_active_slot.js            report + backfill
//   node migrations/012_payment_active_slot.js --dry-run  report only (no writes)
//   add --json for a machine-readable report
//
// What it does, in order:
//   1. Finds appointments that already have MORE THAN ONE active/conflicting
//      payment (live status, or failed but still retryable). Financial records
//      are never deleted or merged: if any exist the migration prints every
//      conflicting payment id and STOPS (exit 2) without writing anything, so
//      the unique index in migration 011 is not attempted against bad data.
//   2. Otherwise backfills Payment.activeAppointmentSlot=true on those active
//      payments (a flag only; no status/amount/id is touched). Idempotent.
//
// Exit codes: 0 ok | 2 blocked: manual reconciliation required | 3 dry-run found
// payments needing the flag | 4 another runner holds the lock | 1 unexpected error.
//
// Release order (scripts/release.mjs): 012 runs BEFORE 011, because 011 (which is
// re-run on every release and derives its inventory from the schemas) builds the
// partial unique index uniq_payment_active_appointment from this flag.
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { acquireMigrationLock, finishMigration } from "./lib/migrationState.js";

export const MIGRATION_ID = "012_payment_active_slot";
export const MAX_RETRIES = 3; // mirrors payments/paymentRetryService.js

export const LIVE_STATUSES = Object.freeze([
  "created", "order_created", "checkout_started", "pending", "authorized", "verification_pending",
  "captured", "post_processing", "post_processing_failed", "completed", "reconciliation_required",
]);

/** Candidate filter: active payments that do not carry the flag yet, plus flagged ones (for dup detection). */
export const buildCandidateFilter = () => ({
  $or: [
    { activeAppointmentSlot: true },
    { activeAppointmentSlot: { $exists: false }, status: { $in: LIVE_STATUSES } },
    { activeAppointmentSlot: { $exists: false }, status: "failed", retryCount: { $lt: MAX_RETRIES } },
  ],
});

/** Pure: groups candidate rows by appointment and returns the conflicting groups. */
export const findConflicts = (rows) => {
  const byAppointment = new Map();
  for (const row of rows) {
    const key = String(row.appointmentId);
    if (!byAppointment.has(key)) byAppointment.set(key, []);
    byAppointment.get(key).push(row);
  }
  return [...byAppointment.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([appointmentId, list]) => ({
      appointmentId,
      payments: list.map((p) => ({ paymentId: String(p._id), status: p.status, paymentState: p.paymentState || null, createdAt: p.createdAt || null, flagged: p.activeAppointmentSlot === true })),
    }));
};

export const run = async ({ argv = process.argv.slice(2), db, out = console } = {}) => {
  const dryRun = argv.includes("--dry-run") || argv.includes("--verify-only");
  const asJson = argv.includes("--json");
  const handle = db || mongoose.connection.db;
  const payments = handle.collection("payments");

  let token = null;
  if (!dryRun) {
    const lock = await acquireMigrationLock(handle, MIGRATION_ID);
    if (!lock) { out.error(`${MIGRATION_ID}: another runner holds the migration lock; not running.`); return 4; }
    token = lock.token;
  }

  try {
    const rows = await payments.find(buildCandidateFilter()).project({ appointmentId: 1, status: 1, paymentState: 1, createdAt: 1, activeAppointmentSlot: 1 }).toArray();
    const conflicts = findConflicts(rows);
    const needFlag = rows.filter((r) => r.activeAppointmentSlot !== true).map((r) => r._id);
    const report = { candidates: rows.length, conflicts, toBackfill: needFlag.length, dryRun };

    if (conflicts.length) {
      for (const c of conflicts) {
        out.error(`012: appointment ${c.appointmentId} has ${c.payments.length} active payments: ${c.payments.map((p) => `${p.paymentId}(${p.status})`).join(", ")}`);
      }
      out.error("012: BLOCKED. Resolve these manually (refund/cancel/settle the extra payment through the admin refund flow). No records were changed.");
      if (token) await finishMigration(handle, MIGRATION_ID, token, { status: "blocked", summary: { conflicts: conflicts.length } });
      if (asJson) out.log(JSON.stringify(report, null, 2));
      return 2;
    }

    if (dryRun) {
      if (asJson) out.log(JSON.stringify(report, null, 2)); else out.log(`012: dry-run: ${needFlag.length} payment(s) need the active-slot flag.`);
      return needFlag.length ? 3 : 0;
    }

    let modified = 0;
    for (let i = 0; i < needFlag.length; i += 500) {
      const result = await payments.updateMany({ _id: { $in: needFlag.slice(i, i + 500) }, activeAppointmentSlot: { $exists: false } }, { $set: { activeAppointmentSlot: true } });
      modified += result.modifiedCount || 0;
    }
    report.backfilled = modified;
    await finishMigration(handle, MIGRATION_ID, token, { status: "completed", summary: { candidates: rows.length, backfilled: modified } });
    if (asJson) out.log(JSON.stringify(report, null, 2)); else out.log(`012: ${rows.length} active payment(s) checked; ${modified} backfilled.`);
    return 0;
  } catch (error) {
    if (token) await finishMigration(handle, MIGRATION_ID, token, { status: "failed", summary: { error: String(error?.message).slice(0, 300) } });
    throw error;
  }
};

if (process.argv[1]?.endsWith("012_payment_active_slot.js")) {
  (async () => {
    await connectDB();
    const code = await run();
    await mongoose.disconnect();
    process.exit(code);
  })().catch(async (error) => {
    console.error("012 failed:", error?.message);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(1);
  });
}
