import { ROLES } from "../constants/roles.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PUBLIC_REGISTER_ROLES = [ROLES.PATIENT, ROLES.DOCTOR];

// Limits: email/name match the User schema (maxlength 120); password max 128 because bcrypt only uses the first 72 bytes
// (longer input is silently truncated) and unbounded input is a cheap way to burn CPU. Every field is type-checked first:
// before this, `{"name": 5}` or `{"password": ["a","b",...8 items]}` slipped past the length checks or crashed later with a 500.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const isStr = (v) => typeof v === "string";

export const validatePasswordValue = (password) => {
  if (!isStr(password) || password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters long`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters long`;
  if (!/\S/.test(password)) return "Password cannot be only spaces";
  return "";
};

export const validateRegister = (payload = {}) => {
  const errors = {};

  if (!isStr(payload.name) || payload.name.trim().length < 2) {
    errors.name = "Name must be at least 2 characters long";
  } else if (payload.name.trim().length > 100) {
    errors.name = "Name must be at most 100 characters long";
  }

  if (!isStr(payload.email) || !emailPattern.test(payload.email.trim()) || payload.email.trim().length > 120) {
    errors.email = "A valid email address is required";
  }

  const passwordError = validatePasswordValue(payload.password);
  if (passwordError) errors.password = passwordError;

  if (!payload.role || !PUBLIC_REGISTER_ROLES.includes(payload.role)) {
    errors.role = `Public registration only supports: ${PUBLIC_REGISTER_ROLES.join(", ")}`;
  }

  if (payload.termsAccepted !== true) {
    errors.termsAccepted = "You must accept the Terms of Service and Privacy Policy";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const validateLogin = (payload = {}) => {
  const errors = {};

  if (!isStr(payload.email) || !emailPattern.test(payload.email.trim())) {
    errors.email = "A valid email address is required";
  }

  // login only needs "a string that is not absurdly long": the real check is the hash comparison
  if (!isStr(payload.password) || !payload.password) {
    errors.password = "Password is required";
  } else if (payload.password.length > PASSWORD_MAX) {
    errors.password = "Password is too long";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
