// P23 Section 26 — mirrors paymentStateMachine.js / refundStateMachine.js.
// No controller should ever assign withdrawal.status directly; every
// mutation goes through appendWithdrawalTransition so the audit trail
// (stateHistory) and the legal-transition guarantee are never bypassed.
export const WITHDRAWAL_STATES = Object.freeze({
  REQUESTED: "requested",
  RESERVED: "reserved",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  RETRY_REQUIRED: "retry_required",
  RECONCILIATION_REQUIRED: "reconciliation_required",
  CANCELLED: "cancelled",
});

export const WITHDRAWAL_TRANSITIONS = Object.freeze({
  requested: ["reserved", "failed", "cancelled"],
  reserved: ["processing", "failed", "retry_required", "cancelled"],
  processing: ["completed", "failed", "reconciliation_required"],
  completed: ["reconciliation_required"],
  failed: ["retry_required", "reconciliation_required"],
  retry_required: ["reserved", "processing", "reconciliation_required", "cancelled"],
  reconciliation_required: ["completed", "failed", "retry_required"],
  cancelled: [],
});

export const assertWithdrawalTransition = (from, to) => {
  if (from === to) return true;
  if (!(WITHDRAWAL_TRANSITIONS[from] || []).includes(to)) {
    const error = new Error(`Invalid withdrawal state transition: ${from} -> ${to}`);
    error.statusCode = 409;
    throw error;
  }
  return true;
};

export const appendWithdrawalTransition = (withdrawal, to, { actorId = null, source = "system", reason = null } = {}) => {
  const from = withdrawal.status || WITHDRAWAL_STATES.REQUESTED;
  assertWithdrawalTransition(from, to);
  if (from !== to) {
    withdrawal.status = to;
    withdrawal.stateHistory = withdrawal.stateHistory || [];
    withdrawal.stateHistory.push({ from, to, actorId, source, reason, at: new Date() });
  }
  return withdrawal;
};
