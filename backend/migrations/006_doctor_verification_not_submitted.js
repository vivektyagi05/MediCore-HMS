// One-time backfill for the verificationStatus default fix (models/Doctor.js
// + services/doctorLifecycleService.js): "pending" used to mean BOTH "never
// submitted" (the schema default) and "submitted, awaiting admin review".
//
// A doctor who has an empty verificationHistory has, by definition, never
// gone through submitOnboarding() (which is the only place that pushes a
// history entry), so any such doctor still reading "pending" is really
// "not_submitted". A doctor with a non-empty history genuinely was
// reviewed/is under review and is left untouched.
import { connectDB, disconnectDB } from "../config/db.js";
import Doctor from "../models/Doctor.js";

const run = async () => {
  await connectDB();
  const result = await Doctor.updateMany(
    {
      verificationStatus: "pending",
      $or: [{ verificationHistory: { $exists: false } }, { verificationHistory: { $size: 0 } }],
    },
    { $set: { verificationStatus: "not_submitted" } },
  );
  const summary = { matched: result.matchedCount ?? result.n ?? 0, modified: result.modifiedCount ?? result.nModified ?? 0 };
  console.log(JSON.stringify(summary));
  return summary;
};

if (process.argv[1]?.endsWith("006_doctor_verification_not_submitted.js")) {
  run()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}

export { run };
