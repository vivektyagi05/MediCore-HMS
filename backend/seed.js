import { connectDB } from "./config/db.js";
import { logger } from "./utils/logger.js";
import Permission, { PERMISSION_KEYS } from "./models/Permission.js";
import Service from "./models/Service.js";
import User from "./models/User.js";
import FeatureToggle from "./models/FeatureToggle.js";
import HospitalSetting from "./models/HospitalSetting.js";

const adminEmail = process.env.SEED_SUPER_ADMIN_EMAIL || "superadmin@hms.local";
const adminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD || "ChangeMe123!";
const adminName = process.env.SEED_SUPER_ADMIN_NAME || "HMS Super Admin";

const allPermissions = PERMISSION_KEYS.reduce((acc, key) => {
  acc[key] = true;
  return acc;
}, {});

const defaultServices = [
  {
    title: "General Consultation",
    description: "Primary care consultation for common health concerns and follow-up planning.",
    price: 800,
    category: "Consultation",
    icon: "stethoscope",
  },
  {
    title: "Cardiology Consultation",
    description: "Specialist consultation for heart health, chest discomfort, and cardiac follow-up.",
    price: 1500,
    category: "Specialist",
    icon: "heart-pulse",
  },
  {
    title: "Diagnostic Report Review",
    description: "Doctor-led review of uploaded medical reports and next-step recommendations.",
    price: 500,
    category: "Diagnostics",
    icon: "file-text",
  },
];

const defaultFeatures = [
  { key: "wallet_system", label: "Wallet System", description: "Patient wallet credits and payments", isEnabled: true },
  { key: "subscriptions", label: "Subscriptions", description: "Recurring healthcare packages", isEnabled: true },
  { key: "reviews", label: "Reviews", description: "Doctor and service reviews", isEnabled: true },
  { key: "chat", label: "Chat", description: "Patient-care team messaging", isEnabled: true },
  { key: "ai_features", label: "AI Features", description: "AI summaries and assistance", isEnabled: true },
];

const seed = async () => {
  await connectDB();

  let superAdmin = await User.findOne({ email: adminEmail });
  if (!superAdmin) {
    superAdmin = await User.create({
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: "super_admin",
      isActive: true,
    });
  }

  await Promise.all([
    Permission.findOneAndUpdate(
      { role: "admin" },
      { permissions: allPermissions, isSystemRole: true, updatedBy: superAdmin._id },
      { upsert: true, returnDocument: "after" },
    ),
    Permission.findOneAndUpdate(
      { role: "super_admin" },
      { permissions: allPermissions, isSystemRole: true, updatedBy: superAdmin._id },
      { upsert: true, returnDocument: "after" },
    ),
    HospitalSetting.findOneAndUpdate(
      { singletonKey: "global" },
      {
        $setOnInsert: {
          singletonKey: "global",
          hospitalName: "HMS Pro Hospital",
          supportEmail: "support@hmspro.example",
          timezone: "Asia/Kolkata",
          appointmentLimits: { dailyPerDoctor: 30, bookingWindowDays: 30 },
          paymentSettings: { currency: "INR", taxRate: 18, refundsEnabled: true },
        },
      },
      { upsert: true, returnDocument: "after" },
    ),
    ...defaultFeatures.map((feature) =>
      FeatureToggle.findOneAndUpdate({ key: feature.key }, { $setOnInsert: feature }, { upsert: true }),
    ),
    ...defaultServices.map((service) =>
      Service.findOneAndUpdate(
        { title: service.title },
        { $setOnInsert: { ...service, createdBy: superAdmin._id, updatedBy: superAdmin._id } },
        { upsert: true, returnDocument: "after" },
      ),
    ),
  ]);

  logger.info("Seed completed", {
    superAdminEmail: adminEmail,
    defaultServices: defaultServices.length,
    defaultFeatures: defaultFeatures.length,
  });
};

if (process.argv[1]?.endsWith("seed.js")) {
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Seed failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}

export { seed };
