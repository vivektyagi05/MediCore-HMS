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
// TIMEZONE STRATEGY (documented per remediation Phase 4): this codebase
// already treats every appointment date/time value as UTC end-to-end and
// deliberately does so on purpose -- see appointmentController.js
// `getDayOfWeek`/`normalizeDate` (pinned to `timeZone: "UTC"` /
// `setUTCHours`), the identical duplicate in doctor/workflowController.js
// and ai/aiScheduler.js, and getAvailableSlots's own
// `now.getUTCHours() * 60 + now.getUTCMinutes()` "current time" calc. A
// doctor's `availability[].startTime`/`timeSlot` strings ("09:00-09:30")
// are therefore stored and compared as literal UTC clock digits, not
// re-projected through `HospitalSetting.timezone` ("Asia/Kolkata") at
// read or write time anywhere in the existing codebase. That field is
// exposed for public display only (controllers/publicController.js) and
// is not wired into any date/time arithmetic.
//
// Introducing a real IST conversion here — while every other date/time
// computation in the app (Doctor Today view, next-available search,
// reminders, slot generation) kept comparing against literal UTC-labeled
// clock digits — would make THIS file disagree with every other place in
// the app that decides "is this slot in the past," which is a strictly
// worse and higher-risk state than the single-field bug being fixed. Per
// this brief's own Phase 4 instruction ("If the product is currently
// India-specific, preserve the existing business timezone rather than
// introducing unnecessary complexity... If timezone configuration already
// exists, use the canonical source"), the correct fix here is to make the
// write paths consistent with the ALREADY-ESTABLISHED UTC convention the
// entire rest of the appointment engine uses — not to invent a second,
// disagreeing convention. This is called out explicitly as a known,
// deliberate limitation in the remediation doc, not a silently-accepted
// bug: a real per-doctor/per-hospital timezone-aware scheduling engine
// would require re-deriving every date/time computation in the codebase
// (slot generation, capacity aggregation, reminders, AI scheduler) from a
// single canonical instant-resolution function, which is a much larger,
// cross-cutting change than this brief's own "do not casually refactor
// existing working architecture" / "strict scope control" rules permit
// for an appointment-engine-focused pass.
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
import { getAppointmentLimits } from "./hospitalSettingsService.js";

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
export const resolveSlotStartMinutes = (timeSlot) => {
  if (typeof timeSlot !== "string" || !timeSlot.trim()) return null;
  const [startPart] = timeSlot.split("-");
  const match = /^(\d{1,2}):(\d{2})$/.exec(startPart.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/**
 * Combines an already-UTC-midnight-normalized `date` with a parsed
 * timeSlot start time into one real instant. Returns null when the
 * timeSlot doesn't parse (see resolveSlotStartMinutes) — the caller must
 * fall back to date-only comparison in that case.
 */
export const resolveAppointmentInstant = (date, timeSlot) => {
  const startMinutes = resolveSlotStartMinutes(timeSlot);
  if (startMinutes === null) return null;
  const instant = new Date(date);
  instant.setUTCHours(0, startMinutes, 0, 0);
  return instant;
};

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
export const assertAppointmentNotInPast = (date, timeSlot, now = getServerNow()) => {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  if (date < today) {
    throw new AppError("Appointment time has already passed.", 400, { code: "PAST_DATE" });
  }

  const instant = resolveAppointmentInstant(date, timeSlot);
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
export const assertWithinBookingWindow = async (date, now = getServerNow()) => {
  const { bookingWindowDays } = await getAppointmentLimits();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
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
}) => {
  assertAppointmentNotInPast(date, timeSlot, now);
  await assertWithinBookingWindow(date, now);
  await assertDoctorDailyCapacityAvailable(doctorId, date, excludeAppointmentId);
};
