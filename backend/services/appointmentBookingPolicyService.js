// ─────────────────────────────────────────────────────────────────────────
// APPOINTMENT ENGINE REMEDIATION (2026-09-24) — canonical, server-authoritative
// appointment timing/window policy.
//
// ROOT CAUSE THIS FILE FIXES:
// createAppointment, rescheduleAppointment (appointmentController.js) and
// scheduleFollowUpAppointment (doctor/workflowController.js) each only
// rejected a booking whose CALENDAR DATE was strictly before today
// (`appointmentDate < today`, both normalized to UTC midnight). None of
// them compared the requested time-of-day against the real current clock
// time. Concretely: if the real server time is 2026-09-24 12:00 and a
// patient requests 2026-09-24 09:00, `appointmentDate` and `today` are
// both midnight 2026-09-24 -- EQUAL, not less-than -- so the check passed
// and a plainly-past slot on today's date could be booked. This is exactly
// the bug the remediation brief's Scenario A describes.
//
// getAvailableSlots already avoided showing an already-passed slot for
// TODAY (via capacityAggregates.buildDayCapacity's `currentTimeMinutes`
// parameter), but that is a display-time filter on one read endpoint --
// frontend validation only, per this brief's own "never trust the
// frontend" rule. The write paths (create/reschedule/follow-up-schedule)
// had no equivalent server-side enforcement at all. This file is the one
// place that enforcement now lives, so it can never drift out of sync
// across the three write paths again.
//
// TIMEZONE STRATEGY (canonical, replaces the earlier UTC-digits convention):
// Appointment.date is a hospital-local CALENDAR-DAY key (UTC-midnight Date);
// timeSlot is HOSPITAL wall-clock time. Every instant is derived by
// utils/hospitalTime.js using HospitalSetting.timezone (default
// Asia/Kolkata). Nothing in this file compares slot digits to UTC digits.
//
// SINGLE canonical policy surface reused by every write path:
//   - appointmentController.createAppointment
//   - appointmentController.rescheduleAppointment
//   - doctor/workflowController.scheduleFollowUpAppointment
// Deliberately NOT duplicated a third/fourth time.
// ─────────────────────────────────────────────────────────────────────────
import Appointment from "../models/Appointment.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { ACTIVE_STATUSES } from "../constants/appointmentStatus.js";
import { getAppointmentLimits, getHospitalTimezone } from "./hospitalSettingsService.js";
import {
  DEFAULT_HOSPITAL_TIMEZONE,
  hospitalToday,
  resolveSlotStartMinutes as _resolveSlotStartMinutes,
  resolveAppointmentInstant as _resolveAppointmentInstant,
  resolveAppointmentEndInstant,
  DEFAULT_SLOT_MINUTES,
} from "../utils/hospitalTime.js";

/**
 * Authoritative "now." Never trust a client-supplied current time. Kept as
 * its own function (rather than inlining `new Date()` at each call site) so
 * a future test can stub it without needing a live clock — none of this
 * remediation's own tests do that today (they compute expected results
 * relative to whatever `new Date()` actually is at test-run time instead),
 * but centralizing it means one place would need to change if that's ever
 * wanted.
 */
export const getServerNow = () => new Date();

/**
 * Parses a "HH:MM" or "HH:MM-HH:MM" timeSlot string into its START minutes
 * since UTC midnight. Returns null (never throws) for anything that
 * doesn't parse as a plausible 24h time — legacy free-typed slots
 * (doctor/workflowController's "Legacy manually-typed slots — respected
 * as-is for backward compatibility" path in utils/slotEngine.js) are not
 * guaranteed to be in this format, and this file must never turn an
 * unparseable-but-otherwise-legitimate legacy slot into a hard failure.
 * Callers fall back to date-only comparison when this returns null —
 * i.e. exactly today's prior (already-shipped) behavior, never worse.
 */
export const resolveSlotStartMinutes = _resolveSlotStartMinutes;

/**
 * Canonical date + timeSlot → real instant in the HOSPITAL timezone.
 * Delegates to utils/hospitalTime.js (the only implementation).
 * Returns null when the timeSlot doesn't parse (callers fall back to
 * date-only comparison).
 */
