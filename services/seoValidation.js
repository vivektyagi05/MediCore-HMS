const absoluteHttpUrl = (value) => {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const validateSeoMetadata = (metadata = {}) => {
  const errors = [];
  const warnings = [];

  if (!String(metadata.title || "").trim()) errors.push("missing title");
  if (Array.isArray(metadata.title)) errors.push("duplicate title");
  if (metadata.canonical !== undefined && metadata.canonical !== "" && !absoluteHttpUrl(metadata.canonical)) {
    errors.push("canonical must be absolute");
  }
  if (metadata.robots === "index,follow" && metadata.indexable === false) {
    errors.push("indexability contradiction");
  }
  if (metadata.robots?.startsWith("index") && metadata.canonical && !absoluteHttpUrl(metadata.canonical)) {
    errors.push("invalid canonical");
  }
  if (metadata.jsonLd !== undefined) {
    try {
      const parsed = typeof metadata.jsonLd === "string" ? JSON.parse(metadata.jsonLd) : metadata.jsonLd;
      if (!parsed || (typeof parsed !== "object" && !Array.isArray(parsed))) errors.push("malformed JSON-LD");
    } catch {
      errors.push("malformed JSON-LD");
    }
  }
  if (String(metadata.description || "").trim().length > 320) warnings.push("description exceeds recommended storage length");

  return { valid: errors.length === 0, errors, warnings };
};
