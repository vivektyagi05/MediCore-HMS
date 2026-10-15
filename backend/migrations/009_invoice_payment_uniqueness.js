// F-008 migration. Idempotent and NON-destructive: it never deletes or edits an
// invoice. Step 1 detects duplicates by paymentId and prints a report. Step 2
// builds the unique index only when there are none. If duplicates exist the
// script exits 2; a human must reconcile them (keep one, void/annotate the rest)
// and re-run. Rollback: db.invoices.dropIndex("uniq_invoice_payment").
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Invoice from "../models/Invoice.js";

export const findDuplicateInvoices = async () =>
  Invoice.aggregate([
    { $match: { paymentId: { $type: "objectId" } } },
    { $group: { _id: "$paymentId", count: { $sum: 1 }, invoiceIds: { $push: "$_id" }, invoiceNumbers: { $push: "$invoiceNumber" } } },
    { $match: { count: { $gt: 1 } } },
  ]);

export const run = async () => {
  await connectDB();
  const duplicates = await findDuplicateInvoices();
  if (duplicates.length > 0) {
    console.error(JSON.stringify({ migration: "009", duplicates }, null, 2));
    console.error(`${duplicates.length} payment(s) have more than one invoice. Index NOT built. Reconcile, then re-run.`);
    return 2;
  }
  await Invoice.collection.createIndex(
    { paymentId: 1 },
    { unique: true, name: "uniq_invoice_payment", partialFilterExpression: { paymentId: { $type: "objectId" } } },
  );
  console.log("009: uniq_invoice_payment index present; no duplicates.");
  return 0;
};

if (process.argv[1]?.endsWith("009_invoice_payment_uniqueness.js")) {
  run().then(async (code) => { await mongoose.disconnect(); process.exit(code); }).catch((e) => { console.error(e); process.exit(1); });
}
