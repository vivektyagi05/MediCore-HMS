import { appointmentReminder } from "./appointmentReminder.js";
import { paymentReminder } from "./paymentReminder.js";
import { followUpReminder } from "./followUpReminder.js";
import { aiInsights } from "../ai/aiInsights.js";
import { logger } from "../utils/logger.js";

export const automationCronJobs = {
  async runAll() {
    const [appointments, payments, followUps, insights] = await Promise.all([
      appointmentReminder.run(),
      paymentReminder.run(),
      followUpReminder.run(),
      aiInsights.generateAdminInsights(),
    ]);

    const summary = {
      appointmentReminders: appointments.length,
      paymentReminders: payments.length,
      followUpReminders: followUps.length,
      insights: insights.length,
    };
    logger.info("AI automation cron completed", summary);
    return summary;
  },
};
