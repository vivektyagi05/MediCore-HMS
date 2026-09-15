import AIInsight from "../models/AIInsight.js";
import Appointment from "../models/Appointment.js";
import Payment from "../models/Payment.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";

const hourLabel = (hour) => `${String(hour).padStart(2, "0")}:00`;

export const aiInsights = {
  async generateAdminInsights() {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 60);

    const [appointments, payments] = await Promise.all([
      Appointment.find({ createdAt: { $gte: since } }).populate({ path: "doctorId", populate: { path: "userId", select: "name" } }).lean(),
      Payment.find({ createdAt: { $gte: since } }).lean(),
    ]);

    const insights = [];
    const hourCounts = appointments.reduce((acc, appointment) => {
      const hour = Number(appointment.timeSlot?.slice(0, 2));
      if (!Number.isNaN(hour)) acc.set(hour, (acc.get(hour) || 0) + 1);
      return acc;
    }, new Map());
    const peakHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    if (peakHour) {
      insights.push({
        scope: "admin",
        insightType: "appointment_peak",
        title: `Peak appointment demand around ${hourLabel(peakHour[0])}`,
        summary: `${peakHour[1]} bookings clustered near ${hourLabel(peakHour[0])} in the last 60 days.`,
        recommendation: "Add staff coverage and surface nearby low-traffic slots in the booking assistant.",
        severity: peakHour[1] > 20 ? "high" : "medium",
        confidence: 0.82,
        data: { peakHour: peakHour[0], count: peakHour[1] },
      });
    }

    const cancellationRate = appointments.length
      ? appointments.filter((appointment) => appointment.status === "cancelled").length / appointments.length
      : 0;
    if (cancellationRate > 0.15) {
      insights.push({
        scope: "admin",
        insightType: "cancellation_risk",
        title: "Cancellation trend needs review",
        summary: `${Math.round(cancellationRate * 100)}% of recent appointments were cancelled.`,
        recommendation: "Enable reminder nudges and check overloaded doctor calendars for conflict patterns.",
        severity: cancellationRate > 0.3 ? "high" : "medium",
        confidence: 0.76,
        data: { cancellationRate },
      });
    }

    const capturedRevenue = payments.filter((payment) => payment.status === "captured").reduce((sum, payment) => sum + Number(payment.totalAmount || 0), 0);
    insights.push({
      scope: "admin",
      insightType: "revenue_forecast",
      title: "Revenue baseline available",
      summary: `Captured revenue over the analysis window is INR ${capturedRevenue}.`,
      recommendation: "Compare this baseline against next-period predictions and refund risk signals.",
      severity: "low",
      confidence: 0.68,
      data: { capturedRevenue },
    });

    const saved = await AIInsight.insertMany(insights.map((insight) => ({ ...insight, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) })));
    await Promise.all(saved.map((insight) =>
      notificationEmitter.emitToAdmins({
        type: "dashboard_sync",
        title: insight.title,
        message: insight.summary,
        entityType: "ai_insight",
        entityId: insight._id,
        eventKey: `ai-insight:${insight._id}`,
        severity: insight.severity === "high" ? "warning" : "info",
      }),
    ));
    return saved;
  },

  async list({ scope, targetUserId, limit = 20 }) {
    const filter = { status: "active" };
    if (scope) filter.scope = scope;
    if (targetUserId) filter.targetUserId = targetUserId;
    return AIInsight.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  },
};
