import { connectDB } from "../config/db.js";
import { runUnresolvedAppointmentSweep } from "../services/appointmentLifecycleService.js";
import { logger } from "../utils/logger.js";
import { trackRun } from "../utils/cronRunTracker.js";

// Flags past-due unresolved appointments and auto-expires those beyond the
// configured resolution window. trackRun provides the distributed
// "one running instance" lock + CronRunLog observability; the sweep itself is
// idempotent and uses atomic conditional writes, so overlapping/duplicate
// runs can never double-process an appointment.
export const runAppointmentLifecycleSweep = async () => {
  await connectDB();
  return trackRun("appointmentLifecycleSweep", async () => {
    const result = await runUnresolvedAppointmentSweep();
    logger.info("Appointment lifecycle sweep completed", result);
    return result;
  });
};

if (process.argv[1]?.endsWith("appointmentLifecycleSweep.js")) {
  runAppointmentLifecycleSweep()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Appointment lifecycle sweep failed", { message: error.message, stack: error.stack });
      process.exit(1);
    });
}
