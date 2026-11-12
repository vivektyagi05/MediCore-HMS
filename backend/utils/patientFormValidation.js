// Validation for patient-entered records (family member, insurance policy, insurance claim).
// Client mirror: src/utils/patientFormValidation.js (parity-tested). The server is the authority.
const str = (v) => (typeof v === "string" ? v.trim() : "");
const MONEY = /^\d+(\.\d{1,2})?$/;
const asMoneyString = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : "");

export const validateFamilyMember = (f = {}) => {
  const e = {};
  const name = str(f.name); if (name.length < 2 || name.length > 100) e.name = "Name must be 2-100 characters";
  const relation = str(f.relation); if (relation.length < 2 || relation.length > 80) e.relation = "Relation must be 2-80 characters";
  const ageText = typeof f.age === "number" ? String(f.age) : str(f.age);
  if (!/^\d{1,3}$/.test(ageText) || Number(ageText) > 130) e.age = "Age must be a whole number from 0 to 130";
  const gender = str(f.gender); if (!gender) e.gender = "Select a gender"; else if (gender.length > 30) e.gender = "Gender is too long";
  const conds = Array.isArray(f.medicalConditions) ? f.medicalConditions : typeof f.medicalConditions === "string" ? f.medicalConditions.split(",").map((x) => x.trim()).filter(Boolean) : [];
  if (conds.length > 20) e.medicalConditions = "At most 20 conditions";
  else if (conds.some((c) => typeof c !== "string" || c.length > 100)) e.medicalConditions = "Each condition must be 100 characters or fewer";
  return e;
};

export const validateInsurancePolicy = (p = {}, { now = new Date() } = {}) => {
  const e = {};
  const provider = str(p.provider); if (provider.length < 2 || provider.length > 120) e.provider = "Provider must be 2-120 characters";
  const number = str(p.policyNumber); if (number.length < 3 || number.length > 120) e.policyNumber = "Policy number must be 3-120 characters";
  const holder = str(p.policyHolder); if (holder.length < 2 || holder.length > 100) e.policyHolder = "Policy holder must be 2-100 characters";
  const till = new Date(typeof p.validTill === "string" || p.validTill instanceof Date ? p.validTill : NaN);
  if (Number.isNaN(till.getTime())) e.validTill = "Enter the policy's end date";
  else {
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const limit = new Date(startOfToday); limit.setUTCFullYear(limit.getUTCFullYear() + 50);
    if (till < startOfToday) e.validTill = "This policy has already expired";
    else if (till > limit) e.validTill = "End date is too far in the future";
  }
  const cov = asMoneyString(p.coverageAmount);
  if (cov !== "" && (!MONEY.test(cov) || Number(cov) > 1_000_000_000)) e.coverageAmount = "Coverage must be a positive amount up to 1,000,000,000 with at most 2 decimals";
  return e;
};

export const CLAIM_IN_PROGRESS = ["submitted", "under_review", "in_review"];
export const validateClaim = (c = {}, { remainingAmount = 0 } = {}) => {
  const e = {};
  const amount = asMoneyString(c.claimAmount);
  if (amount === "") e.claimAmount = "Enter the claim amount";
  else if (!MONEY.test(amount) || Number(amount) <= 0) e.claimAmount = "Claim amount must be a positive number with at most 2 decimals";
  else if (Number(amount) > 1_000_000_000) e.claimAmount = "Claim amount is too large";
  else if (remainingAmount > 0 && Number(amount) > remainingAmount) e.claimAmount = `Claim cannot exceed the remaining coverage (${remainingAmount})`;
  if (c.claimNotes !== undefined && c.claimNotes !== null && (typeof c.claimNotes !== "string" || c.claimNotes.trim().length > 300)) e.claimNotes = "Notes must be 300 characters or fewer";
  return e;
};
