import { WALLET_RECHARGE_STATUS } from "../models/WalletRecharge.js";

// Mirrors paymentStateMachine.js's transition-table pattern exactly
// (Section 30 — do not invent a differently-shaped state machine for a
// sibling financial domain). See Section 4 of the P23 brief for the
// required lifecycle:
//   created -> order_created -> checkout_started -> pending
//     -> verification_pending -> captured -> posted
//   failure branches: failed, cancelled, expired, reconciliation_required
export const WALLET_RECHARGE_TRANSITIONS = Object.freeze({
  created: ["order_created", "cancelled", "expired"],
  // "captured" is reachable directly from order_created: in practice the
  // browser goes straight from opening Razorpay checkout to receiving the
  // success callback and calling verify — there is no separate server
  // round-trip in between to mark "checkout_started" first.
  order_created: ["checkout_started", "pending", "captured", "failed", "cancelled", "expired", "verification_pending"],
  checkout_started: ["pending", "captured", "failed", "cancelled", "expired", "verification_pending"],
  pending: ["verification_pending", "captured", "failed", "cancelled", "expired", "reconciliation_required"],
  verification_pending: ["captured", "failed", "reconciliation_required"],
  captured: ["posted", "reconciliation_required"],
  posted: ["reconciliation_required"],
  failed: ["order_created", "cancelled", "expired", "reconciliation_required"],
  cancelled: ["order_created"],
  expired: ["order_created", "reconciliation_required"],
  reconciliation_required: ["pending", "captured", "posted", "failed"],
});

export const assertWalletRechargeTransition = (from, to) => {
  if (from === to) return true;
  if (!(WALLET_RECHARGE_TRANSITIONS[from] || []).includes(to)) {
    const error = new Error(`Invalid wallet recharge state transition: ${from} -> ${to}`);
    error.statusCode = 409;
    throw error;
  }
  return true;
};

export const appendWalletRechargeTransition = (recharge, to, { actorId = null, source = "system", reason = null } = {}) => {
  const from = recharge.status;
  assertWalletRechargeTransition(from, to);
  if (from === to) return recharge;
  recharge.status = to;
  recharge.stateHistory = recharge.stateHistory || [];
  recharge.stateHistory.push({ from, to, actorId, source, reason, at: new Date() });
  return recharge;
};

export { WALLET_RECHARGE_STATUS };
