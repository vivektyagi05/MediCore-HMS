import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { validateProductionConfig, validateCommonConfig, resolveAiProviderKey } from "../config/productionGuards.js";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const validProd = () => ({
  NODE_ENV: "production",
  MONGO_URI: "mongodb+srv://u:p@cluster0.example.mongodb.net/hms",
  JWT_SECRET: "k9Zt4Qm7Xa2Lw8Ve5Rb1Ny6Hc3Jd0FgS",
  CORS_ORIGIN: "https://app.medicore.example",
  FRONTEND_URL: "https://app.medicore.example",
  RAZORPAY_KEY_ID: "rzp_live_abc123",
  RAZORPAY_KEY_SECRET: "live_secret_value",
  RAZORPAY_WEBHOOK_SECRET: "whsec_value",
  BREVO_API_KEY: "xkeysib-abc",
  BREVO_SENDER_EMAIL: "no-reply@medicore.example",
  AI_TEXT_PROVIDER: "gemini",
  GEMINI_API_KEY: "AIza-test",
  GEMINI_MODEL: "gemini-2.5-flash",
  STORAGE_DRIVER: "s3",
  STORAGE_S3_BUCKET: "medicore-prod",
  STORAGE_S3_REGION: "ap-south-1",
});

assert.deepStrictEqual(validateProductionConfig(validProd()), [], "a fully specified production env must have zero violations");
console.log("PASS: valid production configuration is accepted");

const violates = (mutate, fragment) => {
  const env = validProd();
  mutate(env);
  const problems = validateProductionConfig(env);
  assert.ok(problems.some((p) => p.includes(fragment)), `expected a violation mentioning "${fragment}", got: ${JSON.stringify(problems)}`);
};

// ── Financial safety ────────────────────────────────────────────────────
violates((e) => { e.PAYMENT_GATEWAY_MODE = "test"; }, "PAYMENT_GATEWAY_MODE");
violates((e) => { e.PAYMENT_GATEWAY_MODE = "TEST"; }, "PAYMENT_GATEWAY_MODE");
violates((e) => { e.RAZORPAY_KEY_ID = "rzp_test_abc"; }, "TEST-mode key");
violates((e) => { e.TEST_PAYMENT_GATEWAY_SECRET = "x"; }, "TEST_PAYMENT_GATEWAY_SECRET");
{
  const staging = validProd();
  staging.RAZORPAY_KEY_ID = "rzp_test_abc";
  staging.RAZORPAY_ALLOW_TEST_KEYS = "true";
  assert.deepStrictEqual(validateProductionConfig(staging), [], "explicit staging override for sandbox keys must be honoured");
}
violates((e) => { delete e.RAZORPAY_WEBHOOK_SECRET; }, "RAZORPAY_WEBHOOK_SECRET");
console.log("PASS: production cannot select the test gateway or accept sandbox keys silently");

// ── Secrets / origins ───────────────────────────────────────────────────
violates((e) => { e.JWT_SECRET = "short"; }, "at least 32");
violates((e) => { e.JWT_SECRET = "changeme-changeme-changeme-changeme-x"; }, "placeholder");
violates((e) => { e.CORS_ORIGIN = "http://localhost:5173"; }, "localhost");
violates((e) => { e.MONGO_URI = "mongodb://127.0.0.1:27017/hms"; }, "localhost");
console.log("PASS: weak secrets and localhost origins are rejected");

// ── AI ──────────────────────────────────────────────────────────────────
violates((e) => { e.AI_TEXT_PROVIDER = "template"; }, "not allowed in production");
violates((e) => { e.AI_TEXT_PROVIDER = "openai"; }, "not allowed in production");
violates((e) => { delete e.GEMINI_API_KEY; }, "GEMINI_API_KEY");
violates((e) => { delete e.GEMINI_MODEL; }, "GEMINI_MODEL");
{
  const env = validProd();
  delete env.AI_TEXT_PROVIDER;
  assert.strictEqual(resolveAiProviderKey(env), "gemini", "production defaults to gemini, never to template");
}
assert.strictEqual(resolveAiProviderKey({ NODE_ENV: "development" }), "template");
console.log("PASS: production requires the real Gemini provider; template/openai are rejected");

