import User from "../../models/User.js";
import AdminActivityLog from "../../models/AdminActivityLog.js";
import Appointment from "../../models/Appointment.js";
import Doctor from "../../models/Doctor.js";
import { ROLES, ROLE_VALUES } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { clampPagination, buildPaginationMeta } from "../../utils/paginationValidation.js";

// BUGFIX: this route accepts both ADMIN and SUPER_ADMIN (see userAdminRoutes.js),
// but nothing stopped a plain ADMIN from deactivating, deleting, or editing a
// SUPER_ADMIN account — completely bypassing the dedicated admin-hierarchy
// permission system (permissionAdminRoutes.js's requirePermission("manage_admins")).
// A plain admin acting on a super_admin, or anyone acting on their own account
// via this endpoint, is blocked here instead.
const assertCanActOnTarget = (actor, targetUser, action) => {
  if (targetUser._id.toString() === actor._id.toString()) {
    throw new AppError(`You cannot ${action} your own account from here`, 403);
  }
  if (targetUser.role === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
    throw new AppError("Only a super admin can modify another super admin's account", 403);
  }
};

// BUGFIX: AdminActivityLog model + its read endpoint (listActivityLogs)
// already existed, but nothing anywhere in the codebase ever wrote to it —
// the audit trail was a dead shell. Wiring it into the sensitive actions here.
const logAdminActivity = (req, action, resourceId, metadata = {}) =>
  AdminActivityLog.create({
    actorId: req.user._id,
    action,
    resourceType: "User",
    resourceId: resourceId?.toString(),
    severity: "warning",
    metadata,
    ip: req.ip,
  }).catch(() => {
    // Audit logging must never block the actual admin action from completing.
  });

// Pure, dependency-free guard (same style as
// doctorController.assertDoctorDeletable) so this rule is unit-testable
// without a live database.
export const assertPatientDeletable = (appointmentCount) => {
  if (appointmentCount > 0) {
    throw new AppError(
      `This patient has ${appointmentCount} appointment${appointmentCount === 1 ? "" : "s"} on record and cannot be permanently deleted. Deactivate the account instead to preserve medical and payment records.`,
      409,
    );
  }
};

// BUGFIX (PHASE UI-14 audit): deleteUser previously only guarded the
// patient case. A doctor-role User is the target of Doctor.userId (see
// Doctor.js's pre-save hook), and doctorController.js already has its
// own referentially-safe delete flow (deleteDoctor -> assertDoctorDeletable,
// blocked while appointments exist) that operates on the Doctor
// document. Nothing previously called deleteUser for a doctor account
// (AdminDoctors.jsx only ever calls toggleUserStatus), so this gap never
// surfaced — but PHASE UI-14's generic User Management workspace can
// reach any role, so the gap is real now. Rather than duplicate
// doctorController's safety logic here, a linked Doctor profile simply
// blocks this endpoint outright and points the admin at the dedicated
// doctor-deletion flow that already owns that decision.
export const assertDoctorUserDeletable = (hasDoctorProfile) => {
  if (hasDoctorProfile) {
    throw new AppError(
      "This account has a linked doctor profile. Delete or manage the doctor profile from Doctor Management instead of deleting the account directly.",
      409,
    );
  }
};

// Regex-escape helper (same pattern as paymentAdminController.js /
// refundAdminController.js) so a user-supplied search term can never be
// interpreted as a regex control sequence.
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// BUGFIX (PHASE UI-14 audit): this endpoint was `User.find({})` — every
// user in the database, unbounded, on every call, with zero search or
// filtering. Reused across AdminDoctors/AdminPatients only for
// mutations (update/status/delete); nothing previously called this list
// endpoint at all, so the unbounded query never surfaced in the running
// app until this phase's User Management workspace queries it directly.
// Now bounded server-side pagination (paginationValidation.js — the
// same shared helper every other admin list endpoint uses) plus
// server-side search/role/status filtering, consistent with PART B10's
// "never load unlimited records" requirement.
export const getUsers = asyncHandler(async (req, res) => {
  const { search, role, status, page, pageSize } = req.query;

  const filter = {};
  if (role) {
    if (!ROLE_VALUES.includes(role)) throw new AppError("Invalid role filter", 400);
    filter.role = role;
  }
  if (status === "active") filter.isActive = true;
  else if (status === "inactive") filter.isActive = false;
  else if (status && status !== "all") throw new AppError("Invalid status filter", 400);

  if (search) {
    const term = String(search).trim().slice(0, 120);
    if (term) {
      const regex = new RegExp(escapeRegex(term), "i");
      filter.$or = [{ name: regex }, { email: regex }];
    }
  }

  const total = await User.countDocuments(filter);
  const { page: safePage, pageSize: safePageSize, skip } = clampPagination(page, pageSize, { total });

  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .select("-password")
    .skip(skip)
    .limit(safePageSize)
    .lean();

  res.status(200).json({
    success: true,
    data: { users },
    meta: buildPaginationMeta(safePage, safePageSize, total),
    message: "Users fetched successfully",
  });
});

