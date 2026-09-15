/**
 * Migration 001 — Add missing fields introduced during Phase 1 audit
 *
 * Run once against a live MongoDB instance:
 *   node backend/migrations/001_add_missing_fields.js
 *
 * Safe to re-run — all operations are idempotent.
 */

import mongoose from "mongoose";
import { env } from "../config/env.js";

const run = async () => {
  await mongoose.connect(env.mongoUri);
  const db = mongoose.connection.db;

  // ── 1. Review: backfill adminDeleted and editHistory ────────────────────────
  const reviewResult = await db.collection("reviews").updateMany(
    { adminDeleted: { $exists: false } },
    {
      $set: { adminDeleted: false, editHistory: [] },
    },
  );
  console.log(`reviews — backfilled adminDeleted/editHistory on ${reviewResult.modifiedCount} docs`);

  // ── 2. DoctorPayout: backfill status default and unique index ────────────────
  const payoutResult = await db.collection("doctorpayouts").updateMany(
    { status: { $exists: false } },
    { $set: { status: "pending" } },
  );
  console.log(`doctorpayouts — backfilled status on ${payoutResult.modifiedCount} docs`);

  // Ensure unique index on paymentId (prevents double-payout)
  try {
    await db.collection("doctorpayouts").createIndex(
      { paymentId: 1 },
      { unique: true, name: "paymentId_unique" },
    );
    console.log("doctorpayouts — unique index on paymentId created");
  } catch (err) {
    if (err.code === 85 || err.code === 11000) {
      console.log("doctorpayouts — paymentId unique index already exists");
    } else {
      throw err;
    }
  }

  // ── 3. Appointments: backfill new statuses — already handled by mongoose enum
  //    update any legacy "completed" appointments that should be "review_eligible"
  //    ONLY if they have at least one review — leave the rest as "completed"
  const reviewedApptIds = await db
    .collection("reviews")
    .distinct("appointmentId", { adminDeleted: { $ne: true } });

  if (reviewedApptIds.length) {
    const apptResult = await db.collection("appointments").updateMany(
      { _id: { $in: reviewedApptIds }, status: "completed" },
      { $set: { status: "review_eligible" } },
    );
    console.log(`appointments — moved ${apptResult.modifiedCount} reviewed appointments to review_eligible`);
  }

  // ── 4. Payments: ensure paymentStatus "paid" maps to appointment status "payment_completed"
  const paidPayments = await db
    .collection("payments")
    .find({ status: "captured" })
    .project({ _id: 1, appointmentId: 1 })
    .toArray();

  let paymentSyncCount = 0;
  for (const p of paidPayments) {
    if (!p.appointmentId) continue;
    const appt = await db
      .collection("appointments")
      .findOne({ _id: p.appointmentId });
    // Only update appointments stuck in "approved" with paid payment
    if (appt && appt.status === "approved") {
      await db
        .collection("appointments")
        .updateOne(
          { _id: p.appointmentId },
          { $set: { status: "payment_completed", paymentStatus: "paid" } },
        );
      paymentSyncCount++;
    }
  }
  console.log(`appointments — synced payment_completed status on ${paymentSyncCount} docs`);

  // ── 5. ConsultationHistory: ensure collection + indexes exist ────────────────
  const collections = await db.listCollections({ name: "consultationhistories" }).toArray();
  if (!collections.length) {
    await db.createCollection("consultationhistories");
    console.log("consultationhistories — collection created");
  }
  await db.collection("consultationhistories").createIndex(
    { doctorId: 1, patientId: 1, appointmentId: 1 },
    { unique: true, name: "doctor_patient_appointment_unique" },
  );
  console.log("consultationhistories — unique compound index ensured");

  console.log("\n✅ Migration 001 complete");
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
