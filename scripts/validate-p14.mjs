import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const localeFiles = ["en", "hi", "hinglish"].map((locale) => ({
  locale,
  path: `src/i18n/locales/p14.${locale}.js`,
}));

const loadLocale = (file) => {
  const source = read(file.path).replace(/^export default /, "module.exports = ");
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(source, sandbox, { filename: file.path });
  return sandbox.module.exports;
};

const flatten = (value, prefix = "") => {
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item)) Object.assign(out, flatten(item, full));
    else out[full] = item;
  }
  return out;
};

const locales = Object.fromEntries(localeFiles.map((file) => [file.locale, flatten(loadLocale(file))]));
const baseKeys = Object.keys(locales.en).sort();
const failures = [];

for (const locale of ["hi", "hinglish"]) {
  const keys = Object.keys(locales[locale]).sort();
  const missing = baseKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !baseKeys.includes(key));
  const empty = keys.filter((key) => typeof locales[locale][key] !== "string" || !locales[locale][key].trim());
  if (missing.length || extra.length || empty.length) failures.push(`${locale}: missing=${missing.join(",")}; extra=${extra.join(",")}; empty=${empty.join(",")}`);
}

const authFiles = ["src/pages/auth/Login.jsx", "src/pages/auth/Register.jsx"];
for (const file of authFiles) {
  const source = read(file);
  if (!source.includes('from "../../i18n/I18nContext"')) failures.push(`${file}: missing i18n hook`);
  if (!source.includes("<SEOMeta") || !source.includes("noIndex")) failures.push(`${file}: missing noindex SEO`);
  if (source.match(/<(?:h1|p|span|button|option)[^>]*>\s*(?:Welcome|Sign|Login|Create|Password|Email|Patient|Doctor|Role)\b/i)) {
    failures.push(`${file}: possible hardcoded auth copy`);
  }
}

const register = read("src/pages/auth/Register.jsx");
for (const privileged of ['value="admin"', 'value="super_admin"', 'value="receptionist"']) {
  if (register.includes(privileged)) failures.push(`Register exposes privileged role: ${privileged}`);
}

const validation = read("backend/validations/authValidation.js");
if (!validation.includes("PUBLIC_REGISTER_ROLES")) failures.push("Backend public registration whitelist missing");
for (const privileged of ["ROLES.ADMIN", "ROLES.SUPER_ADMIN", "ROLES.RECEPTIONIST"]) {
  if (validation.includes(`PUBLIC_REGISTER_ROLES = [${privileged}`)) failures.push(`Backend whitelist may expose ${privileged}`);
}

const booking = read("src/utils/bookingIntent.js");
if (!booking.includes('value.startsWith("//")') || !booking.includes('url.origin === window.location.origin')) {
  failures.push("Booking return-path open-redirect guards missing");
}

const authRefs = [
  "src/context/AuthContext.jsx",
  "src/api/authApi.js",
  "src/components/public/BookingAuthGate.jsx",
  "src/utils/bookingIntent.js",
];
for (const file of authRefs) {
  const source = read(file);
  if (/console\.log\([^)]*(?:token|password)/i.test(source)) failures.push(`${file}: sensitive auth logging detected`);
}

const forbidden = [
  // P15 was a "no leakage before it's built" guard while P15 didn't exist
  // yet. It is now a real, shipped phase (see
  // CHANGELOG-PHASE-P15-PASSWORD-RECOVERY-OTP-BREVO.md) — Login.jsx
  // legitimately links to /forgot-password now, so keeping this entry
  // would fail P14's own validator on intended P15 UI. Removed
  // deliberately, not silently; P15's own validator (validate-p15.mjs)
  // is what now guards P15's actual implementation.
  ["P17", /ContactInquiry|PublicInquiry|\/api\/public\/contact/i],
];
for (const [phase, pattern] of forbidden) {
  for (const file of ["src/pages/auth/Login.jsx", "src/pages/auth/Register.jsx"]) {
    if (pattern.test(read(file))) failures.push(`${file}: ${phase} leakage detected`);
  }
}

if (failures.length) {
  console.error("P14 validation FAIL");
  failures.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}

console.log(`P14 validation PASS — ${baseKeys.length} keys × 3 locales`);
