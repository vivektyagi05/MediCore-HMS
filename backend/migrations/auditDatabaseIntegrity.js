import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import Invoice from "../models/Invoice.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import { repairMissingDoctorProfiles } from "../services/doctorProfileService.js";
import { logger } from "../utils/logger.js";

const idSet = (items) => new Set(items.map((item) => item._id.toString()));

const countMissingRefs = (items, field, validIds) =>
  items.filter((item) => {
    const value = item[field];
    return value && !validIds.has(value.toString());
  }).length;

const run = async () => {
  await connectDB();

  const doctorRepair = await repairMissingDoctorProfiles();

  const [users, doctors, appointments, wallets, invoices, payments, notifications] = await Promise.all([
    User.find().select("_id role isActive").lean(),
    Doctor.find().select("_id userId").lean(),
    Appointment.find().select("_id patientId doctorId familyMemberId").lean(),
    Wallet.find().select("_id userId").lean(),
    Invoice.find().select("_id userId doctorId appointmentId paymentId").lean(),
    Payment.find().select("_id userId doctorId appointmentId invoiceId").lean(),
    NotificationDelivery.find().select("_id recipientId actorId").lean(),
  ]);

  const userIds = idSet(users);
  const doctorIds = idSet(doctors);
  const appointmentIds = idSet(appointments);
  const paymentIds = idSet(payments);
  const invoiceIds = idSet(invoices);

  const report = {
    users: {
      total: users.length,
      doctors: users.filter((user) => user.role === "doctor").length,
      patients: users.filter((user) => user.role === "patient").length,
    },
    doctors: {
      total: doctors.length,
      missingUser: countMissingRefs(doctors, "userId", userIds),
      repairedMissingProfiles: doctorRepair.repaired,
    },
    appointments: {
      total: appointments.length,
      missingPatient: countMissingRefs(appointments, "patientId", userIds),
      missingDoctor: countMissingRefs(appointments, "doctorId", doctorIds),
    },
    wallets: {
      total: wallets.length,
      missingUser: countMissingRefs(wallets, "userId", userIds),
    },
    invoices: {
      total: invoices.length,
      missingUser: countMissingRefs(invoices, "userId", userIds),
      missingDoctor: countMissingRefs(invoices, "doctorId", doctorIds),
      missingAppointment: countMissingRefs(invoices, "appointmentId", appointmentIds),
      missingPayment: countMissingRefs(invoices, "paymentId", paymentIds),
    },
    payments: {
      total: payments.length,
      missingUser: countMissingRefs(payments, "userId", userIds),
      missingDoctor: countMissingRefs(payments, "doctorId", doctorIds),
      missingAppointment: countMissingRefs(payments, "appointmentId", appointmentIds),
      missingInvoice: countMissingRefs(payments, "invoiceId", invoiceIds),
    },
    notifications: {
      total: notifications.length,
      missingRecipient: countMissingRefs(notifications, "recipientId", userIds),
      missingActor: countMissingRefs(notifications, "actorId", userIds),
    },
  };

  logger.info("Database integrity audit completed", report);
  console.log(JSON.stringify(report, null, 2));

  await mongoose.disconnect();
};

if (process.argv[1]?.endsWith("auditDatabaseIntegrity.js")) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Database integrity audit failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

export { run };
