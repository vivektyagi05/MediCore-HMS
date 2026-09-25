import cors from "cors";
import path from "path";
import compression from "compression";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { env } from "./config/env.js";
import appointmentRoutes from "./routes/appointmentRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import aiAssistRoutes from "./routes/aiAssistRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import activityAdminRoutes from "./routes/admin/activityAdminRoutes.js";
import overviewAdminRoutes from "./routes/admin/overviewAdminRoutes.js";
import missionControlAdminRoutes from "./routes/admin/missionControlAdminRoutes.js";
import commandCenterAdminRoutes from "./routes/admin/commandCenterAdminRoutes.js";
import platformHealthAdminRoutes from "./routes/admin/platformHealthAdminRoutes.js";
import widgetsAdminRoutes from "./routes/admin/widgetsAdminRoutes.js";
import executiveActionRoutes from "./routes/admin/executiveActionRoutes.js";
import operationsAdminRoutes from "./routes/admin/operationsAdminRoutes.js";
import assignmentAdminRoutes from "./routes/admin/assignmentAdminRoutes.js";
import automationStudioRoutes from "./routes/admin/automationStudioRoutes.js";
import monitoringRoutes from "./routes/admin/monitoringRoutes.js";
import intelligenceRoutes from "./routes/admin/intelligenceRoutes.js";
import processAdminRoutes from "./routes/admin/processAdminRoutes.js";
import processDesignerRoutes from "./routes/admin/processDesignerRoutes.js";
import processAnalyticsRoutes from "./routes/admin/processAnalyticsRoutes.js";
import processGovernanceRoutes from "./routes/admin/processGovernanceRoutes.js";
import integrationHubRoutes from "./routes/admin/integrationHubRoutes.js";
import cmsAdminRoutes from "./routes/admin/cmsAdminRoutes.js";
import exportAdminRoutes from "./routes/admin/exportAdminRoutes.js";
import featureAdminRoutes from "./routes/admin/featureAdminRoutes.js";
import { buildRobotsTxt, buildSitemapXml, getSeoOrigin } from "./services/seoInfrastructureService.js";
import permissionAdminRoutes from "./routes/admin/permissionAdminRoutes.js";
import serviceAdminRoutes from "./routes/admin/serviceAdminRoutes.js";
import doctorAdminRoutes from "./routes/admin/doctorAdminRoutes.js";
import appointmentAdminRoutes from "./routes/admin/appointmentAdminRoutes.js";
import settingsAdminRoutes from "./routes/admin/settingsAdminRoutes.js";
import doctorRoutes from "./routes/doctorRoutes.js";
import doctorWorkflowRoutes from "./routes/doctor/workflowRoutes.js";
import doctorPracticeRoutes from "./routes/doctor/practiceRoutes.js";
import doctorCommandCenterRoutes from "./routes/doctor/commandCenterRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import patientWorkflowRoutes from "./routes/patient/workflowRoutes.js";
import refundRoutes from "./routes/refundRoutes.js";
import realtimeRoutes from "./routes/realtimeRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import { errorMiddleware, notFound } from "./middleware/errorMiddleware.js";
import { requestLogger } from "./utils/logger.js";
import { razorpayWebhookHandler } from "./payments/webhookHandler.js";
import userAdminRoutes from "./routes/admin/userAdminRoutes.js";
import patientAdminRoutes from "./routes/admin/patientAdminRoutes.js";
import paymentAdminRoutes from "./routes/admin/paymentAdminRoutes.js";
import refundAdminRoutes from "./routes/admin/refundAdminRoutes.js";
import financeAdminRoutes from "./routes/admin/financeAdminRoutes.js";
import withdrawalAdminRoutes from "./routes/admin/withdrawalAdminRoutes.js";
import doctorOnboardingRoutes from "./routes/doctor/onboardingRoutes.js";
import adminReviewRoutes
from "./routes/adminReviewRoutes.js";
import privacyRoutes from "./routes/privacyRoutes.js";
import leadRoutes from "./routes/leadRoutes.js";
import masterDataRoutes from "./routes/masterDataRoutes.js";


const sanitizeValue = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeValue);

  if (value && typeof value === "object") {
    return Object.entries(value).reduce((acc, [key, nestedValue]) => {
      if (!key.startsWith("$") && !key.includes(".")) {
        acc[key] = sanitizeValue(nestedValue);
      }

      return acc;
    }, {});
  }

  return value;
};

