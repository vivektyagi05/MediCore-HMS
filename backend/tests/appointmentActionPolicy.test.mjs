// Action policy matrix: future/current/missed/expired × actor × status × visit state.
import assert from "node:assert/strict";
import { evaluateAppointmentAction as ev, listAllowedActions, ACTION as A } from "../services/appointmentActionPolicy.js";

const tz = "Asia/Kolkata";
const rules = { resolutionWindowDays: 3, checkInEarlyWindowMinutes: 30, noShowGraceMinutes: 15, earlyStartWindowMinutes: 15, defaultSlotMinutes: 30, delayNotifyThresholdMinutes: 15, reminderIntervalsMinutes: [1440, 120, 30] };
const day = new Date("2026-09-24T00:00:00.000Z"); // slot 10:00–10:30 IST = 04:30Z–05:00Z
const appt = (o = {}) => ({ status: "payment_completed", paymentStatus: "paid", date: day, timeSlot: "10:00-10:30", consultationMode: "in_person", visit: { state: "not_arrived" }, ...o });
const at = (iso) => new Date(iso);
const run = (action, actorRole, a, nowIso) => ev({ action, actorRole, appointment: a, now: at(nowIso), tz, rules });

// SCENARIO 1 — appointment tomorrow, doctor starts → BLOCKED
let r = run(A.START_CONSULTATION, "doctor", appt(), "2026-09-23T04:30:00Z");
assert.equal(r.allowed, false); assert.equal(r.code, "APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW"); assert.equal(r.timeState, "UPCOMING");
// early-start window is 15 min: 14 min before allowed, 16 min before blocked
assert.equal(run(A.START_CONSULTATION, "doctor", appt(), "2026-09-24T04:16:00Z").allowed, true);
assert.equal(run(A.START_CONSULTATION, "doctor", appt(), "2026-09-24T04:14:00Z").allowed, false);
// SCENARIO 2 — exact start allowed
assert.equal(run(A.START_CONSULTATION, "doctor", appt(), "2026-09-24T04:30:00Z").allowed, true);
// patient can never start; unpaid cannot start
assert.equal(run(A.START_CONSULTATION, "patient", appt(), "2026-09-24T04:30:00Z").code, "UNAUTHORIZED_APPOINTMENT_ACTION");
assert.equal(run(A.START_CONSULTATION, "doctor", appt({ status: "approved" }), "2026-09-24T04:30:00Z").code, "PAYMENT_REQUIRED");
// late start, patient present, same day → allowed; patient absent → resolution required
const late = "2026-09-24T07:00:00Z"; // 12:30 IST, same hospital day
assert.equal(run(A.START_CONSULTATION, "doctor", appt({ visit: { state: "checked_in" } }), late).allowed, true);
assert.equal(run(A.START_CONSULTATION, "doctor", appt(), late).code, "APPOINTMENT_RESOLUTION_REQUIRED");
// SCENARIO 3 — yesterday & unresolved → resolve allowed, start blocked
const yesterdayNow = "2026-09-25T05:00:00Z";
assert.equal(run(A.START_CONSULTATION, "doctor", appt({ visit: { state: "checked_in" } }), yesterdayNow).code, "APPOINTMENT_RESOLUTION_REQUIRED");
assert.equal(run(A.RESOLVE_MISSED, "doctor", appt(), yesterdayNow).allowed, true);
// SCENARIO 4 — 2 days old: resolve allowed
assert.equal(run(A.RESOLVE_MISSED, "doctor", appt(), "2026-09-26T06:00:00Z").allowed, true);
// SCENARIO 5 — beyond window: start blocked, resolve blocked (expiry job takes over)
const beyond = "2026-09-27T05:00:01Z";
assert.equal(run(A.START_CONSULTATION, "doctor", appt(), beyond).code, "APPOINTMENT_RESOLUTION_WINDOW_EXPIRED");
assert.equal(run(A.RESOLVE_MISSED, "doctor", appt(), beyond).code, "APPOINTMENT_RESOLUTION_WINDOW_EXPIRED");
assert.equal(run(A.RESOLVE_MISSED, "doctor", appt(), "2026-09-27T05:00:00Z").allowed, true, "deadline itself is inclusive");
// started consultation can always be resolved (patient WAS seen) even past the window
assert.equal(run(A.RESOLVE_MISSED, "doctor", appt({ status: "consultation_started" }), "2026-10-20T00:00:00Z").allowed, true);
// resolve not applicable to upcoming/current/completed
assert.equal(run(A.RESOLVE_MISSED, "doctor", appt(), "2026-09-24T04:45:00Z").code, "APPOINTMENT_RESOLUTION_NOT_REQUIRED");
assert.equal(run(A.RESOLVE_MISSED, "doctor", appt({ status: "completed" }), yesterdayNow).code, "APPOINTMENT_ALREADY_COMPLETED");
// SCENARIO 10 — cancelled blocks everything mutating
for (const act of [A.START_CONSULTATION, A.COMPLETE_CONSULTATION, A.CHECK_IN, A.CALL_PATIENT, A.RESCHEDULE, A.CANCEL, A.RESOLVE_MISSED, A.MARK_PATIENT_NO_SHOW]) {
  const who = [A.CHECK_IN].includes(act) ? "patient" : "doctor";
  assert.equal(run(act, who, appt({ status: "cancelled" }), "2026-09-24T04:45:00Z").code, "APPOINTMENT_ALREADY_CANCELLED", act);
}
// complete only after start; cannot complete a future appointment
assert.equal(run(A.COMPLETE_CONSULTATION, "doctor", appt(), "2026-09-24T04:45:00Z").code, "CONSULTATION_NOT_STARTED");
assert.equal(run(A.COMPLETE_CONSULTATION, "doctor", appt({ status: "consultation_started" }), "2026-09-20T00:00:00Z").code, "APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW");
assert.equal(run(A.COMPLETE_CONSULTATION, "doctor", appt({ status: "consultation_started" }), "2026-09-24T04:50:00Z").allowed, true);

