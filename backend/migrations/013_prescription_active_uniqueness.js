// D-02 migration. Idempotent and NON-destructive: it never edits or deletes a prescription. Step 1 detects
// appointments that already have more than one ACTIVE prescription and prints a report. Step 2 builds the
// partial unique index only when there are none. If duplicates exist the script exits 2 and the index is NOT
// built; a clinician/admin must decide which prescription stands (void the others) and re-run.
// Rollback: db.prescriptions.dropIndex("uniq_prescription_active_appointment").
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Prescription from "../models/Prescription.js";

export const INDEX_NAME = "uniq_prescription_active_appointment";

export const findDuplicateActivePrescriptions = async () =>
  Prescription.aggregate([
    { $match: { status: "active", appointmentId: { $type: "objectId" } } },
    { $group: { _id: "$appointmentId", count: { $sum: 1 }, prescriptionIds: { $push: "$_id" }, createdAt: { $push: "$createdAt" } } },
    { $match: { count: { $gt: 1 } } },
  ]);

export const run = async () => {
  await connectDB();
  const duplicates = await findDuplicateActivePrescriptions();
  if (duplicates.length > 0) {
    console.error(JSON.stringify({ migration: "013", duplicates }, null, 2));
    console.error(`${duplicates.length} appointment(s) have more than one active prescription. Index NOT built. Reconcile (void all but one), then re-run.`);
    return 2;
  }
  await Prescription.collection.createIndex(
    { appointmentId: 1 },
    { unique: true, name: INDEX_NAME, partialFilterExpression: { status: "active" } },
  );
  console.log(`013: ${INDEX_NAME} index present; no duplicate active prescriptions.`);
  return 0;
};

if (process.argv[1]?.endsWith("013_prescription_active_uniqueness.js")) {
  run().then(async (code) => { await mongoose.disconnect(); process.exit(code); }).catch((e) => { console.error(e); process.exit(1); });
}
