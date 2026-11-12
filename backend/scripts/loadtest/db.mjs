// Mongoose bootstrap for the load-test tool. Imported ONLY after safety gates pass.
// The application's own MONGO_URI is overwritten in-process with the verified test
// URI before any model is imported, so nothing can ever resolve to the app database.
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";

export const MODEL_FILES = Object.freeze({
  users: "User", doctors: "Doctor", appointments: "Appointment", payments: "Payment", invoices: "Invoice", payouts: "DoctorPayout",
  ledger: "TransactionLedger", refunds: "RefundRequest", notes: "MedicalNote", prescriptions: "Prescription", reviews: "Review",
  notifications: "NotificationDelivery", reminders: "ReminderLog", chats: "ChatMessage", saved: "SavedDoctor",
  adminLogs: "AdminActivityLog", cronLogs: "CronRunLog", automationLogs: "AutomationRunLog",
});

export const connectTest = async (verifiedUri, expectedDb, { maxPoolSize = 8 } = {}) => {
  process.env.MONGO_URI = verifiedUri; // never the application URI
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = randomBytes(32).toString("hex"); // models import env.js; value is unused here
  mongoose.set("strictQuery", true);
  mongoose.set("autoIndex", false);   // index creation is explicit (--ensure-indexes) in the test DB only
  mongoose.set("autoCreate", false);  // no implicit collection creation
  await mongoose.connect(verifiedUri, { serverSelectionTimeoutMS: 10000, maxPoolSize });
  if (mongoose.connection.name !== expectedDb) {
    await mongoose.disconnect();
    throw new Error("Connected database name does not match the verified target; aborting.");
  }
  return mongoose;
};

export const loadModels = async () => {
  const out = {};
  for (const [key, file] of Object.entries(MODEL_FILES)) out[key] = (await import(`../../models/${file}.js`)).default;
  out.MasterData = (await import("../../models/MasterData.js")).default;
  return out;
};

export const disconnect = async () => { if (mongoose.connection.readyState !== 0) await mongoose.disconnect(); };
