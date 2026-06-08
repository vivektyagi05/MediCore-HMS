import FeatureToggle from "../../models/FeatureToggle.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";

const defaultFeatures = [
  { key: "wallet_system", label: "Wallet System", description: "Patient wallet credits and payments", isEnabled: true },
  { key: "subscriptions", label: "Subscriptions", description: "Recurring healthcare packages", isEnabled: false },
  { key: "reviews", label: "Reviews", description: "Doctor and service reviews", isEnabled: false },
  { key: "chat", label: "Chat", description: "Patient-care team messaging", isEnabled: false },
  { key: "ai_features", label: "AI Features", description: "AI summaries and assistance", isEnabled: false },
];

export const listFeatureToggles = asyncHandler(async (_req, res) => {
  await Promise.all(
    defaultFeatures.map((feature) =>
      FeatureToggle.findOneAndUpdate({ key: feature.key }, { $setOnInsert: feature }, { upsert: true }),
    ),
  );
  const features = await FeatureToggle.find().sort({ key: 1 }).lean();
  res.status(200).json({ success: true, data: { features }, message: "Feature toggles fetched successfully" });
});

export const updateFeatureToggle = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const feature = await FeatureToggle.findOneAndUpdate(
    { key },
    {
      isEnabled: Boolean(req.body.isEnabled),
      rolloutPercentage: req.body.rolloutPercentage ?? 100,
      updatedBy: req.user._id,
    },
    { returnDocument: "after", runValidators: true },
  );
  if (!feature) throw new AppError("Feature toggle not found", 404);
  await writeAdminLog({ req, action: "feature.update", resourceType: "feature_toggle", resourceId: key });
  res.status(200).json({ success: true, data: { feature }, message: "Feature toggle updated successfully" });
});
