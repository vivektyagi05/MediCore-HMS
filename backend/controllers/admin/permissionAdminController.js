import Permission, { PERMISSION_KEYS } from "../../models/Permission.js";
import User from "../../models/User.js";
import { ROLE_VALUES, ROLE_RANK } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { assertCanManageRole } from "../../middleware/adminMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { emitAutomationTrigger } from "../../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../../automation-studio/triggerRegistry.js";

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

// PHASE 2-D: "admin" is no longer a valid role at all (see
// constants/roles.js — the hard constraint this phase enforces). The
// "Admin Hierarchy" this endpoint pair backs used to manage two tiers
// (admin/super_admin) with a rank-based promote/demote model; with only
// one admin-tier role left, listAdmins is now simply the super-admin
// roster, and updateAdminRole is now strictly a one-way promotion of an
// existing non-admin user (doctor or patient) to super_admin. It can no
// longer create, demote, or otherwise manage a second admin tier, because
// none exists.
export const listAdmins = asyncHandler(async (_req, res) => {
  const admins = await User.find({ role: "super_admin" }).select("-password").sort({ createdAt: -1 }).lean();
  res.status(200).json({ success: true, data: { admins }, message: "Super admins fetched successfully" });
});

// PHASE 2-C — Section 3 bugfix (kept, still applicable): assertCanManageRole
// rejects whenever ROLE_RANK[actor] <= ROLE_RANK[target] — correct for
// acting on an EXISTING account, but was previously misapplied against the
// REQUESTED role too, making super-admin grants impossible. PHASE 2-D
// narrows the whole operation to a single legal transition: promoting an
// existing non-super-admin user to super_admin. There is no "admin" role to
// grant or revoke anymore, and demoting a super_admin isn't offered here
// (no valid target role for it is defined by the current product spec) —
// disclosed rather than invented.
export const updateAdminRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (role !== "super_admin") {
    throw new AppError("Invalid role. Only promotion to super_admin is supported.", 400);
  }

  const target = await User.findById(req.params.id);
  if (!target) throw new AppError("User not found", 404);

  if (target._id.toString() === req.user._id.toString()) {
    throw new AppError("You cannot change your own role", 403);
  }

  if (target.role === "super_admin") {
    throw new AppError("This user is already a super admin", 400);
  }

  // Only an existing super admin may grant super admin access.
  assertCanManageRole(req.user.role, target.role);

  const previousRole = target.role;
  target.role = role;
  await target.save();
  await writeAdminLog({ req, action: "admin.role_update", resourceType: "user", resourceId: target._id.toString(), severity: "critical" });

  // Phase A6.2.3 — Automation Studio real trigger.
  await emitAutomationTrigger(TRIGGER_TYPES.ROLE_CHANGED, {
    userId: target._id,
    previousRole,
    newRole: role,
  });

  res.status(200).json({ success: true, data: { admin: target.toJSON() }, message: "User promoted to super admin" });
});
