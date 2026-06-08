import Appointment from "../models/Appointment.js";
import Payment from "../models/Payment.js";

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

export const predictiveAnalytics = {
  async forecast() {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 90);

    const [appointments, payments] = await Promise.all([
      Appointment.find({ createdAt: { $gte: since } }).lean(),
      Payment.find({ createdAt: { $gte: since } }).lean(),
    ]);

    const appointmentByDay = appointments.reduce((acc, item) => {
      const key = dayKey(item.date);
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map());
    const avgAppointments = appointmentByDay.size
      ? [...appointmentByDay.values()].reduce((sum, count) => sum + count, 0) / appointmentByDay.size
      : 0;

    const capturedPayments = payments.filter((payment) => payment.status === "captured");
    const revenue = capturedPayments.reduce((sum, payment) => sum + Number(payment.totalAmount || 0), 0);
    const avgRevenue = capturedPayments.length ? revenue / Math.max(appointmentByDay.size, 1) : 0;
    const refundRatio = payments.length
      ? payments.filter((payment) => ["refunded", "partially_refunded"].includes(payment.status)).length / payments.length
      : 0;

    return {
      expectedDailyAppointments: Number(avgAppointments.toFixed(1)),
      expectedWeeklyAppointments: Math.round(avgAppointments * 7),
      expectedDailyRevenue: Number(avgRevenue.toFixed(2)),
      expectedWeeklyRevenue: Number((avgRevenue * 7).toFixed(2)),
      refundRisk: refundRatio > 0.12 ? "elevated" : "normal",
      busyDayPrediction: [...appointmentByDay.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      confidence: appointments.length > 20 ? 0.78 : 0.52,
    };
  },
};