// Check-in window: 30 min before start .. end
assert.equal(run(A.CHECK_IN, "patient", appt(), "2026-09-24T03:59:00Z").code, "CHECKIN_NOT_OPEN");
assert.equal(run(A.CHECK_IN, "patient", appt(), "2026-09-24T04:00:00Z").allowed, true);
assert.equal(run(A.CHECK_IN, "patient", appt(), "2026-09-24T05:00:00Z").allowed, true);
assert.equal(run(A.CHECK_IN, "patient", appt(), "2026-09-24T05:01:00Z").code, "APPOINTMENT_RESOLUTION_REQUIRED");
assert.equal(run(A.CHECK_IN, "patient", appt(), "2026-09-28T05:00:00Z").code, "APPOINTMENT_ALREADY_EXPIRED");
assert.equal(run(A.CHECK_IN, "patient", appt({ visit: { state: "checked_in" } }), "2026-09-24T04:30:00Z").code, "CHECKIN_ALREADY_COMPLETED");
assert.equal(run(A.CHECK_IN, "patient", appt({ status: "approved" }), "2026-09-24T04:30:00Z").code, "PAYMENT_REQUIRED");
assert.equal(run(A.CHECK_IN, "doctor", appt(), "2026-09-24T04:30:00Z").code, "UNAUTHORIZED_APPOINTMENT_ACTION");
// call requires check-in
assert.equal(run(A.CALL_PATIENT, "doctor", appt(), "2026-09-24T04:30:00Z").code, "PATIENT_NOT_CHECKED_IN");
assert.equal(run(A.CALL_PATIENT, "doctor", appt({ visit: { state: "checked_in" } }), "2026-09-24T04:30:00Z").allowed, true);

// No-show: only after start + grace(15m) ; never for a checked-in patient; never future
assert.equal(run(A.MARK_PATIENT_NO_SHOW, "doctor", appt(), "2026-09-24T04:44:59Z").code, "APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW");
assert.equal(run(A.MARK_PATIENT_NO_SHOW, "doctor", appt(), "2026-09-24T04:45:00Z").allowed, true);
assert.equal(run(A.MARK_PATIENT_NO_SHOW, "doctor", appt({ visit: { state: "checked_in" } }), "2026-09-24T05:30:00Z").code, "ACTION_NOT_ALLOWED");
assert.equal(run(A.MARK_PATIENT_NO_SHOW, "doctor", appt(), "2026-09-23T04:45:00Z").code, "APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW");
assert.equal(run(A.MARK_PATIENT_NO_SHOW, "patient", appt(), "2026-09-24T05:00:00Z").code, "UNAUTHORIZED_APPOINTMENT_ACTION");
// Doctor no-show report needs real check-in evidence
assert.equal(run(A.REPORT_DOCTOR_NO_SHOW, "patient", appt(), "2026-09-24T05:00:00Z").code, "PATIENT_NOT_CHECKED_IN");
assert.equal(run(A.REPORT_DOCTOR_NO_SHOW, "patient", appt({ visit: { state: "checked_in" } }), "2026-09-24T04:44:00Z").code, "APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW");
assert.equal(run(A.REPORT_DOCTOR_NO_SHOW, "patient", appt({ visit: { state: "checked_in" } }), "2026-09-24T04:46:00Z").allowed, true);

