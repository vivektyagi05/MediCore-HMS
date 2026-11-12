// A-14 (central guard): Express parses a repeated key (?a=1&a=2) or `a[]=` into an array, which many handlers feed to
// .trim()/.toLowerCase()/Number() and turn into a 500 or a surprising filter. No admin endpoint accepts multi-value
// query parameters (verified: no frontend call sends one), so any array/object value is rejected up front with a 400.
import { AppError } from "./errorMiddleware.js";

export function rejectRepeatedQuery(req, _res, next) {
  const query = req.query || {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && typeof value === "object") {
      return next(new AppError(`Query parameter "${key}" must be provided once`, 400));
    }
  }
  return next();
}
