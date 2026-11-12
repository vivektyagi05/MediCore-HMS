import AdminActivityLog from "../../models/AdminActivityLog.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { queryString } from "../../utils/queryParams.js";

const SEVERITIES = ["info", "warning", "critical"];
const queryDate = (query, key) => {
  const text = queryString(query, key);
  if (text === undefined) return undefined;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new AppError(`Query parameter "${key}" must be a valid date`, 400);
  return date;
};

export const listActivityLogs = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const filter = {};

  // A-14: repeated keys / non-strings are a 400, not a 500; unknown severities and invalid dates are rejected up front.
  const severity = queryString(req.query, "severity");
  if (severity !== undefined && !SEVERITIES.includes(severity)) throw new AppError("Query parameter \"severity\" is not a valid severity", 400);
  const search = queryString(req.query, "search");
  const action = queryString(req.query, "action");
  const resourceType = queryString(req.query, "resourceType");
  const resourceId = queryString(req.query, "resourceId");
  const from = queryDate(req.query, "from");
  const to = queryDate(req.query, "to");

  if (severity) filter.severity = severity;
  if (search) filter.$text = { $search: search };
  // PHASE UI-14: exact-match filters, additive to the existing $text
  // search above. Needed so a specific workspace (e.g. Export Center's
  // history, or a User's own Audit section) can ask for exactly its own
  // action/resourceId slice of the one real audit log, rather than
  // building a second audit system per PART B6.
  if (action) filter.action = action;
  if (resourceType) filter.resourceType = resourceType;
  if (resourceId) filter.resourceId = resourceId;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  const [logs, total] = await Promise.all([
    AdminActivityLog.find(filter)
      .populate("actorId", "name email role")
      .sort({ createdAt: -1, _id: -1 })
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
