import Permission from "../models/Permission.js";
import { ADMIN_ROLES, ROLE_RANK } from "../constants/roles.js";
import { AppError } from "./errorMiddleware.js";

export const requireAdmin = (req, _res, next) => {
  if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
    return next(new AppError("Admin access is required", 403));
  }

  return next();
};

// Phase A5.2: extracted so the Smart Widgets endpoint (which needs a plain
// boolean rather than an Express next()-calling flow) can reuse the exact
// same permission-lookup logic requirePermission() already uses below —
// one place decides what a role can do, not two.
export const userHasPermission = async (user, permissionKey) => {
  if (!user || !ADMIN_ROLES.includes(user.role)) return false;
  if (user.role === "super_admin") return true;

  const permission = await Permission.findOne({ role: user.role }).lean();
  const permissions = permission?.permissions;
  return Boolean(permissions instanceof Map ? permissions.get(permissionKey) : permissions?.[permissionKey]);
};

export const requirePermission = (permissionKey) => async (req, _res, next) => {
  try {
    if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
      return next(new AppError("Admin access is required", 403));
    }

    const hasPermission = permissionKey ? await userHasPermission(req.user, permissionKey) : true;

    if (!hasPermission) {
      return next(new AppError("You do not have permission for this admin action", 403));
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

export const assertCanManageRole = (actorRole, targetRole) => {
  if ((ROLE_RANK[actorRole] || 0) <= (ROLE_RANK[targetRole] || 0)) {
    throw new AppError("Lower admins cannot modify equal or higher privilege admins", 403);
  }
};