// PHASE 2-D — Section 1 bugfix (root cause of the reported 500 on
// PUT /api/doctors/:id/approve, doctorController.js "Cannot read
// properties of undefined (reading 'notes')"):
//
// express.json()/express.urlencoded() only populate req.body when the
// request actually carries a body-shaped Content-Type header. Any request
// that omits Content-Type entirely (a bare `fetch`/`curl`/`axios` call with
// no data and no explicit header, a proxy or client that strips it, an
// automated test hitting the route directly) reaches every controller
// with req.body left as `undefined`, not `{}`. Every controller in this
// codebase (approveDoctor's `req.body.notes`, rejectDoctor's
// `req.body.reason`, and dozens of others) was written assuming req.body
// is always an object -- a reasonable contract for an API, but one that
// was never actually enforced anywhere. This is the real, systemic
// contract mismatch: not a bug in approveDoctor specifically, but a
// missing invariant that every mutating controller silently depended on.
//
// Fixed once, here, at the single place that already normalizes
// req.body for every request (mass-assignment/NoSQL-operator
// sanitization), instead of scattering `req.body?.x` defensive checks
// across every controller that happens to read the body.
const sanitizeRequest = (req, _res, next) => {
  req.body = sanitizeValue(req.body ?? {});
  req.params = sanitizeValue(req.params);
  next();
};

// General API limiter. Auth and public discovery have their own policies so
// a burst of public page reads can never consume the auth/security bucket.
// /health is also excluded because platform health probes must remain
// available even when application traffic is throttled.
const apiLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) =>
    req.path === "/health" ||
    req.path.startsWith("/auth/") ||
    req.path.startsWith("/public/"),
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
});

// Public discovery gets a generous short-window limit. These endpoints are
// intentionally outside the general API bucket because the public homepage
// can legitimately make many reads during a single navigation.
const publicLimiter = rateLimit({
  windowMs: env.publicRateLimitWindowMs,
  limit: env.publicRateLimitMax,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many public requests, please try again later",
  },
});

// Strict limiter for auth endpoints (login, register, password reset).
// Forgot-password has its own, more suitable policy below so one user's
// recovery traffic does not consume the same 15-minute IP bucket as login
// and registration traffic.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => req.path === "/forgot-password",
  message: {
    success: false,
    message: "Too many authentication attempts, please try again in 15 minutes",
  },
});

// Password recovery gets a dedicated IP limiter instead of sharing the
// login/register bucket. This avoids a false 429 for users behind the same
// NAT/proxy while the account-keyed limiter in authRoutes still protects a
// single email address. The email-keyed limit remains the primary recovery
// protection; this IP limit is the second anti-abuse layer.
const forgotPasswordIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password recovery requests from this network. Please slow down.",
  },
});

// Relaxed limiter for real-time/polling endpoints (dashboard, notifications, stats)
const realtimeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  limit: 120, // 2 requests/sec — enough for polling dashboards
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please slow down",
  },
});

const app = express();

// See config/env.js: without this, req.ip is always the reverse proxy's
// IP in production, silently breaking per-client rate limiting and any
// IP-based audit logging.
app.set("trust proxy", env.trustProxy);

