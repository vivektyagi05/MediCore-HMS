// Shared response-contract helpers for LLM-backed providers.
//
// The deterministic template renderer defines the exact JSON shape each
// prompt's consumer (frontend) expects. LLM providers use it ONLY as a
// schema example -- never as a fallback result. If the model cannot honour the
// shape the request fails; it never silently returns template text labelled
// as generative output.

export const shapeOf = (value) => {
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, shapeOf(nested)]));
  }
  if (value === null) return "null";
  return typeof value;
};

export const sameShape = (value, shape) => {
  if (shape === "null") return value === null;
  if (shape === "string" || shape === "number" || shape === "boolean") return typeof value === shape;
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return false;
    return shape.length === 0 || value.every((item) => sameShape(item, shape[0]));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const shapeKeys = Object.keys(shape).sort();
  const valueKeys = Object.keys(value).sort();
  if (shapeKeys.join("\u0000") !== valueKeys.join("\u0000")) return false;
  return shapeKeys.every((key) => sameShape(value[key], shape[key]));
};

// Models occasionally wrap JSON in a markdown fence even when asked not to.
export const parseJsonLoose = (text) => {
  const trimmed = String(text ?? "").trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(unfenced);
};
