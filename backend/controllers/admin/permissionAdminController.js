import Permission, { PERMISSION_KEYS } from "../../models/Permission.js";
import User from "../../models/User.js";
import { ROLE_VALUES, ROLE_RANK } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { assertCanManageRole } from "../../middleware/adminMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";

const normalizePermissions = (permissions = {}) =>
  PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = Boolean(permissions[key]);
    return acc;
  }, {});

export const listPermissions = asyncHandler(async (_req, res) => {
  const existing = await Permission.find().lean();
  const byRole = new Map(existing.map((item) => [item.role, item]));
  const permissions = ROLE_VALUES.map((role) => byRole.get(role) || { role, permissions: normalizePermissions() });

  res.status(200).json({
    success: true,
    data: { permissions, permissionKeys: PERMISSION_KEYS },
    message: "Permissions fetched successfully",
  });
});

export const updateRolePermissions = asyncHandler(async (req, res) => {
  const { role } = req.params;
  if (!ROLE_VALUES.includes(role)) throw new AppError("Invalid role", 400);
  if ((ROLE_RANK[req.user.role] || 0) <= (ROLE_RANK[role] || 0)) {
    throw new AppError("You cannot modify equal or higher privilege roles", 403);
  }

  const permission = await Permission.findOneAndUpdate(
    { role },
    { permissions: normalizePermissions(req.body.permissions), updatedBy: req.user._id },
    { upsert: true, returnDocument: "after" },
  );

  await writeAdminLog({ req, action: "permission.update", resourceType: "permission", resourceId: role, severity: "warning" });

  res.status(200).json({ success: true, data: { permission }, message: "Permissions updated successfully" });
});

export const listAdmins = asyncHandler(async (_req, res) => {
  const admins = await User.find({ role: { $in: ["super_admin", "admin"] } }).select("-password").sort({ role: 1, createdAt: -1 }).lean();
  res.status(200).json({ success: true, data: { admins }, message: "Admins fetched successfully" });
});

export const updateAdminRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!["super_admin", "admin"].includes(role)) throw new AppError("Invalid admin role", 400);

  const target = await User.findById(req.params.id);
  if (!target) throw new AppError("Admin user not found", 404);
  assertCanManageRole(req.user.role, target.role);
  assertCanManageRole(req.user.role, role);

  target.role = role;
  await target.save();
  await writeAdminLog({ req, action: "admin.role_update", resourceType: "user", resourceId: target._id.toString(), severity: "critical" });

  res.status(200).json({ success: true, data: { admin: target.toJSON() }, message: "Admin hierarchy updated successfully" });
});
