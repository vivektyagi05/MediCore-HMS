import AIInsight from "../models/AIInsight.js";
import Doctor from "../models/Doctor.js";
import SymptomSession from "../models/SymptomSession.js";
import { ADMIN_ROLES, ROLES } from "../constants/roles.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { aiInsights } from "../ai/aiInsights.js";
import { aiScheduler } from "../ai/aiScheduler.js";
import { doctorRecommendation } from "../ai/doctorRecommendation.js";
import { predictiveAnalytics } from "../ai/predictiveAnalytics.js";
import { reminderEngine } from "../ai/reminderEngine.js";
import { symptomAnalyzer } from "../ai/symptomAnalyzer.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";

const normalizeSymptoms = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const analyzeSymptoms = asyncHandler(async (req, res) => {
  const symptoms = normalizeSymptoms(req.body.symptoms);
  const severity = req.body.severity;

  if (symptoms.length < 1) throw new AppError("At least one symptom is required", 400);
  if (!["mild", "moderate", "severe"].includes(severity)) {
    throw new AppError("Severity must be mild, moderate, or severe", 400);
  }
  if (req.body.disclaimerAccepted !== true) {
    throw new AppError("Medical disclaimer must be accepted before using symptom suggestions", 400);
  }

  const analysis = symptomAnalyzer.analyze({
    symptoms,
    duration: req.body.duration || "Not specified",
    severity,
  });

  const session = await SymptomSession.create({
    userId: req.user._id,
    ...analysis,
    disclaimerAccepted: true,
    metadata: { source: "patient_ai_symptom_checker" },
  });

  const recommendations = await doctorRecommendation.recommend({
    patientId: req.user._id,
    symptoms: analysis.symptoms,
    departments: analysis.suggestedDepartments,
    date: req.body.preferredDate,
    timeSlot: req.body.timeSlot,
  });

  res.status(200).json({
    success: true,
    data: { session, analysis, recommendations },
    message: "Symptom suggestions generated safely",
  });
});

export const recommendDoctors = asyncHandler(async (req, res) => {
  const departments = normalizeSymptoms(req.query.departments || req.body.departments);
  const symptoms = normalizeSymptoms(req.query.symptoms || req.body.symptoms);

  const recommendations = await doctorRecommendation.recommend({
    patientId: req.user._id,
    symptoms,
    departments,
    date: req.query.date || req.body.date,
    timeSlot: req.query.timeSlot || req.body.timeSlot,
    limit: Number(req.query.limit || req.body.limit || 8),
  });

  res.status(200).json({
    success: true,
    data: { recommendations },
    message: "Doctor recommendations generated successfully",
  });
});

export const suggestAppointmentSlots = asyncHandler(async (req, res) => {
  if (!req.query.doctorId && !req.body.doctorId) throw new AppError("Doctor id is required", 400);

  const suggestions = await aiScheduler.suggestSlots({
    doctorId: req.query.doctorId || req.body.doctorId,
    patientId: req.user.role === ROLES.PATIENT ? req.user._id : req.body.patientId,
    limit: Number(req.query.limit || req.body.limit || 6),
  });

  res.status(200).json({
    success: true,
    data: { suggestions },
    message: "Smart slot suggestions generated successfully",
  });
});

export const getAdminInsights = asyncHandler(async (req, res) => {
  const shouldGenerate = req.query.generate === "true";
  if (shouldGenerate) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const existingToday = await AIInsight.countDocuments({
      scope: "admin",
      status: "active",
      createdAt: { $gte: startOfDay },
    });
    if (!existingToday) await aiInsights.generateAdminInsights();
  }

  const insights = await aiInsights.list({ scope: "admin", limit: Number(req.query.limit || 20) });

  res.status(200).json({
    success: true,
    data: { insights },
    message: "AI insights fetched successfully",
  });
});

export const generateAdminInsights = asyncHandler(async (_req, res) => {
  const insights = await aiInsights.generateAdminInsights();

  res.status(201).json({
    success: true,
    data: { insights },
    message: "AI insights generated successfully",
  });
});

export const getPredictiveDashboard = asyncHandler(async (_req, res) => {
  const forecast = await predictiveAnalytics.forecast();

  res.status(200).json({
    success: true,
    data: { forecast },
    message: "Predictive analytics generated successfully",
  });
});

