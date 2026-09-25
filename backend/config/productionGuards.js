// ─────────────────────────────────────────────────────────────────────────
// Production configuration guards.
//
// This module is deliberately PURE: it takes a plain environment object and
// returns a list of violations. config/env.js calls it at boot and throws if
// the list is non-empty, and tests call it directly with hand-built
// environments (no process.env mutation, no module-cache tricks).
//
// Design rule: in production NOTHING may silently degrade to a development
// convenience. Every "would have used a fake/dev value" case is a boot
// failure, reported all at once so an operator fixes the deployment in one
// pass instead of discovering problems one restart at a time.
// ─────────────────────────────────────────────────────────────────────────

export const PAYMENT_GATEWAY_MODES = Object.freeze({
  RAZORPAY: "razorpay",
  TEST: "test",
});

export const AI_PROVIDER_KEYS = Object.freeze({
  GEMINI: "gemini",
  TEMPLATE: "template",
});

export const STORAGE_DRIVERS = Object.freeze({
  LOCAL: "local",
  S3: "s3",
});

const PLACEHOLDER_SECRETS = [
  "changeme",
  "change_me",
  "secret",
  "test_secret",
  "your_secret",
  "jwt_secret",
  "password",
  "example",
];

const LOCAL_HOST_PATTERN = /(^|[/@.])(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$)/i;

const truthy = (value) => ["1", "true", "yes"].includes(String(value ?? "").trim().toLowerCase());

/** Which payment gateway a given environment selects. Unset means Razorpay. */
export function resolvePaymentGatewayMode(source = process.env) {
  const raw = String(source.PAYMENT_GATEWAY_MODE || "").trim().toLowerCase();
  return raw || PAYMENT_GATEWAY_MODES.RAZORPAY;
}

/** Which text-generation provider a given environment selects. */
export function resolveAiProviderKey(source = process.env) {
  const raw = String(source.AI_TEXT_PROVIDER || "").trim().toLowerCase();
  if (raw) return raw;
  return String(source.NODE_ENV || "").trim().toLowerCase() === "production"
    ? AI_PROVIDER_KEYS.GEMINI
    : AI_PROVIDER_KEYS.TEMPLATE;
}

/** Which storage driver a given environment selects. */
export function resolveStorageDriver(source = process.env) {
  const raw = String(source.STORAGE_DRIVER || "").trim().toLowerCase();
  return raw || STORAGE_DRIVERS.LOCAL;
}

/**
 * @param {Record<string, string|undefined>} source  environment to validate
 * @returns {string[]} human-readable violations (empty means valid)
 */