export const getUserById = asyncHandler(
async (req, res) => {
const user =
await User.findById(
req.params.id
).select("-password");


if (!user) {
  throw new AppError(
    "User not found",
    404
  );
}

res.status(200).json({
  success: true,
  data: user,
});


}
);

export const updateUser = asyncHandler(
async (req, res) => {

const targetUser = await User.findById(req.params.id);
if (!targetUser) throw new AppError("User not found", 404);
assertCanActOnTarget(req.user, targetUser, "edit");

const allowedUpdates = [
  "name",
  "email",
  "isActive",
  "patientProfile",
];

const updates = {};

allowedUpdates.forEach(
  (field) => {
    if (
      req.body[field] !==
      undefined
    ) {
      updates[field] =
        req.body[field];
    }
  }
);

const user =
  await User.findByIdAndUpdate(
    req.params.id,
    updates,
    {
      new: true,
      runValidators: true,
    }
  ).select("-password");

if (!user) {
  throw new AppError(
    "User not found",
    404
  );
}

await logAdminActivity(req, "user.update", user._id, { fields: Object.keys(updates) });

res.status(200).json({
  success: true,
  data: user,
  message:
    "User updated successfully",
});

}
);

export const deleteUser = asyncHandler(
async (req, res) => {

const targetUser = await User.findById(req.params.id);
if (!targetUser) throw new AppError("User not found", 404);
assertCanActOnTarget(req.user, targetUser, "delete");

// BUGFIX (PHASE UI-4 audit) — same class of finding as
// doctorController.assertDoctorDeletable: unlike Service (audited as
// having zero FK references anywhere), a patient User document is
// referenced by Appointment.patientId everywhere throughout the app —
// clinical history, payments, reports, and prescriptions all hang off
// that appointment trail. A hard delete here would silently orphan real
// medical/financial records. Deactivate (toggleUserStatus) already exists
// and is the real, referentially-safe action; hard delete is now only
// permitted for a patient with zero appointment history on file. A
// doctor-role account is blocked outright while a linked Doctor profile
// exists (see assertDoctorUserDeletable) — that profile owns its own
// safe-delete flow on /api/doctors.
if (targetUser.role === ROLES.PATIENT) {
  const appointmentCount = await Appointment.countDocuments({ patientId: targetUser._id });
  assertPatientDeletable(appointmentCount);
} else if (targetUser.role === ROLES.DOCTOR) {
  const doctorProfile = await Doctor.exists({ userId: targetUser._id });
  assertDoctorUserDeletable(Boolean(doctorProfile));
}

const user =
  await User.findByIdAndDelete(
    req.params.id
  );

if (!user) {
  throw new AppError(
    "User not found",
    404
  );
}

await logAdminActivity(req, "user.delete", user._id, { role: user.role, email: user.email });

res.status(200).json({
  success: true,
  message:
    "User deleted successfully",
});

}
);

export const toggleUserStatus =
asyncHandler(
async (req, res) => {

  const user =
    await User.findById(
      req.params.id
    );

  if (!user) {
    throw new AppError(
      "User not found",
      404
    );
  }

  assertCanActOnTarget(req.user, user, user.isActive ? "deactivate" : "activate");

  user.isActive =
    !user.isActive;

  await user.save();

  await logAdminActivity(req, user.isActive ? "user.activate" : "user.deactivate", user._id);

  res.status(200).json({
    success: true,
    data: user,
    message:
      user.isActive
        ? "User activated"
        : "User deactivated",
  });
}

);
