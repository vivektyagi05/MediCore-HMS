import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const requiredEnv = ["MONGO_URI", "JWT_SECRET"];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const isProduction = process.env.NODE_ENV === "production";

// SECURITY: production must not silently fall back to defaults meant for
// local development (a localhost CORS origin, unset payment-gateway
// secrets, a weak/placeholder JWT secret). Fail fast at boot instead of
// shipping a misconfigured deployment.
if (isProduction) {
  const requiredInProduction = [
    "CORS_ORIGIN",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
  ];
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required production environment variable(s): ${missing.join(", ")}`);
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 100),
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 12),
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
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
