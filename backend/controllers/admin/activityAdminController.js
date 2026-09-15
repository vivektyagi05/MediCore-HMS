import AdminActivityLog from "../../models/AdminActivityLog.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";

export const listActivityLogs = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const filter = {};

  if (req.query.severity) filter.severity = req.query.severity;
  if (req.query.search) filter.$text = { $search: req.query.search };
  // PHASE UI-14: exact-match filters, additive to the existing $text
  // search above. Needed so a specific workspace (e.g. Export Center's
  // history, or a User's own Audit section) can ask for exactly its own
  // action/resourceId slice of the one real audit log, rather than
  // building a second audit system per PART B6.
  if (req.query.action) filter.action = req.query.action;
  if (req.query.resourceType) filter.resourceType = req.query.resourceType;
  if (req.query.resourceId) filter.resourceId = req.query.resourceId;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const [logs, total] = await Promise.all([
    AdminActivityLog.find(filter)
      .populate("actorId", "name email role")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AdminActivityLog.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Activity logs fetched successfully",
  });
});
