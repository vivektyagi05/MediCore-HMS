// ─────────────────────────────────────────────────────────────────────────
// PHI/PII minimisation for EXTERNAL generative-AI calls.
//
// What this does (and does not) protect — stated precisely so nobody has to
// guess:
//
//  * Direct identifiers under known keys are handled before anything leaves
//    the server:
//      - contact / government / financial identifiers (email, phone,
//        address, date of birth, Aadhaar/insurance/policy/licence numbers,
//        file paths, ObjectId-style *Id keys) are REMOVED entirely;
//      - person names (patientName, doctorName, name, ...) are replaced with
//        stable tokens ([NAME_1], [NAME_2]) and swapped back into the model's
//        answer locally, so drafts still read naturally but the provider
//        never receives the real name.
//
//  * It does NOT scrub free-text clinical content (doctor notes, symptoms
//    text, report notes). Those fields are the *purpose* of a clinical-brief
//    call and cannot be de-identified by key matching. They are only sent
//    after the calling code has already authorised the caller against the
//    patient (see services/clinicalAccessService.js), and the data flow is
//    documented in docs/AI-ARCHITECTURE.md.
// ─────────────────────────────────────────────────────────────────────────

const NAME_KEY = /^(name|fullName|patientName|doctorName|memberName|userName|contactName|reviewerName|authorName)$/i;

const DROP_KEY = new RegExp(
  [
    "e-?mail",
    "phone",
    "mobile",
    "whatsapp",
    "address",
    "street",
    "pincode",
    "postal",
    "zip",
    "^dob$",
    "dateOfBirth",
    "aadhaar",
    "aadhar",
    "passport",
    "^pan(Number|Card)?$",
    "insurance(Number|Id)",
    "policy(Number|No)",
    "memberId",
    "licen[cs]e(Number|No)",
    "registrationNumber",
    "filePath",
    "fileUrl",
    "pdfPath",
    "password",
    "token",
    "secret",
    "signature",
  ].join("|"),
  "i",
);

// Identifier keys are matched case-SENSITIVELY on the camelCase suffix so that
// "patientId"/"_id" are dropped but ordinary words ending in "id" ("paid",
// "valid") are not.
const ID_KEY = /^(_id|id)$|[a-z0-9]Id$|_id$/;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

/**
 * @param {unknown} context structured, already-authorised platform data
 * @returns {{ sanitized: unknown, tokens: Map<string,string>, removedKeys: number }}
 */
export function minimizeForExternalAI(context) {
  const tokens = new Map(); // token -> original value
  const seen = new Map(); // original value -> token (stable per run)
  let removedKeys = 0;

  const tokenFor = (original) => {
    const trimmed = String(original).trim();
    if (!trimmed) return trimmed;
    if (seen.has(trimmed)) return seen.get(trimmed);
    const token = `[NAME_${seen.size + 1}]`;
    seen.set(trimmed, token);
    tokens.set(token, trimmed);
    return token;
  };

  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (value instanceof Date) return value.toISOString();
    if (isPlainObject(value)) {
      const out = {};
      for (const [key, nested] of Object.entries(value)) {
        if (NAME_KEY.test(key) && typeof nested === "string") {
          out[key] = tokenFor(nested);
        } else if (DROP_KEY.test(key) || ID_KEY.test(key)) {
          removedKeys += 1;
        } else {
          out[key] = walk(nested);
        }
      }
      return out;
    }
    return value;
  };

  return { sanitized: walk(context), tokens, removedKeys };
}

/** Swap name tokens in a model response back to the real values (locally). */
export function restoreTokens(value, tokens) {
  if (!tokens || tokens.size === 0) return value;
  const restoreString = (text) => {
    let result = text;
    for (const [token, original] of tokens) result = result.split(token).join(original);
    return result;
  };
  const walk = (node) => {
    if (typeof node === "string") return restoreString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (isPlainObject(node)) return Object.fromEntries(Object.entries(node).map(([key, nested]) => [key, walk(nested)]));
    return node;
  };
  return walk(value);
}
