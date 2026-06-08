import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { env } from "./config/env.js";
import appointmentRoutes from "./routes/appointmentRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import activityAdminRoutes from "./routes/admin/activityAdminRoutes.js";
import cmsAdminRoutes from "./routes/admin/cmsAdminRoutes.js";
import exportAdminRoutes from "./routes/admin/exportAdminRoutes.js";
import featureAdminRoutes from "./routes/admin/featureAdminRoutes.js";
import permissionAdminRoutes from "./routes/admin/permissionAdminRoutes.js";
import serviceAdminRoutes from "./routes/admin/serviceAdminRoutes.js";
import settingsAdminRoutes from "./routes/admin/settingsAdminRoutes.js";
import doctorRoutes from "./routes/doctorRoutes.js";
import doctorWorkflowRoutes from "./routes/doctor/workflowRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import patientWorkflowRoutes from "./routes/patient/workflowRoutes.js";
import refundRoutes from "./routes/refundRoutes.js";
import realtimeRoutes from "./routes/realtimeRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import { errorMiddleware, notFound } from "./middleware/errorMiddleware.js";
import { requestLogger } from "./utils/logger.js";
import { razorpayWebhookHandler } from "./payments/webhookHandler.js";
import userAdminRoutes from "./routes/admin/userAdminRoutes.js";
import doctorOnboardingRoutes from "./routes/doctor/onboardingRoutes.js";



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

const sanitizeRequest = (req, _res, next) => {
  req.body = sanitizeValue(req.body);
  req.params = sanitizeValue(req.params);
  next();
};

const apiLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
});

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  }),
);
app.post("/api/payments/webhooks/razorpay", express.raw({ type: "application/json" }), razorpayWebhookHandler);
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(sanitizeRequest);
app.use(requestLogger);
app.use("/api", apiLimiter);

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
app.use("/api/ai", aiRoutes);

app.use("/api/doctors", doctorRoutes);

app.use("/api/doctor", doctorWorkflowRoutes);
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
app.use("/api/admin/settings", settingsAdminRoutes);
app.use("/api/admin/permissions", permissionAdminRoutes);
app.use("/api/admin/cms", cmsAdminRoutes);
app.use("/api/admin/features", featureAdminRoutes);
app.use("/api/admin/activity", activityAdminRoutes);
app.use("/api/admin/exports", exportAdminRoutes);
app.use("/api/admin/users", userAdminRoutes);
export default app;
