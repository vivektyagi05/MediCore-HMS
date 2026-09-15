import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export class AppError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

export const notFound = (req, _res, next) => {
  next(new AppError(`Route not found: ${req.originalUrl}`, 404));
};

export const errorMiddleware = (err, req, res, _next) => {
  const isValidationError = err.name === "ValidationError";
  const isCastError = err.name === "CastError";
  // Fallback for any MongoDB unique-index race condition (E11000) that
  // reaches here without already being translated by the specific
  // controller (see appointmentController's SLOT_CONFLICT handling for the
  // booking-specific message). Without this, a raw duplicate-key error would
  // surface as an opaque 500 instead of a real, actionable conflict.
  const isDuplicateKeyError = err.code === 11000;
  const statusCode = err.statusCode || err.status || (isValidationError || isCastError ? 400 : isDuplicateKeyError ? 409 : 500);
  const message = isValidationError
    ? "Validation failed"
    : isCastError
      ? `Invalid value for ${err.path}`
      : isDuplicateKeyError
        ? "This record already exists — please refresh and try again."
        : err.message || "Internal server error";
  const details = err.details || (isValidationError
    ? Object.fromEntries(Object.entries(err.errors || {}).map(([key, value]) => [key, value.message]))
    : undefined);

  logger.error(message, {
    method: req.method,
    route: req.originalUrl,
    statusCode,
    stack: env.isProduction ? undefined : err.stack,
  });

  res.status(statusCode).json({
    success: false,
    message,
    ...(details ? { details } : {}),
  });
};
