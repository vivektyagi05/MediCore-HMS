/**
 * Validate an optional ObjectId query parameter before building a list filter.
 * Invalid context IDs must never be silently ignored, because doing so turns a
 * narrow cross-page link into an unfiltered list request.
 */
export function readOptionalObjectIdQuery(query, key, label, isValidObjectId) {
  const value = query?.[key];
  if (value === undefined || value === null || value === "") return null;

  if (typeof value !== "string" || !isValidObjectId(value)) {
    const error = new Error(`Invalid ${label} id`);
    error.statusCode = 400;
    error.isOperational = true;
    throw error;
  }

  return value;
}
