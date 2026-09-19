import { connectDB } from "../config/db.js";
import { repairMissingDoctorProfiles } from "../services/doctorProfileService.js";
import { logger } from "../utils/logger.js";

const run = async () => {
  await connectDB();
  const result = await repairMissingDoctorProfiles();

  logger.info("Doctor profile migration completed", {
    checkedDoctorUsers: result.checked,
    repairedDoctorProfiles: result.repaired,
    doctorProfileIds: result.doctorProfileIds.map((id) => id.toString()),
  });

  await import("mongoose").then(({ default: mongoose }) => mongoose.disconnect());
};

if (process.argv[1]?.endsWith("ensureDoctorProfiles.js")) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Doctor profile migration failed", { message: error.message });
      process.exit(1);
    });
}

export { run };