// ── Storage ─────────────────────────────────────────────────────────────
violates((e) => { delete e.STORAGE_S3_BUCKET; }, "STORAGE_S3_BUCKET");
violates((e) => { e.STORAGE_DRIVER = "local"; }, "STORAGE_LOCAL_ROOT");
violates((e) => { e.STORAGE_DRIVER = "local"; e.STORAGE_LOCAL_ROOT = "storage"; }, "absolute");
violates((e) => { e.STORAGE_DRIVER = "local"; e.STORAGE_LOCAL_ROOT = "/var/data"; }, "STORAGE_LOCAL_PERSISTENT");
violates((e) => { e.STORAGE_DRIVER = "ftp"; }, "not a supported driver");
{
  const env = validProd();
  env.STORAGE_DRIVER = "local";
  env.STORAGE_LOCAL_ROOT = "/var/data/medicore";
  env.STORAGE_LOCAL_PERSISTENT = "true";
  assert.deepStrictEqual(validateProductionConfig(env), [], "a mounted persistent disk is a legitimate production storage choice");
}
console.log("PASS: ephemeral container storage cannot be used in production by accident");

// ── All violations reported at once ─────────────────────────────────────
{
  const problems = validateProductionConfig({ NODE_ENV: "production" });
  assert.ok(problems.length >= 8, "an empty production env must report every missing item in one pass");
}
console.log("PASS: every violation is reported in a single pass");

// ── Non-production sanity ───────────────────────────────────────────────
assert.deepStrictEqual(validateCommonConfig({ NODE_ENV: "development" }), []);
assert.ok(validateCommonConfig({ PAYMENT_GATEWAY_MODE: "bogus" }).length === 1);
assert.ok(validateCommonConfig({ AI_TEXT_PROVIDER: "gemini" }).some((p) => p.includes("GEMINI_API_KEY")));
console.log("PASS: dev/test config still fails fast on unrecognised values");

// ── REAL boot proof: import the actual env module in a child process ────
const boot = (extraEnv) =>
  spawnSync(process.execPath, ["--input-type=module", "-e", 'await import("./config/env.js"); console.log("BOOT_OK");'], {
    cwd: backendDir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...extraEnv },
  });

const badBoot = boot({ ...validProd(), PAYMENT_GATEWAY_MODE: "test" });
assert.notStrictEqual(badBoot.status, 0, "production boot with PAYMENT_GATEWAY_MODE=test must fail");
assert.ok(/PAYMENT_GATEWAY_MODE/.test(badBoot.stderr), "the failure must name the offending setting");
console.log("PASS: real config/env.js import FAILS in production with PAYMENT_GATEWAY_MODE=test");

const templateBoot = boot({ ...validProd(), AI_TEXT_PROVIDER: "template" });
assert.notStrictEqual(templateBoot.status, 0, "production boot with template AI must fail");
console.log("PASS: real config/env.js import FAILS in production with AI_TEXT_PROVIDER=template");

const goodBoot = boot(validProd());
assert.strictEqual(goodBoot.status, 0, `valid production env must boot: ${goodBoot.stderr}`);
assert.ok(goodBoot.stdout.includes("BOOT_OK"));
console.log("PASS: real config/env.js import succeeds with a valid production configuration");

// paymentGateway must refuse the test adapter under production even if env guard were bypassed.
const gatewayProbe = spawnSync(
  process.execPath,
  ["--input-type=module", "-e", `
    process.env.NODE_ENV="production";
    process.env.PAYMENT_GATEWAY_MODE="test";
    const { paymentGateway } = await import("./payments/paymentGateway.js");
    try { paymentGateway.mode(); console.log("SELECTED"); } catch (e) { console.log("REFUSED:" + e.message); }
  `],
  { cwd: backendDir, encoding: "utf8", env: { PATH: process.env.PATH, MONGO_URI: "mongodb://x/y", JWT_SECRET: "x".repeat(40) } },
);
// env.js is not imported by paymentGateway.js, so this exercises the second layer in isolation.
assert.ok(/REFUSED/.test(gatewayProbe.stdout) || gatewayProbe.status !== 0, `paymentGateway must not select the test adapter in production: ${gatewayProbe.stdout}${gatewayProbe.stderr}`);
assert.ok(!/SELECTED/.test(gatewayProbe.stdout));
console.log("PASS: paymentGateway independently refuses the test adapter in a production process");
