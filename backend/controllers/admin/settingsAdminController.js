import HospitalSetting from "../../models/HospitalSetting.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { validateSettingsUpdate, normaliseSettingsUpdate } from "../../utils/settingsValidation.js";

const defaultSettings = {
  singletonKey: "global",
  hospitalName: "HMS Pro Hospital",
  supportEmail: "support@hmspro.example",
  phone: "",
  timezone: "Asia/Kolkata",
  appointmentLimits: { dailyPerDoctor: 30, bookingWindowDays: 30 },
  paymentSettings: { currency: "INR", taxRate: 18, refundsEnabled: true },
  operationsCapacity: { maxOpenItemsPerAdmin: 12, overloadThresholdPct: 85 },
  governancePolicy: {
    approvalRequiredTiers: ["high", "critical"],
    simulationRequiredTiers: ["high", "critical"],
    documentationRequiredTiers: ["high", "critical"],
    segregationOfDutiesTiers: ["critical"],
  },
};

export const getSettings = asyncHandler(async (_req, res) => {
  const settings = await HospitalSetting.findOneAndUpdate(
    { singletonKey: "global" },
    { $setOnInsert: defaultSettings },
    { upsert: true, returnDocument: "after" },
  ).lean();

  res.status(200).json({ success: true, data: { settings }, message: "Settings fetched successfully" });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const allowed = [
    "hospitalName",
    "logoUrl",
    "supportEmail",
    "phone",
    "timezone",
    "appointmentLimits",
    "paymentSettings",
    "operationsCapacity",
    "governancePolicy",
  ];
  const updates = allowed.reduce((acc, key) => {
    if (req.body[key] !== undefined) acc[key] = req.body[key];
    return acc;
  }, {});

  // The client mirrors these rules, but a client is never the authority: reject bad values with per-field messages.
  const fieldErrors = validateSettingsUpdate(updates);
  if (Object.keys(fieldErrors).length) throw new AppError("Some settings are invalid", 400, { code: "SETTINGS_INVALID", fieldErrors });

  const settings = await HospitalSetting.findOneAndUpdate(
    { singletonKey: "global" },
    { ...normaliseSettingsUpdate(updates), updatedBy: req.user._id },
    { upsert: true, returnDocument: "after", runValidators: true },
  );

  await writeAdminLog({ req, action: "settings.update", resourceType: "settings", resourceId: settings._id.toString() });

  res.status(200).json({ success: true, data: { settings }, message: "Settings saved successfully" });
});
