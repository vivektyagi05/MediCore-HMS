import en from "../src/i18n/locales/p13.en.js";
import hi from "../src/i18n/locales/p13.hi.js";
import hinglish from "../src/i18n/locales/p13.hinglish.js";

const flatten = (value, prefix = "", out = {}) => {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, path, out);
    else out[path] = child;
  }
  return out;
};

const locales = { en, hi, hinglish };
const flattened = Object.fromEntries(Object.entries(locales).map(([name, value]) => [name, flatten(value)]));
const baseKeys = Object.keys(flattened.en).sort();
const requiredKeys = [
  "home.availabilityAnswer",
  "home.journey.discover",
  "home.journey.discoverText",
  "home.trustCards.verifiedIdentity",
  "home.trustCards.boundedIntelligence",
  "services.count",
  "profile.online",
  "compare.specialization",
];

for (const [name, values] of Object.entries(flattened)) {
  const keys = Object.keys(values).sort();
  if (JSON.stringify(keys) !== JSON.stringify(baseKeys)) {
    const missing = baseKeys.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !baseKeys.includes(key));
    throw new Error(`${name}: key parity failed; missing=${missing.join(",")}; extra=${extra.join(",")}`);
  }
  for (const key of keys) {
    if (typeof values[key] !== "string" || !values[key].trim()) throw new Error(`${name}: invalid translation at ${key}`);
  }
}
for (const key of requiredKeys) if (!baseKeys.includes(key)) throw new Error(`Missing required P13 key: ${key}`);
console.log(`P13 locale validation PASS (${baseKeys.length} keys x 3 locales)`);