export const getScheduleOptimization = asyncHandler(async (_req, res) => {
  const suggestions = await aiScheduler.optimizeSchedules();

  const highPriority = suggestions.filter((item) => item.status === "overloaded");
  await Promise.all(highPriority.map((item) =>
    AIInsight.create({
      scope: "admin",
      insightType: "doctor_overload",
      title: `${item.doctorName} schedule overload detected`,
      summary: `${item.doctorName} has ${item.load} upcoming appointments.`,
      recommendation: item.recommendation,
      severity: "high",
      confidence: 0.74,
      data: item,
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    }),
  ));

  if (highPriority.length) {
    await notificationEmitter.emitToAdmins({
      type: "dashboard_sync",
      title: "AI schedule overload alert",
      message: `${highPriority.length} doctor schedule(s) need balancing.`,
      entityType: "ai_insight",
      severity: "warning",
      eventKey: `ai-schedule-overload:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  res.status(200).json({
    success: true,
    data: { suggestions },
    message: "Schedule optimization suggestions generated successfully",
  });
});

export const runAutomation = asyncHandler(async (_req, res) => {
  const summary = await reminderEngine.runAll();

  res.status(200).json({
    success: true,
    data: { summary },
    message: "Automation engine completed successfully",
  });
});

export const getReminderHistory = asyncHandler(async (req, res) => {
  const userId = ADMIN_ROLES.includes(req.user.role) ? req.query.userId : req.user._id;
  const reminders = await reminderEngine.history({ userId, limit: Number(req.query.limit || 50) });

  res.status(200).json({
    success: true,
    data: { reminders },
    message: "Reminder history fetched successfully",
  });
});

export const smartSearch = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2) throw new AppError("Search query must be at least 2 characters", 400);

  const doctors = await Doctor.find({
    $or: [
      { specialization: new RegExp(query, "i") },
    ],
  })
    .populate("userId", "name email")
    .sort({ rating: -1 })
    .limit(10)
    .lean();

  res.status(200).json({
    success: true,
    data: {
      doctors,
      suggestions: doctors.map((doctor) => ({
        type: "doctor",
        label: `Dr. ${doctor.userId?.name || "Doctor"} - ${doctor.specialization}`,
        value: doctor._id,
      })),
    },
    message: "Smart search suggestions fetched successfully",
  });
});

export const chatbotReply = asyncHandler(async (req, res) => {
  const message = String(req.body.message || "").trim();
  if (!message) throw new AppError("Message is required", 400);
  if (message.length > 1000) throw new AppError("Message is too long", 400);

  const lower = message.toLowerCase();
  let reply =
    "I can help with booking guidance, payments, prescriptions, records, and support routing. I do not provide diagnosis.";

  if (lower.includes("book") || lower.includes("appointment")) {
    reply = "To book an appointment, open Patient Dashboard, choose a doctor, date, and available slot. I can also suggest smart slots from the AI Assistant.";
  } else if (lower.includes("payment") || lower.includes("invoice")) {
    reply = "Payments are handled securely through Razorpay. After successful payment, HMS generates an invoice and receipt automatically.";
  } else if (lower.includes("symptom") || lower.includes("pain") || lower.includes("fever")) {
    reply = "Use the Symptom Checker for department suggestions. It is not a diagnosis and urgent symptoms should be reviewed by emergency care.";
  } else if (lower.includes("refund")) {
    reply = "Refund requests can be submitted for eligible payments. Admin approval is required before processing.";
  }

  const insight = await AIInsight.create({
    scope: req.user.role === ROLES.PATIENT ? "patient" : "system",
    targetUserId: req.user._id,
    insightType: "chatbot",
    title: "Chatbot interaction",
    summary: message.slice(0, 180),
    recommendation: reply,
    confidence: 0.65,
    severity: "low",
    data: { channel: "ai_chatbot" },
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  res.status(200).json({
    success: true,
    data: {
      reply,
      insightId: insight._id,
      safetyNotice: "HMS AI is informational only and does not replace professional medical advice.",
    },
    message: "AI chatbot response generated successfully",
  });
});
