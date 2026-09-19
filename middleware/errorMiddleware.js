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
  // PHASE 2-C — Section 30/33 bugfix: Mongoose's built-in optimistic
  // concurrency control throws a VersionError whenever two concurrent
  // .save() calls both push into the same array field (e.g. a withdrawal's
  // or doctor's stateHistory/verificationHistory) after loading the same
  // document version -- exactly the concurrent-admin-action race this
  // phase's brief calls out. Without this branch, the loser's request fell
  // through to the generic 500 case below with Mongoose's raw internal
  // message ("No matching document found for id \"...\" version ...")
  // instead of the honest, actionable 409 "someone else already changed
  // this — refresh and retry" that a real state-changed conflict deserves.
  const isVersionError = err.name === "VersionError";
  const statusCode =
    err.statusCode || err.status || (isValidationError || isCastError ? 400 : isDuplicateKeyError || isVersionError ? 409 : 500);
  const message = isValidationError
    ? "Validation failed"
    : isCastError
      ? `Invalid value for ${err.path}`
      : isDuplicateKeyError
        ? "This record already exists — please refresh and try again."
        : isVersionError
          ? "This record was just updated by someone else — please refresh and try again."
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
