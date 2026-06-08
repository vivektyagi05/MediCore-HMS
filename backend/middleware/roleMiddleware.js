import { AppError } from "./errorMiddleware.js";

export const authorizeRoles = (...roles) => (req, _res, next) => {
  if (!req.user) {
    return next(new AppError("Authentication context is missing", 401));
  }

  if (!roles.includes(req.user.role)) {
    return next(new AppError("You are not authorized to access this resource", 403));
  }

  return next();
};
