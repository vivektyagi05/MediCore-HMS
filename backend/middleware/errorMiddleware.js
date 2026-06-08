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
  const statusCode = err.statusCode || err.status || (isValidationError || isCastError ? 400 : 500);
  const message = isValidationError
    ? "Validation failed"
    : isCastError
      ? `Invalid value for ${err.path}`
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
    ...(!env.isProduction ? { stack: err.stack } : {}),
  });
};
