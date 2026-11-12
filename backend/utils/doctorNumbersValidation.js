// Experience, consultation fee and graduation year. The old admin check was `Number(x) < 0`, which lets "abc" (NaN) and ""
// (0) through because `NaN < 0` is false, and nothing capped any value. Client mirror: src/utils/doctorNumbersValidation.js.
export const DOCTOR_NUMBER_LIMITS = Object.freeze({ experienceMax: 70, feesMax: 100000, graduationYearMin: 1940 });
const MONEY = /^\d+(\.\d{1,2})?$/;
const text = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : "");

/** Validates only the keys that are present (`undefined` = not provided). Required-ness is the caller's job. */
export const validateDoctorNumbers = ({ experience, fees, graduationYear } = {}, { now = new Date() } = {}) => {
  const e = {};
  if (experience !== undefined) {
    const t = text(experience);
    if (!/^\d{1,3}$/.test(t) || Number(t) > DOCTOR_NUMBER_LIMITS.experienceMax) e.experience = `Experience must be a whole number of years from 0 to ${DOCTOR_NUMBER_LIMITS.experienceMax}`;
  }
  if (fees !== undefined) {
    const t = text(fees);
    if (!MONEY.test(t) || Number(t) > DOCTOR_NUMBER_LIMITS.feesMax) e.fees = `Consultation fee must be an amount from 0 to ${DOCTOR_NUMBER_LIMITS.feesMax.toLocaleString("en-IN")} with at most 2 decimals`;
  }
  if (graduationYear !== undefined && graduationYear !== null && text(graduationYear) !== "") {
    const t = text(graduationYear); const maxYear = now.getUTCFullYear();
    if (!/^\d{4}$/.test(t) || Number(t) < DOCTOR_NUMBER_LIMITS.graduationYearMin || Number(t) > maxYear) e.graduationYear = `Graduation year must be between ${DOCTOR_NUMBER_LIMITS.graduationYearMin} and ${maxYear}`;
  }
  return e;
};
