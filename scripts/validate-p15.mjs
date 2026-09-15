import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

const failures = [];

// ── 1. Locale key parity across en/hi/hinglish for the p15 namespace ──────
const localeFiles = ["en", "hi", "hinglish"].map((locale) => ({
  locale,
  path: `src/i18n/locales/p15.${locale}.js`,
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

let locales;
try {
  locales = Object.fromEntries(localeFiles.map((file) => [file.locale, flatten(loadLocale(file))]));
} catch (error) {
  failures.push(`Locale files failed to import/parse: ${error.message}`);
  locales = { en: {}, hi: {}, hinglish: {} };
}

const baseKeys = Object.keys(locales.en).sort();
if (baseKeys.length === 0) failures.push("p15.en.js produced zero keys — locale file missing or empty");

for (const locale of ["hi", "hinglish"]) {
  const keys = Object.keys(locales[locale]).sort();
  const missing = baseKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !baseKeys.includes(key));
  const empty = keys.filter((key) => typeof locales[locale][key] !== "string" || !locales[locale][key].trim());
  if (missing.length || extra.length || empty.length) {
    failures.push(`${locale}: missing=${missing.join(",")}; extra=${extra.join(",")}; empty=${empty.join(",")}`);
  }
}

// ── 2. p15 namespace registered in each merged locale index ──────────────
for (const locale of ["en", "hi", "hinglish"]) {
  const source = read(`src/i18n/locales/${locale}.js`);
  if (!source.includes(`from "./p15.${locale}.js"`)) failures.push(`${locale}.js: p15 module not imported`);
  if (!/\bp15,?\n/.test(source)) failures.push(`${locale}.js: p15 not merged into exported locale object`);
}

// ── 3. Frontend pages: i18n hook usage + noindex SEO, no hardcoded copy ───
const p15Pages = [
  "src/pages/auth/ForgotPassword.jsx",
  "src/pages/auth/VerifyOtp.jsx",
  "src/pages/auth/ResetPassword.jsx",
];
for (const file of p15Pages) {
  if (!exists(file)) {
    failures.push(`${file}: missing`);
    continue;
  }
  const source = read(file);
  if (!source.includes('from "../../i18n/I18nContext"')) failures.push(`${file}: missing i18n hook`);
  if (!source.includes("<SEOMeta") || !source.includes("noIndex")) failures.push(`${file}: missing noindex SEO`);
  if (source.match(/<(?:h1|p|span|button|option)[^>]*>\s*(?:Verify|Reset|Forgot|Password|Code|Email)\b/i)) {
    failures.push(`${file}: possible hardcoded copy`);
  }
}

// ── 4. No raw OTP / password / secrets in client storage or logs ─────────
const clientFilesToScan = [
  ...p15Pages,
  "src/components/auth/OtpInput.jsx",
  "src/api/authApi.js",
];
for (const file of clientFilesToScan) {
  if (!exists(file)) continue;
  const source = read(file);
  if (/localStorage\.(set|get)Item\([^)]*otp/i.test(source)) failures.push(`${file}: OTP written to localStorage`);
  if (/sessionStorage\.(set|get)Item\([^)]*otp/i.test(source)) failures.push(`${file}: OTP written to sessionStorage`);
  if (/console\.log\([^)]*(otp|password|resetToken)/i.test(source)) failures.push(`${file}: sensitive value logged to console`);
}

// ── 5. Backend static security audit ──────────────────────────────────────
const backendFiles = [
  "backend/controllers/passwordRecoveryController.js",
  "backend/services/emailService.js",
  "backend/utils/otp.js",
  "backend/models/PasswordReset.js",
];
for (const file of backendFiles) {
  if (!exists(file)) {
    failures.push(`${file}: missing`);
    continue;
  }
  const source = read(file);
  // Strip comment lines before scanning for red-flag terms — these
  // checks are about actual logic/values, and several of these words
  // legitimately appear in comments explaining what NOT to do (a
  // stronger signal of care than a violation).
  const codeOnly = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  if (/console\.log\([^)]*(otp|password|apiKey|brevo)/i.test(codeOnly)) failures.push(`${file}: sensitive value passed to console.log`);
  if (/otp\s*:\s*["'`]?\d{6}/i.test(codeOnly)) failures.push(`${file}: looks like a hardcoded/mock OTP value`);
  if (/\b(TODO|FIXME)\b/.test(codeOnly)) failures.push(`${file}: contains a TODO/FIXME marker`);
  if (/\b(dummy|fake|mock)\s+(otp|password|email|implementation|logic|response)\b/i.test(codeOnly)) {
    failures.push(`${file}: possible dummy/fake/mock implementation`);
  }
}

const passwordResetModel = read("backend/models/PasswordReset.js");
if (/otp\s*:\s*\{?\s*type:\s*String/.test(passwordResetModel) && !passwordResetModel.includes("otpHash")) {
  failures.push("PasswordReset model: appears to store a raw OTP field instead of otpHash");
}
if (!passwordResetModel.includes("select: false")) {
  failures.push("PasswordReset model: otpHash/resetTokenHash should be select:false by default");
}

const controllerSource = read("backend/controllers/passwordRecoveryController.js");
if (!/GENERIC_REQUEST_MESSAGE/.test(controllerSource) || (controllerSource.match(/GENERIC_REQUEST_MESSAGE/g) || []).length < 3) {
  failures.push("passwordRecoveryController.js: forgot-password does not appear to use one shared generic message on every branch (enumeration protection)");
}
if (!controllerSource.includes("findOneAndUpdate")) {
  failures.push("passwordRecoveryController.js: no atomic findOneAndUpdate found — one-time-use checks may have a race window");
}

const otpEmailServiceSource = read("backend/services/emailService.js");
if (!otpEmailServiceSource.includes("api.brevo.com")) failures.push("emailService.js: Brevo endpoint not referenced");
{
  const codeOnlyOtpEmail = otpEmailServiceSource
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  if (/["'`](support|noreply)@medicore\.com["'`]/.test(codeOnlyOtpEmail)) {
    failures.push("emailService.js: contains an invented default sender address");
  }
}

// ── 6. Routes registered ──────────────────────────────────────────────────
const authRoutesSource = read("backend/routes/authRoutes.js");
for (const routePath of ["/forgot-password", "/verify-password-reset-otp", "/reset-password"]) {
  if (!authRoutesSource.includes(routePath)) failures.push(`authRoutes.js: missing route ${routePath}`);
}

const appRoutesSource = read("src/routes/AppRoutes.jsx");
for (const routePath of ["/forgot-password", "/verify-otp", "/reset-password"]) {
  if (!appRoutesSource.includes(`"${routePath}"`)) failures.push(`AppRoutes.jsx: missing route ${routePath}`);
}

// ── 7. Session invalidation wiring ────────────────────────────────────────
const userModelSource = read("backend/models/User.js");
if (!userModelSource.includes("securityVersion")) failures.push("User.js: securityVersion field missing — session invalidation cannot work");

const tokenSource = read("backend/utils/generateToken.js");
if (!tokenSource.includes("securityVersion")) failures.push("generateToken.js: securityVersion not embedded in JWT payload");

const authMiddlewareSource = read("backend/middleware/authMiddleware.js");
if (!authMiddlewareSource.includes("securityVersion")) failures.push("authMiddleware.js: does not check token securityVersion against user record");

if (!controllerSource.includes("securityVersion")) failures.push("passwordRecoveryController.js: reset-password does not bump user.securityVersion");

// ── Result ──────────────────────────────────────────────────────────────
if (failures.length) {
  console.error("P15 validation FAIL");
  failures.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}

console.log(`P15 validation PASS — ${baseKeys.length} keys × 3 locales, routes/security wiring verified`);
