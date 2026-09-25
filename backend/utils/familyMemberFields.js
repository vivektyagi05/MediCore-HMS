// Explicit writable-field allowlist for FamilyMember.
//
// Family-member documents are medical data owned by ONE patient. Generic
// `create({...req.body})` / `findOneAndUpdate(filter, req.body)` let a client
// write any schema path: `userId` (transfer the record to another account, or
// plant one on somebody else's), `isActive` (resurrect a deactivated member,
// bypassing the deactivate endpoint), `_id`, `createdAt`, and so on.
// Ownership and lifecycle fields are therefore NEVER taken from the client;
// they are set by the server (userId from the session, isActive by the
// dedicated deactivate endpoint).

export const FAMILY_MEMBER_WRITABLE_FIELDS = Object.freeze([
  "name",
  "relation",
  "age",
  "gender",
  "bloodGroup",
  "medicalConditions",
  "emergencyContact",
]);

const EMERGENCY_CONTACT_FIELDS = Object.freeze(["name", "phone", "relation"]);

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeConditions = (value) => {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return list
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((item) => item.slice(0, 100));
};

/**
 * @param {unknown} body  untrusted request body
 * @returns {Record<string, unknown>} only allowlisted, shape-checked fields
 */
export function pickFamilyMemberFields(body) {
  const source = isPlainObject(body) ? body : {};
  const picked = {};

  for (const key of FAMILY_MEMBER_WRITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];

    if (key === "medicalConditions") {
      picked.medicalConditions = normalizeConditions(value);
    } else if (key === "emergencyContact") {
      if (!isPlainObject(value)) continue;
      const contact = {};
      for (const field of EMERGENCY_CONTACT_FIELDS) {
        if (typeof value[field] === "string") contact[field] = value[field];
      }
      picked.emergencyContact = contact;
    } else if (key === "age") {
      // Left as sent so the schema's own numeric validation (0-130) decides.
      picked.age = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    } else if (typeof value === "string") {
      picked[key] = value;
    } else if (value !== undefined && value !== null) {
      // Non-string for a string field: pass through so schema validation
      // rejects it, rather than silently coercing objects/arrays.
      picked[key] = value;
    }
  }
  return picked;
}