export const resolveAppointmentInstant = (date, timeSlot, tz = DEFAULT_HOSPITAL_TIMEZONE) =>
  _resolveAppointmentInstant(date, timeSlot, tz);

/**
 * PHASE 3 — mandatory server-time / past-instant protection.
 *
 * Rejects a booking/reschedule whose requested date+timeSlot instant is at
 * or before the real current server time. Falls back to date-only
 * comparison (today's already-shipped, narrower protection) when the
 * timeSlot doesn't parse into a real time, so legacy free-typed slot data
 * is never newly broken by this change — it just doesn't gain the
 * finer-grained protection this remediation adds for the normal,
 * structured-slot path every doctor's schedule actually uses.
 *
 * @param {Date} date - already UTC-midnight-normalized appointment date
 * @param {string} timeSlot
 * @param {Date} [now] - defaults to getServerNow()
 * @throws {AppError} 400 if the requested instant has already passed
 */
export const assertAppointmentNotInPast = (date, timeSlot, now = getServerNow(), tz = DEFAULT_HOSPITAL_TIMEZONE) => {
  const today = hospitalToday(now, tz);

  if (date < today) {
    throw new AppError("Appointment time has already passed.", 400, { code: "PAST_DATE" });
  }

  const instant = resolveAppointmentInstant(date, timeSlot, tz);
  if (instant !== null && instant <= now) {
    throw new AppError("Appointment time has already passed.", 400, { code: "PAST_TIME" });
  }
};

/**
 * PHASE 5 — booking window enforcement.
 * `HospitalSetting.appointmentLimits.bookingWindowDays` was previously read
 * only for public display (see hospitalSettingsService.js header comment);
 * nothing stopped a patient from booking arbitrarily far in the future.
 * This was explicitly flagged, found-but-not-fixed, in the prior
 * checkpoint (`docs/remediation/CHECKPOINT-STATUS-2026-09-23.md`, Section
 * C item 2) — fixed here.
 *
 * @param {Date} date - already UTC-midnight-normalized appointment date
 * @param {Date} [now]
 * @throws {AppError} 400 if the date is further out than the configured window
 */
export const assertWithinBookingWindow = async (date, now = getServerNow(), tz = DEFAULT_HOSPITAL_TIMEZONE) => {
  const { bookingWindowDays } = await getAppointmentLimits();
  const today = hospitalToday(now, tz);
  const maxDate = new Date(today);
  maxDate.setUTCDate(maxDate.getUTCDate() + bookingWindowDays);

  if (date > maxDate) {
    throw new AppError(
      `Appointments can only be booked up to ${bookingWindowDays} days in advance.`,
      400,
      { code: "BOOKING_WINDOW_EXCEEDED", bookingWindowDays },
    );
  }
};

/**
 * PHASE 5 — per-doctor daily appointment cap.
 * `HospitalSetting.appointmentLimits.dailyPerDoctor` had the exact same
 * "display only" gap as bookingWindowDays above (same checkpoint finding).
 * Counts ACTIVE (not just pending/approved — full active lifecycle, same
 * convention every other appointment-count query in this codebase already
 * uses) appointments for this doctor on this date, excluding the
 * appointment being rescheduled itself so a reschedule within the same
 * day never double-counts against its own prior slot.
 *
 * This is a best-effort pre-check (mirrors the existing
 * findOne-then-create conflict check's own documented limitation) — the
 * REAL race-condition guarantee for the underlying slot conflict remains
 * the Appointment schema's unique partial index, unaffected by this
 * addition. A daily cap has no equivalent single-slot uniqueness
 * constraint to fall back on, so under true concurrent load at the exact
 * cap boundary a doctor could in principle end up one appointment over
 * their configured daily cap; this is a soft operational limit (mirrors
 * how the rest of the system already treats "capacity"), not a security
 * boundary like the double-booking-of-one-slot guarantee, so a stricter
 * atomic-counter/lock mechanism was judged out of proportion for this
 * pass. Documented explicitly, not silently accepted.
 *
 * @param {import("mongoose").Types.ObjectId|string} doctorId
 * @param {Date} date - already UTC-midnight-normalized appointment date
 * @param {import("mongoose").Types.ObjectId|string} [excludeAppointmentId] - reschedule's own appointment id
 * @throws {AppError} 409 if the doctor's daily cap for this date is already reached
 */