// Patient cancel/reschedule: only strictly before the slot starts; doctor may after
assert.equal(run(A.CANCEL, "patient", appt(), "2026-09-24T04:29:59Z").allowed, true);
assert.equal(run(A.CANCEL, "patient", appt(), "2026-09-24T04:30:00Z").code, "APPOINTMENT_NOT_FUTURE");
assert.equal(run(A.CANCEL, "doctor", appt(), "2026-09-24T04:35:00Z").allowed, true);
assert.equal(run(A.CANCEL, "doctor", appt({ status: "consultation_started" }), "2026-09-24T04:35:00Z").code, "APPOINTMENT_ALREADY_STARTED");
assert.equal(run(A.RESCHEDULE, "patient", appt(), "2026-09-24T04:30:00Z").code, "APPOINTMENT_NOT_FUTURE");
assert.equal(run(A.RESCHEDULE, "patient", appt({ visit: { state: "checked_in" } }), "2026-09-24T04:00:00Z").code, "ACTION_NOT_ALLOWED");
assert.equal(run(A.RESCHEDULE, "doctor", appt({ visit: { state: "missed" } }), yesterdayNow).allowed, true);
// Pay: never after the slot ended, never twice
assert.equal(run(A.PAY, "patient", appt({ status: "approved", paymentStatus: "pending" }), "2026-09-24T04:00:00Z").allowed, true);
assert.equal(run(A.PAY, "patient", appt({ status: "approved", paymentStatus: "pending" }), "2026-09-24T05:01:00Z").code, "APPOINTMENT_NOT_FUTURE");
assert.equal(run(A.PAY, "patient", appt(), "2026-09-24T04:00:00Z").code, "ACTION_NOT_ALLOWED");
// Approve a past appointment is blocked
assert.equal(run(A.APPROVE, "doctor", appt({ status: "pending" }), "2026-09-24T05:01:00Z").code, "APPOINTMENT_NOT_FUTURE");
assert.equal(run(A.APPROVE, "doctor", appt({ status: "pending" }), "2026-09-24T03:00:00Z").allowed, true);
// Online join only for online mode, inside the window
assert.equal(run(A.JOIN_ONLINE, "patient", appt(), "2026-09-24T04:30:00Z").code, "INVALID_APPOINTMENT_MODE");
const online = appt({ consultationMode: "online" });
assert.equal(run(A.JOIN_ONLINE, "patient", online, "2026-09-24T03:00:00Z").code, "APPOINTMENT_NOT_IN_ALLOWED_TIME_WINDOW");
assert.equal(run(A.JOIN_ONLINE, "patient", online, "2026-09-24T04:10:00Z").allowed, true);
// Clinical documents never on future/unstarted appointments
assert.equal(run(A.ADD_CLINICAL, "doctor", appt(), "2026-09-24T04:30:00Z").code, "CONSULTATION_NOT_STARTED");
assert.equal(run(A.ADD_CLINICAL, "doctor", appt({ status: "consultation_completed" }), "2026-09-24T05:30:00Z").allowed, true);
// Unknown role/action/legacy slot
assert.equal(run(A.VIEW, "receptionist", appt(), "2026-09-24T04:30:00Z").code, "UNAUTHORIZED_APPOINTMENT_ACTION");
assert.equal(run("teleport", "doctor", appt(), "2026-09-24T04:30:00Z").code, "ACTION_NOT_ALLOWED");
const legacy = appt({ timeSlot: "morning" });
assert.equal(run(A.START_CONSULTATION, "doctor", legacy, "2026-09-24T04:30:00Z").timeState, "UNKNOWN");
// listAllowedActions mirrors single evaluations
const all = listAllowedActions({ actorRole: "patient", appointment: appt(), now: at("2026-09-24T04:00:00Z"), tz, rules });
assert.equal(all[A.CHECK_IN].allowed, true); assert.equal(all[A.START_CONSULTATION].allowed, false); assert.equal(all[A.CANCEL].allowed, true);
// Timezone boundary: 23:30 IST slot — "tomorrow" in UTC but same hospital day
const late2 = appt({ timeSlot: "23:30-23:59" });
assert.equal(run(A.START_CONSULTATION, "doctor", late2, "2026-09-24T18:00:00Z").allowed, true); // 23:30 IST exactly
assert.equal(run(A.START_CONSULTATION, "doctor", late2, "2026-09-24T17:00:00Z").allowed, false); // 22:30 IST
console.log("PASS: appointmentActionPolicy matrix (scenarios 1-5,10, time boundaries, actors, windows, tz)");
