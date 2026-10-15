// ─────────────────────────────────────────────────────────────────────────
// ATOMIC APPOINTMENT TRANSITIONS.
//
// The ONLY sanctioned way to change Appointment.status / visit state for any
// action that can race another actor (doctor vs scheduler vs patient vs
// payment webhook). It is a single conditional findOneAndUpdate:
//
//   WHERE _id = X AND status ∈ expected AND visit.state ∈ expected (+ extra)
//   SET   new fields        PUSH statusHistory entry
//
// If the precondition no longer holds (someone else won), nothing is written
// and APPOINTMENT_STATE_CHANGED is raised — callers never `.save()` a stale
// in-memory document over a newer state. The audit entry is written in the
// SAME atomic update, so state and history can never diverge.
// ─────────────────────────────────────────────────────────────────────────
import Appointment from "../models/Appointment.js";
import { appointmentError } from "../utils/appointmentErrors.js";
import { VISIT_STATE } from "../constants/appointmentVisitState.js";

const visitStateFilter = (states) => {
  if (!states?.length) return {};
  // Legacy documents have no visit.state in the DB; `null` in $in matches a missing field.
  return { "visit.state": { $in: states.includes(VISIT_STATE.NOT_ARRIVED) ? [...states, null] : states } };
};

/**
 * @param {object} p
 * @param {*} p.appointmentId
 * @param {string[]} p.fromStatuses     required status precondition
 * @param {string[]} [p.fromVisitStates] optional visit-state precondition
 * @param {object} [p.extraFilter]       additional preconditions (e.g. paymentStatus)
 * @param {object} [p.set]               fields to set (dotted paths ok)
 * @param {object} [p.unset]
 * @param {object} p.history             audit entry (status/fromStatus/actorRole/reason/reasonCode/event/visitState…)
 * @param {boolean} [p.returnNullOnConflict] return null instead of throwing (jobs use this)
 * @returns {Promise<object|null>} updated document (lean:false) or null
 */
export const atomicTransition = async ({
  appointmentId,
  fromStatuses,
  fromVisitStates,
  extraFilter = {},
  set = {},
  unset,
  history,
  returnNullOnConflict = false,
}) => {
  const entry = { at: new Date(), actorRole: "system", ...history };
  const update = { $set: set, $push: { statusHistory: entry } };
  if (unset) update.$unset = unset;
  const updated = await Appointment.findOneAndUpdate(
    { _id: appointmentId, status: { $in: fromStatuses }, ...visitStateFilter(fromVisitStates), ...extraFilter },
    update,
    { returnDocument: "after", runValidators: true },
  );
  if (updated) return updated;
  if (returnNullOnConflict) return null;
  const exists = await Appointment.exists({ _id: appointmentId });
  throw appointmentError(exists ? "APPOINTMENT_STATE_CHANGED" : "APPOINTMENT_NOT_FOUND");
};
