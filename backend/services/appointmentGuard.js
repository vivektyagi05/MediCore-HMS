// Thin async adapter: loads hospital rules/timezone once and applies the pure
// action policy. Controllers call this instead of re-deriving time/status
// rules, so every entry point enforces the identical matrix.
import { getAppointmentRules } from "./hospitalSettingsService.js";
import { evaluateAppointmentAction, listAllowedActions } from "./appointmentActionPolicy.js";
import { appointmentError } from "../utils/appointmentErrors.js";

export const guardAppointmentAction = async ({ appointment, action, actorRole, now = new Date(), rules }) => {
  const r = rules || (await getAppointmentRules());
  const verdict = evaluateAppointmentAction({ action, actorRole, appointment, now, tz: r.timezone, rules: r });
  if (!verdict.allowed) {
    throw appointmentError(verdict.code, { action, timeState: verdict.timeState, ...(verdict.opensAt ? { opensAt: verdict.opensAt } : {}) });
  }
  return verdict;
};

export const buildAllowedActions = async ({ appointment, actorRole, now = new Date(), rules }) => {
  const r = rules || (await getAppointmentRules());
  const verdicts = listAllowedActions({ actorRole, appointment, now, tz: r.timezone, rules: r });
  const { state } = evaluateAppointmentAction({ action: "view", actorRole, appointment, now, tz: r.timezone, rules: r }).timeState
    ? { state: evaluateAppointmentAction({ action: "view", actorRole, appointment, now, tz: r.timezone, rules: r }).timeState }
    : { state: "UNKNOWN" };
  return { timeState: state, serverTime: now.toISOString(), actions: verdicts };
};