export function validateProductionConfig(source = process.env) {
  const problems = [];
  const need = (key, why) => {
    if (!String(source[key] ?? "").trim()) problems.push(`${key} is required in production${why ? ` (${why})` : ""}`);
  };

  // ── Core secrets / origins ────────────────────────────────────────────
  need("MONGO_URI");
  need("JWT_SECRET");
  need("CORS_ORIGIN");
  need("FRONTEND_URL", "used in email links and SEO output");

  const jwt = String(source.JWT_SECRET || "");
  if (jwt && jwt.length < 32) problems.push("JWT_SECRET must be at least 32 characters in production");
  if (jwt && PLACEHOLDER_SECRETS.some((word) => jwt.toLowerCase().includes(word))) {
    problems.push("JWT_SECRET looks like a placeholder value; generate a random secret");
  }

  for (const key of ["MONGO_URI", "CORS_ORIGIN", "FRONTEND_URL", "SEO_SITE_URL"]) {
    const value = String(source[key] || "");
    if (value && LOCAL_HOST_PATTERN.test(value)) {
      problems.push(`${key} points at localhost, which is not valid in production`);
    }
  }

  // ── Payments ──────────────────────────────────────────────────────────
  const gatewayMode = resolvePaymentGatewayMode(source);
  if (gatewayMode !== PAYMENT_GATEWAY_MODES.RAZORPAY) {
    problems.push(
      `PAYMENT_GATEWAY_MODE="${gatewayMode}" is not allowed in production; the in-memory test gateway can fabricate captures and refunds. Use "razorpay".`,
    );
  }
  need("RAZORPAY_KEY_ID");
  need("RAZORPAY_KEY_SECRET");
  need("RAZORPAY_WEBHOOK_SECRET");
  if (String(source.RAZORPAY_KEY_ID || "").startsWith("rzp_test_") && !truthy(source.RAZORPAY_ALLOW_TEST_KEYS)) {
    problems.push(
      "RAZORPAY_KEY_ID is a Razorpay TEST-mode key. Use live keys in production, or set RAZORPAY_ALLOW_TEST_KEYS=true to explicitly accept sandbox money on a staging deployment.",
    );
  }
  if (String(source.TEST_PAYMENT_GATEWAY_SECRET || "").trim()) {
    problems.push("TEST_PAYMENT_GATEWAY_SECRET must not be set in production");
  }

  // ── Email ─────────────────────────────────────────────────────────────
  need("BREVO_API_KEY");
  need("BREVO_SENDER_EMAIL");

  // ── AI ────────────────────────────────────────────────────────────────
  const aiKey = resolveAiProviderKey(source);
  if (aiKey !== AI_PROVIDER_KEYS.GEMINI) {
    problems.push(
      `AI_TEXT_PROVIDER="${aiKey}" is not allowed in production; production must use the real "gemini" provider (template output is development/test only).`,
    );
  } else {
    need("GEMINI_API_KEY");
    need("GEMINI_MODEL", "pin the model explicitly so behaviour does not change under you");
  }

  // ── Storage ───────────────────────────────────────────────────────────
  const storageDriver = resolveStorageDriver(source);
  if (storageDriver === STORAGE_DRIVERS.S3) {
    need("STORAGE_S3_BUCKET");
    need("STORAGE_S3_REGION");
    const hasKey = String(source.STORAGE_S3_ACCESS_KEY_ID || "").trim();
    const hasSecret = String(source.STORAGE_S3_SECRET_ACCESS_KEY || "").trim();
    if (Boolean(hasKey) !== Boolean(hasSecret)) {
      problems.push("STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY must be set together (or both omitted to use the platform's IAM role)");
    }
  } else if (storageDriver === STORAGE_DRIVERS.LOCAL) {
    // Local disk is only safe when it is a persistent volume. A container's
    // own filesystem is wiped on every deploy/restart, which would orphan
    // every DB reference to an uploaded document.
    const root = String(source.STORAGE_LOCAL_ROOT || "").trim();
    if (!root) {
      problems.push("STORAGE_LOCAL_ROOT is required when STORAGE_DRIVER=local in production (absolute path of a mounted persistent volume)");
    } else if (!/^([a-zA-Z]:[\\/]|\/)/.test(root)) {
      problems.push("STORAGE_LOCAL_ROOT must be an absolute path in production");
    }
    if (!truthy(source.STORAGE_LOCAL_PERSISTENT)) {
      problems.push(
        "STORAGE_DRIVER=local in production requires STORAGE_LOCAL_PERSISTENT=true to confirm STORAGE_LOCAL_ROOT is a persistent disk; otherwise use STORAGE_DRIVER=s3",
      );
    }
  } else {
    problems.push(`STORAGE_DRIVER="${storageDriver}" is not a supported driver (use "s3" or "local")`);
  }

  return problems;
}

/** Throws one error listing every production violation. */
export function assertProductionConfig(source = process.env) {
  const problems = validateProductionConfig(source);
  if (problems.length) {
    const error = new Error(
      `Invalid production configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    error.problems = problems;
    throw error;
  }
}

/** Non-production sanity checks that are still worth failing fast on. */
export function validateCommonConfig(source = process.env) {
  const problems = [];
  const gatewayMode = resolvePaymentGatewayMode(source);
  if (!Object.values(PAYMENT_GATEWAY_MODES).includes(gatewayMode)) {
    problems.push(`PAYMENT_GATEWAY_MODE="${gatewayMode}" is not recognised (use "razorpay" or "test")`);
  }
  const aiKey = resolveAiProviderKey(source);
  if (!Object.values(AI_PROVIDER_KEYS).includes(aiKey)) {
    problems.push(`AI_TEXT_PROVIDER="${aiKey}" is not recognised (use "gemini" or "template")`);
  }
  if (aiKey === AI_PROVIDER_KEYS.GEMINI && !String(source.GEMINI_API_KEY || "").trim()) {
    problems.push("AI_TEXT_PROVIDER=gemini requires GEMINI_API_KEY");
  }
  return problems;
}
