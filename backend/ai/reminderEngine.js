import ReminderLog from "../models/ReminderLog.js";
import { automationCronJobs } from "../automation/cronJobs.js";

export const reminderEngine = {
  runAll() {
    return automationCronJobs.runAll();
  },

  async history({ userId, limit = 50 }) {
    const filter = userId ? { userId } : {};
    return ReminderLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  },
};