export const assertDoctorDailyCapacityAvailable = async (doctorId, date, excludeAppointmentId) => {
  const { dailyPerDoctor } = await getAppointmentLimits();
  const filter = {
    doctorId,
    date,
    status: { $in: ACTIVE_STATUSES },
  };
  if (excludeAppointmentId) {
    filter._id = { $ne: excludeAppointmentId };
  }
  const activeCount = await Appointment.countDocuments(filter);
  if (activeCount >= dailyPerDoctor) {
    throw new AppError(
      "This doctor has reached the maximum number of appointments for this date. Please choose another date.",
      409,
      { code: "DAILY_CAPACITY_REACHED", dailyPerDoctor },
    );
  }
};

/**
 * Convenience wrapper running every canonical timing/window check a
 * booking or reschedule needs, in the order the remediation brief's own
 * phases specify (past-instant first, then window, then daily cap) — so
 * every write path gets identical error precedence, not just identical
 * checks.
 *
 * @param {object} params
 * @param {Date} params.date - already UTC-midnight-normalized
 * @param {string} params.timeSlot
 * @param {import("mongoose").Types.ObjectId|string} params.doctorId
 * @param {import("mongoose").Types.ObjectId|string} [params.excludeAppointmentId]
 * @param {Date} [params.now]
 */
export const enforceAppointmentBookingPolicy = async ({
  date,
  timeSlot,
  doctorId,
  excludeAppointmentId,
  now = getServerNow(),
  tz,
}) => {
  const zone = tz || (await getHospitalTimezone());
  assertAppointmentNotInPast(date, timeSlot, now, zone);
  await assertWithinBookingWindow(date, now, zone);
  await assertDoctorDailyCapacityAvailable(doctorId, date, excludeAppointmentId);
};

/**
 * CONCURRENCY-SAFE daily cap (insert-then-verify).
 *
 * assertDoctorDailyCapacityAvailable above is count-then-create: two
 * requests can both read count = cap-1 and both insert. That pre-check is
 * kept as a cheap early rejection, but THIS function is the guarantee.
 *
 * Call it immediately AFTER the appointment document has been durably
 * written/moved into (doctorId, date). It re-counts ALL active appointments
 * for that doctor+date. If the total exceeds the cap, the caller's own write
 * is rolled back (via `rollback`) and a controlled 409 is raised.
 *
 * Safety argument: of any set of concurrent writers, the LAST one whose
 * write commits observes every earlier committed write in its verification
 * count, sees count > cap, and undoes itself. Writers that overshoot
 * simultaneously may BOTH roll back (liveness trade-off: the patient is
 * told to retry) but the cap can never be exceeded by surviving writes.
 *
 * @returns {Promise<void>} resolves when within cap; throws 409 DAILY_CAPACITY_REACHED otherwise
 */
export const verifyDailyCapacityAfterWrite = async ({ doctorId, date, rollback }) => {
  const { dailyPerDoctor } = await getAppointmentLimits();
  const total = await Appointment.countDocuments({ doctorId, date, status: { $in: ACTIVE_STATUSES } });
  if (total <= dailyPerDoctor) return;
  if (typeof rollback === "function") await rollback();
  throw new AppError(
    "This doctor has reached the maximum number of appointments for this date. Please choose another date.",
    409,
    { code: "DAILY_CAPACITY_REACHED", dailyPerDoctor },
  );
};

/**
 * Patient-side conflict: the SAME person (account + family member) cannot hold
 * two overlapping active appointments on one day, with ANY doctor. The older
 * check only caught the same doctor + identical slot string. Bounded: one
 * indexed query for one patient on one day.
 */
