import Permission from "../models/Permission.js";
import { ADMIN_ROLES, ROLE_RANK } from "../constants/roles.js";
import { AppError } from "./errorMiddleware.js";

export const requireAdmin = (req, _res, next) => {
  if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
    return next(new AppError("Admin access is required", 403));
  }

  return next();
};

export const requirePermission = (permissionKey) => async (req, _res, next) => {
  try {
    if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
      return next(new AppError("Admin access is required", 403));
    }

    if (req.user.role === "super_admin") return next();

    const permission = await Permission.findOne({ role: req.user.role }).lean();
    const permissions = permission?.permissions;
    const hasPermission = permissions instanceof Map
      ? permissions.get(permissionKey)
      : permissions?.[permissionKey];

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
