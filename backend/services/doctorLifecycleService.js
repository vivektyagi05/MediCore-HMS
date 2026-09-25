// ─────────────────────────────────────────────────────────────────────────
// Canonical doctor lifecycle — SINGLE definition of what each doctor state
// means. Every consumer (clinical access, chat, public discovery, booking,
// PrivateRoute payloads, admin lists) must ask THIS module instead of
// re-implementing "is this doctor allowed?" from raw fields.
//
// Source of truth:  Doctor.verificationStatus
//   not_submitted -> pending -> approved
//                        \-> rejected -> pending (resubmission)
//   approved -> pending (a credential field changed and needs re-review)
//
// Derived / projected (never independently authoritative):
//   Doctor.isVerified            === (verificationStatus === "approved")
//   User.doctorOnboardingStatus  == projection of verificationStatus
//                                   (not_submitted -> "not_started")
//
// Orthogonal, deliberately NOT part of the lifecycle:
//   User.isActive / Doctor.isActive   account-level switches (deactivation)
//   User.emailVerified                identity state (checked at login)
// ─────────────────────────────────────────────────────────────────────────

export const DOCTOR_VERIFICATION = Object.freeze({
  NOT_SUBMITTED: "not_submitted",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
});

export const DOCTOR_VERIFICATION_VALUES = Object.freeze(Object.values(DOCTOR_VERIFICATION));

export const DOCTOR_VERIFICATION_TRANSITIONS = Object.freeze({
  [DOCTOR_VERIFICATION.NOT_SUBMITTED]: [DOCTOR_VERIFICATION.PENDING],
  [DOCTOR_VERIFICATION.PENDING]: [DOCTOR_VERIFICATION.APPROVED, DOCTOR_VERIFICATION.REJECTED],
  [DOCTOR_VERIFICATION.APPROVED]: [DOCTOR_VERIFICATION.PENDING],
  [DOCTOR_VERIFICATION.REJECTED]: [DOCTOR_VERIFICATION.PENDING],
});

// Projection onto the legacy User.doctorOnboardingStatus vocabulary that the
// frontend PrivateRoute and cached auth payload already consume.
export const USER_ONBOARDING_STATUS_FOR = Object.freeze({
  [DOCTOR_VERIFICATION.NOT_SUBMITTED]: "not_started",
  [DOCTOR_VERIFICATION.PENDING]: "pending",
  [DOCTOR_VERIFICATION.APPROVED]: "approved",
  [DOCTOR_VERIFICATION.REJECTED]: "rejected",
});

export const canTransitionDoctorVerification = (from, to) =>
  (DOCTOR_VERIFICATION_TRANSITIONS[from] || []).includes(to);

export const isDoctorApproved = (doctor) =>
  Boolean(doctor) && doctor.verificationStatus === DOCTOR_VERIFICATION.APPROVED && doctor.isVerified === true;

/** May this doctor act clinically (patient data, prescriptions, chat)? */
export const isDoctorClinicallyEligible = (doctor) => isDoctorApproved(doctor) && doctor.isActive !== false;

/** May patients find/book this doctor? (Doctor-side; user.isActive is checked by the query layer.) */
export const isDoctorPubliclyVisible = (doctor) => isDoctorClinicallyEligible(doctor);

export const onboardingStatusForUser = (doctor) =>
  USER_ONBOARDING_STATUS_FOR[doctor?.verificationStatus] || USER_ONBOARDING_STATUS_FOR[DOCTOR_VERIFICATION.NOT_SUBMITTED];