export const assertPatientHasNoOverlap = async ({ patientId, familyMemberId, date, timeSlot, excludeAppointmentId, tz }) => {
  const zone = tz || (await getHospitalTimezone());
  const start = _resolveAppointmentInstant(date, timeSlot, zone);
  if (!start) return; // legacy free-typed slot: no instant to compare
  const end = resolveAppointmentEndInstant(date, timeSlot, zone, DEFAULT_SLOT_MINUTES);
  const filter = { patientId, date, status: { $in: ACTIVE_STATUSES } };
  if (excludeAppointmentId) filter._id = { $ne: excludeAppointmentId };
  const sameDay = await Appointment.find(filter).select("timeSlot date familyMemberId").limit(50).lean();
  for (const other of sameDay) {
    if (String(other.familyMemberId || "") !== String(familyMemberId || "")) continue; // different person
    const oStart = _resolveAppointmentInstant(other.date, other.timeSlot, zone);
    if (!oStart) continue;
    const oEnd = resolveAppointmentEndInstant(other.date, other.timeSlot, zone, DEFAULT_SLOT_MINUTES);
    if (start < oEnd && end > oStart) {
      throw new AppError("You already have an appointment that overlaps this time.", 409, { code: "PATIENT_SLOT_CONFLICT" });
    }
  }
};

const sameAddress = (a, b) => {
  const norm = (x) => `${x?.line1 || ""}|${x?.city || ""}|${x?.postalCode || ""}`.toLowerCase().trim();
  return norm(a) !== "||" && norm(a) === norm(b);
};

/**
 * PURE. Is `candidate` feasible next to `others` given a travel buffer?
 * Travel is required between two appointments when at least one is a home
 * visit and they are at different places (different mode, or different home
 * address). Same-place back-to-back needs no buffer. This is a configurable
 * safety buffer, NOT routing: no map/ETA service exists, so none is claimed.
 */
export const findTravelConflict = ({ candidate, others, bufferMinutes, tz }) => {
  if (!bufferMinutes) return null;
  const cStart = _resolveAppointmentInstant(candidate.date, candidate.timeSlot, tz);
  if (!cStart) return null;
  const cEnd = resolveAppointmentEndInstant(candidate.date, candidate.timeSlot, tz, DEFAULT_SLOT_MINUTES);
  for (const o of others) {
    const oStart = _resolveAppointmentInstant(o.date, o.timeSlot, tz);
    if (!oStart) continue;
    const oEnd = resolveAppointmentEndInstant(o.date, o.timeSlot, tz, DEFAULT_SLOT_MINUTES);
    const eitherHome = candidate.consultationMode === "home_visit" || o.consultationMode === "home_visit";
    if (!eitherHome) continue;
    const samePlace = candidate.consultationMode === o.consultationMode && (candidate.consultationMode !== "home_visit" || sameAddress(candidate.visitAddress, o.visitAddress));
    if (samePlace) continue;
    const gapMin = Math.max((cStart - oEnd) / 60000, (oStart - cEnd) / 60000);
    if (gapMin < bufferMinutes) return { appointmentId: o._id, gapMinutes: Math.round(gapMin), requiredMinutes: bufferMinutes };
  }
  return null;
};

export const assertTravelFeasible = async ({ doctorId, date, timeSlot, consultationMode, visitAddress, excludeAppointmentId, tz, bufferMinutes }) => {
  if (!bufferMinutes) return;
  const filter = { doctorId, date, status: { $in: ACTIVE_STATUSES } };
  if (excludeAppointmentId) filter._id = { $ne: excludeAppointmentId };
  const others = await Appointment.find(filter).select("date timeSlot consultationMode visitAddress").limit(100).lean();
  const conflict = findTravelConflict({ candidate: { date, timeSlot, consultationMode, visitAddress }, others, bufferMinutes, tz });
  if (conflict) {
    throw new AppError(
      `This time leaves too little travel time (${bufferMinutes} min needed) next to another appointment at a different location. Please choose a different time.`,
      409,
      { code: "TRAVEL_BUFFER_CONFLICT", requiredMinutes: bufferMinutes },
    );
  }
};
