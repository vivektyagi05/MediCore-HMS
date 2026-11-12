// Strict readers for req.query values. Express 5 parses a repeated key (?a=1&a=2) into an array, which handlers that
// call .trim()/String-methods turn into a 500 (audit A-14). These helpers turn that into a clean 400 and never return
// anything but a trimmed string / finite number / undefined.
import { AppError } from "../middleware/errorMiddleware.js";

const isBlank = (v) => v === undefined || v === null || v === "";

export function queryString(query, key, { maxLength = 200 } = {}) {
  const value = query?.[key];
  if (isBlank(value)) return undefined;
  if (typeof value === "object") throw new AppError(`Query parameter "${key}" must be a single value`, 400);
  const text = String(value).trim();
  if (!text) return undefined;
  if (text.length > maxLength) throw new AppError(`Query parameter "${key}" is too long`, 400);
  return text;
}

export function queryNumber(query, key, { min = -Infinity, max = Infinity } = {}) {
  const text = queryString(query, key, { maxLength: 40 });
  if (text === undefined) return undefined;
  const number = Number(text);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new AppError(`Query parameter "${key}" must be a number between ${min} and ${max}`, 400);
  }
  return number;
}