app.use(
  helmet({
    // This is a pure JSON API -- it never serves HTML/JS/CSS to a browser,
    // so the strictest possible CSP is safe and removes an entire class of
    // XSS/injection concerns that helmet's browser-oriented defaults don't
    // fully cover for an API-only origin.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  }),
);
app.use(compression());
// DOCKER-PATH FIX: these used to be served from process.cwd()-relative
// "storage/..." (/app/storage/* inside the built image) while the Docker
// volume that is meant to persist uploads across deploys is mounted at
// /app/backend/storage (see docker-compose.yml). env.storage.localRoot
// resolves to that same volume mount point (config/env.js), so every
// upload category is now served from -- and, via storage/storageService.js
// or localCategoryDir(), written to -- the SAME absolute root.
app.use("/uploads/doctor-profile", express.static(path.resolve(env.storage.localRoot, "doctor-profile"), { index: false, dotfiles: "deny", fallthrough: false }));
app.use("/uploads/cms", express.static(path.resolve(env.storage.localRoot, "cms"), { index: false, dotfiles: "deny", fallthrough: false }));
app.post("/api/payments/webhooks/razorpay", express.raw({ type: "application/json" }), razorpayWebhookHandler);
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(sanitizeRequest);
app.use(requestLogger);
app.use("/api", apiLimiter);

// Public and auth routes are excluded from the general bucket above and get
// their own purpose-specific policies.
app.use("/api/public", publicLimiter);
app.use("/api/auth/forgot-password", forgotPasswordIpLimiter);
app.use("/api/auth", authLimiter);

// Real-time/polling endpoints get a relaxed limiter
app.use("/api/realtime", realtimeLimiter);

app.get("/robots.txt", async (req, res) => {
  const origin = getSeoOrigin(req);
  res.set("Cache-Control", "no-cache, must-revalidate").type("text/plain").send(buildRobotsTxt(origin));
});

app.get("/sitemap.xml", async (req, res, next) => {
  try {
    const xml = await buildSitemapXml(req);
    if (!xml) return res.status(503).type("text/plain").send("Sitemap origin is not configured");
    return res.set("Cache-Control", "no-cache, must-revalidate").type("application/xml").send(xml);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      service: "hms-pro-backend",
      status: "healthy",
      uptime: process.uptime(),
    },
    message: "Health check passed",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/privacy", privacyRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/ai/assist", aiAssistRoutes);

app.use("/api/doctors", doctorRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/master-data", masterDataRoutes);

app.use("/api/doctor", doctorWorkflowRoutes);
app.use("/api/doctor", doctorPracticeRoutes);
app.use("/api/doctor", doctorCommandCenterRoutes);
app.use("/api/doctor", doctorOnboardingRoutes);

app.use("/api/appointments", appointmentRoutes);
app.use("/api/patient", patientWorkflowRoutes);

app.use("/api/payments", paymentRoutes);
app.use("/api/finance", financeRoutes);

app.use("/api/invoices", invoiceRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/refunds", refundRoutes);

app.use("/api/realtime", realtimeRoutes);

app.use("/api/admin/services", serviceAdminRoutes);
app.use("/api/admin/doctors", doctorAdminRoutes);
app.use("/api/admin/appointments", appointmentAdminRoutes);
app.use("/api/admin/settings", settingsAdminRoutes);
app.use("/api/admin/permissions", permissionAdminRoutes);
app.use("/api/admin/cms", cmsAdminRoutes);
app.use("/api/admin/features", featureAdminRoutes);
app.use("/api/admin/activity", activityAdminRoutes);
app.use("/api/admin/overview", overviewAdminRoutes);
app.use("/api/admin/mission-control", missionControlAdminRoutes);
app.use("/api/admin/command-center", commandCenterAdminRoutes);
app.use("/api/admin/platform-health", platformHealthAdminRoutes);
app.use("/api/admin/widgets", widgetsAdminRoutes);
app.use("/api/admin/executive-actions", executiveActionRoutes);
app.use("/api/admin/operations", operationsAdminRoutes);
app.use("/api/admin/assignment", assignmentAdminRoutes);
app.use("/api/admin/automation-studio", automationStudioRoutes);
app.use("/api/admin/monitoring", monitoringRoutes);
app.use("/api/admin/intelligence", intelligenceRoutes);
app.use("/api/admin/process", processAdminRoutes);
app.use("/api/admin/process-designer", processDesignerRoutes);
app.use("/api/admin/process-analytics", processAnalyticsRoutes);
app.use("/api/admin/process-governance", processGovernanceRoutes);
app.use("/api/admin/integrations", integrationHubRoutes);
app.use("/api/admin/exports", exportAdminRoutes);
app.use("/api/admin/users", userAdminRoutes);
app.use("/api/admin/patients", patientAdminRoutes);
app.use("/api/admin/payments", paymentAdminRoutes);
app.use("/api/admin/refunds", refundAdminRoutes);
app.use("/api/admin/finance", financeAdminRoutes);
app.use("/api/admin/withdrawals", withdrawalAdminRoutes);
app.use(
 "/api/admin/reviews",
 adminReviewRoutes
);

// BUGFIX: these were imported at the top of this file but never actually
// registered with the app. Every AppError thrown by every controller in the
// entire product (asyncHandler correctly forwards them via next(err)) was
// falling through to Express's own built-in default error handler instead —
// meaning every error response across the whole app was Express's generic
// HTML/plain-text output, not the { success:false, message, details } JSON
// contract every frontend error toast (getApiErrorMessage) depends on.
// These must be registered last, after every route.
app.use(notFound);
app.use(errorMiddleware);

export default app;
