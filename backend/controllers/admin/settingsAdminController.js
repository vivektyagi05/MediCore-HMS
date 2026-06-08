import HospitalSetting from "../../models/HospitalSetting.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { writeAdminLog } from "../../utils/adminAudit.js";

const defaultSettings = {
  singletonKey: "global",
  hospitalName: "HMS Pro Hospital",
  supportEmail: "support@hmspro.example",
  phone: "",
  timezone: "Asia/Kolkata",
  appointmentLimits: { dailyPerDoctor: 30, bookingWindowDays: 30 },
  paymentSettings: { currency: "INR", taxRate: 18, refundsEnabled: true },
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
  ];
  const updates = allowed.reduce((acc, key) => {
    if (req.body[key] !== undefined) acc[key] = req.body[key];
    return acc;
  }, {});

  const settings = await HospitalSetting.findOneAndUpdate(
    { singletonKey: "global" },
    { ...updates, updatedBy: req.user._id },
    { upsert: true, returnDocument: "after", runValidators: true },
  );

  await writeAdminLog({ req, action: "settings.update", resourceType: "settings", resourceId: settings._id.toString() });

  res.status(200).json({ success: true, data: { settings }, message: "Settings saved successfully" });
});
