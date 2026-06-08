import AdminActivityLog from "../../models/AdminActivityLog.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";

export const listActivityLogs = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const filter = {};

  if (req.query.severity) filter.severity = req.query.severity;
  if (req.query.search) filter.$text = { $search: req.query.search };
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
