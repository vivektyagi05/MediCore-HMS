// PHASE 2-B — Section 8 (Doctor Access Control), CRITICAL per the brief.
//
// Before this, `authorizeRoles(ROLES.DOCTOR)` only checked the user's
// ROLE -- it never checked whether that doctor had actually been approved.
// Every clinical/practice workflow route (dashboard, schedule mutation,
// prescriptions, certificates, earnings, reviews, withdrawals, ...) was
// reachable by a brand-new "pending" doctor, or even a "rejected" one, the
// moment they had a valid JWT. In practice most consequential actions were
// still blocked one layer down (e.g. createAppointment already requires
// `doctor.isVerified && verificationStatus === "approved"`, so an
// unapproved doctor can never actually acquire a real patient/appointment
// to act on) -- but the brief's own access-control matrix is explicit:
// NOT APPROVED doctors get onboarding/profile/application-status ONLY,
// nothing else, and that must be enforced server-side, not left as an
// accident of "there's nothing to act on yet".
//
// Deliberately NOT applied to: onboarding routes (the whole point is to
// let a not-yet-approved doctor complete/submit their application),
// practiceRoutes.js's professional-profile/verification-center endpoints
// (same reason -- a doctor must be able to finish their profile before
// they can be approved), and the doctor documents endpoints in
// workflowRoutes.js (uploading license/degree/ID documents is part of the
// application a pending doctor is actively submitting for review).
import Doctor from "../models/Doctor.js";
import { AppError } from "./errorMiddleware.js";

export const requireApprovedDoctor = async (req, _res, next) => {
  try {
    const doctor = await Doctor.findOne({ userId: req.user._id }).select("verificationStatus isVerified").lean();

    if (!doctor || !doctor.isVerified || doctor.verificationStatus !== "approved") {
      return next(
        new AppError(
          "Your doctor account is not yet approved. Complete your onboarding and wait for admin verification to access this feature.",
          403,
        ),
      );
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
