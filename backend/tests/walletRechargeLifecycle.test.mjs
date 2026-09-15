// P23 Bug 2 — wallet recharge fake-success lifecycle fix. Pure-logic tests
// against walletRechargeStateMachine.js, matching this codebase's
// established dependency-free test convention (no live Mongo).
import assert from "assert";
import {
  WALLET_RECHARGE_STATUS,
  assertWalletRechargeTransition,
  appendWalletRechargeTransition,
} from "../payments/walletRechargeStateMachine.js";

// --- The core fix: signature-valid alone is never a legal path straight
// to "posted". Capture must always be an explicit, validated hop. ---
{
  assert.throws(
    () => assertWalletRechargeTransition(WALLET_RECHARGE_STATUS.CREATED, WALLET_RECHARGE_STATUS.POSTED),
    /Invalid wallet recharge state transition/,
    "created must never jump directly to posted — this is exactly the bug that let a signature check alone credit the wallet",
  );
  console.log("PASS: created -> posted is not a legal direct transition");
}

// --- The real-world path this bug fix enables: order_created -> captured
// (browser goes straight from checkout success to the verify call, with no
// server round-trip in between) -> posted. ---
{
  assert.doesNotThrow(() => assertWalletRechargeTransition(WALLET_RECHARGE_STATUS.ORDER_CREATED, WALLET_RECHARGE_STATUS.CAPTURED));
  assert.doesNotThrow(() => assertWalletRechargeTransition(WALLET_RECHARGE_STATUS.CAPTURED, WALLET_RECHARGE_STATUS.POSTED));
  console.log("PASS: order_created -> captured -> posted is the legal happy path");
}

// --- Failure/pending/cancelled states are all real destinations from an
// open recharge — never silently dropped or coerced into a false success. ---
{
  for (const to of [WALLET_RECHARGE_STATUS.FAILED, WALLET_RECHARGE_STATUS.CANCELLED, WALLET_RECHARGE_STATUS.EXPIRED, WALLET_RECHARGE_STATUS.PENDING]) {
    assert.doesNotThrow(() => assertWalletRechargeTransition(WALLET_RECHARGE_STATUS.ORDER_CREATED, to), `order_created -> ${to} must be reachable`);
  }
  console.log("PASS: every real provider failure/pending/cancel outcome is a reachable, distinct state");
}

// --- A mismatched amount/currency/order must route to reconciliation, not
// a blind credit and not a false "failed". ---
{
  assert.doesNotThrow(() => assertWalletRechargeTransition(WALLET_RECHARGE_STATUS.PENDING, WALLET_RECHARGE_STATUS.RECONCILIATION_REQUIRED));
  assert.doesNotThrow(() => assertWalletRechargeTransition(WALLET_RECHARGE_STATUS.RECONCILIATION_REQUIRED, WALLET_RECHARGE_STATUS.CAPTURED));
  console.log("PASS: reconciliation_required is reachable and recoverable back to captured once resolved");
}

// --- posted is a genuine terminal state for normal flow (only reachable
// destination is reconciliation, for exceptional after-the-fact review). ---
{
  assert.throws(() => assertWalletRechargeTransition(WALLET_RECHARGE_STATUS.POSTED, WALLET_RECHARGE_STATUS.CAPTURED));
  console.log("PASS: posted cannot be re-captured — no double-credit path through the state machine");
}

// --- appendWalletRechargeTransition records real history, not a
// fabricated one, and is a no-op (not an error) for from === to (idempotent
// duplicate calls). ---
{
  const recharge = { status: WALLET_RECHARGE_STATUS.ORDER_CREATED, stateHistory: [] };
  appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.CAPTURED, { source: "patient", reason: "test" });
  assert.strictEqual(recharge.status, WALLET_RECHARGE_STATUS.CAPTURED);
  assert.strictEqual(recharge.stateHistory.length, 1);
  assert.strictEqual(recharge.stateHistory[0].from, WALLET_RECHARGE_STATUS.ORDER_CREATED);

  appendWalletRechargeTransition(recharge, WALLET_RECHARGE_STATUS.CAPTURED, { source: "patient", reason: "duplicate call" });
  assert.strictEqual(recharge.stateHistory.length, 1, "a duplicate call to the same state must not fabricate a second history entry");
  console.log("PASS: transition history is accurate and duplicate same-state calls are idempotent no-ops");
}

console.log("All walletRechargeLifecycle tests passed.");
