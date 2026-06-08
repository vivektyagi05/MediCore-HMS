import { ROLES } from "../constants/roles.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PUBLIC_REGISTER_ROLES = [ROLES.PATIENT, ROLES.DOCTOR];

export const validateRegister = (payload) => {
  const errors = {};

  if (!payload.name || payload.name.trim().length < 2) {
    errors.name = "Name must be at least 2 characters long";
  }

  if (!payload.email || !emailPattern.test(payload.email)) {
    errors.email = "A valid email address is required";
  }

  if (!payload.password || payload.password.length < 8) {
    errors.password = "Password must be at least 8 characters long";
  }

  if (!payload.role || !PUBLIC_REGISTER_ROLES.includes(payload.role)) {
    errors.role = `Public registration only supports: ${PUBLIC_REGISTER_ROLES.join(", ")}`;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const validateLogin = (payload) => {
  const errors = {};

  if (!payload.email || !emailPattern.test(payload.email)) {
    errors.email = "A valid email address is required";
  }

  if (!payload.password) {
    errors.password = "Password is required";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
