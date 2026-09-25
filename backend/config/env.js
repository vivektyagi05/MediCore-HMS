import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dotenv@17 prints unstructured "tip" lines to stdout by default (unrelated
// promotional/CLI hints, not from this application). Left unsilenced, these
// interleave with the app's structured JSON log lines on every boot, making
// production logs harder to parse mechanically. `quiet: true` disables only
// those tip lines; it does not affect .env loading behavior or error output.
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });
dotenv.config({ quiet: true });

import {
  assertProductionConfig,
  resolveAiProviderKey,
  resolvePaymentGatewayMode,
  resolveStorageDriver,
  validateCommonConfig,
} from "./productionGuards.js";

const requiredEnv = ["MONGO_URI", "JWT_SECRET"];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const isProduction = process.env.NODE_ENV === "production";

// SECURITY: production must not silently fall back to defaults meant for
// local development (a localhost CORS origin, the in-memory test payment
// gateway, template AI output, ephemeral container storage, a placeholder
// JWT secret). Every violation is collected and reported in ONE boot failure
// (see config/productionGuards.js, which is unit-tested with hand-built
// environments). Outside production only unrecognised values fail.
if (isProduction) {
  assertProductionConfig(process.env);
} else {
  const problems = validateCommonConfig(process.env);
  if (problems.length) {
    throw new Error(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  }
}

const positiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 2500),
  publicRateLimitWindowMs: Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  publicRateLimitMax: Number(process.env.PUBLIC_RATE_LIMIT_MAX || 180),
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 12),
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  // "razorpay" (real gateway) or "test" (in-memory gateway, never allowed in
  // production -- see productionGuards.js and payments/paymentGateway.js).
  paymentGatewayMode: resolvePaymentGatewayMode(process.env),
  // Generative AI. Native Google Gemini SDK; "template" is a deterministic
  // development/test renderer and is rejected at production boot.
  ai: {
    provider: resolveAiProviderKey(process.env),
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    // Development default only. Production must pin GEMINI_MODEL explicitly
    // (enforced in productionGuards.js).
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    timeoutMs: positiveInt(process.env.AI_TIMEOUT_MS, 30_000),
    healthCacheMs: positiveInt(process.env.AI_HEALTH_CACHE_MS, 60_000),
  },
  // Clinical relationship rules (see services/clinicalAccessService.js).
  clinical: {
    // After a consultation is completed, doctor and patient may keep chatting
    // about it for this many days (follow-up questions). Outside the window
    // chat closes until a new appointment is active.
    chatFollowUpWindowDays: positiveInt(process.env.CHAT_FOLLOWUP_WINDOW_DAYS, 30),
  },
  // Persistent file storage (see storage/storageService.js).
  storage: {
    driver: resolveStorageDriver(process.env),
    // Absolute root for the local driver. Defaults to <backend>/storage so
    // development keeps working; production must set it explicitly.
    localRoot: process.env.STORAGE_LOCAL_ROOT
      ? path.resolve(process.env.STORAGE_LOCAL_ROOT)
      : path.resolve(__dirname, "../storage"),
    s3: {
      bucket: process.env.STORAGE_S3_BUCKET || "",
      region: process.env.STORAGE_S3_REGION || "",
      endpoint: process.env.STORAGE_S3_ENDPOINT || "",
      accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY || "",
      forcePathStyle: ["1", "true", "yes"].includes(String(process.env.STORAGE_S3_FORCE_PATH_STYLE || "").toLowerCase()),
    },
  },
  hospital: {
    name: process.env.HOSPITAL_NAME || "HMS Pro Hospital",
    gstin: process.env.HOSPITAL_GSTIN || "UNREGISTERED",
    address: process.env.HOSPITAL_ADDRESS || "Hospital address not configured",
    email: process.env.HOSPITAL_EMAIL || "billing@hmspro.example",
    phone: process.env.HOSPITAL_PHONE || "",
  },
  invoiceStorageDir: process.env.INVOICE_STORAGE_DIR || "storage/invoices",
  paymentWindowMinutes: Number(process.env.PAYMENT_WINDOW_MINUTES || 30),
  // Phase P15 — Brevo transactional email, used exclusively for
  // password-recovery OTP delivery. Deliberately has NO fallback sender
  // (unlike smtp.from above): sending recovery email with an unconfigured/
  // unverified sender must fail loudly, not silently succeed with an
  // invented address. See services/emailService.js.
  brevo: {
    apiKey: process.env.BREVO_API_KEY || "",
    senderEmail: process.env.BREVO_SENDER_EMAIL || "",
    senderName: process.env.BREVO_SENDER_NAME || "MediCore",
    otpTemplateId: process.env.BREVO_OTP_TEMPLATE_ID || "",
  },
  frontendUrl: process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "http://localhost:5173",
  seoSiteUrl: process.env.SEO_SITE_URL || process.env.FRONTEND_URL || "",
  privacyContactEmail: process.env.PRIVACY_CONTACT_EMAIL || "",
  grievanceContactEmail: process.env.GRIEVANCE_CONTACT_EMAIL || "",
  legalContactEmail: process.env.LEGAL_CONTACT_EMAIL || "",
  isProduction,
  // SECURITY/CORRECTNESS: behind a reverse proxy or platform load balancer
  // (Render, Nginx, etc.), Express's req.ip is the proxy's IP for every
  // request unless trust proxy is configured -- which silently breaks
  // per-client rate limiting (all traffic is bucketed as one "client") and
  // makes IP-based audit logs meaningless. Default to trusting exactly one
  // hop (the platform's own edge proxy) in production; 0 (trust nothing)
  // in development. Override via TRUST_PROXY if the real deployment has a
  // different proxy chain depth.
  trustProxy: process.env.TRUST_PROXY !== undefined
    ? process.env.TRUST_PROXY
    : (isProduction ? 1 : 0),
});
