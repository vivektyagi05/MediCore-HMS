// Plausible human ranges for self-reported vitals. Empty/undefined/null is allowed (every field is optional); anything
// else must be a finite number in range. The model only enforced 0..300, so a height of 0 cm or a diastolic pressure
// above the systolic one was saved (and fed the BMI/risk calculations). Client mirror: src/utils/vitalsValidation.js.
export const VITALS_RULES = Object.freeze({
  heightCm: { label: "Height", min: 30, max: 272, unit: "cm" },
  weightKg: { label: "Weight", min: 1, max: 400, unit: "kg" },
  bloodPressureSystolic: { label: "Systolic pressure", min: 50, max: 260, unit: "mmHg" },
  bloodPressureDiastolic: { label: "Diastolic pressure", min: 30, max: 160, unit: "mmHg" },
  restingHeartRate: { label: "Resting heart rate", min: 20, max: 250, unit: "bpm" },
});
export const LIFESTYLE_RULES = Object.freeze({ sleepHoursAvg: { label: "Average sleep", min: 0, max: 24, unit: "hours" } });

const blank = (v) => v === undefined || v === null || v === "";

/** @returns {Record<string,string>} field -> message */
export const validateVitals = (vitals = {}, lifestyle = {}) => {
  const errors = {};
  const check = (rules, source) => {
    for (const [key, rule] of Object.entries(rules)) {
      const raw = source?.[key];
      if (blank(raw)) continue;
      const n = typeof raw === "number" ? raw : (typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN);
      if (!Number.isFinite(n)) errors[key] = `${rule.label} must be a number`;
      else if (n < rule.min || n > rule.max) errors[key] = `${rule.label} must be between ${rule.min} and ${rule.max} ${rule.unit}`;
    }
  };
  check(VITALS_RULES, vitals); check(LIFESTYLE_RULES, lifestyle);
  const sys = Number(vitals?.bloodPressureSystolic); const dia = Number(vitals?.bloodPressureDiastolic);
  if (!blank(vitals?.bloodPressureSystolic) && !blank(vitals?.bloodPressureDiastolic) && !errors.bloodPressureSystolic && !errors.bloodPressureDiastolic && dia >= sys) {
    errors.bloodPressureDiastolic = "Diastolic pressure must be lower than systolic";
  }
  return errors;
};
