// Phase 01 — checkout state is derived from BACKEND evidence only.
// The browser's own success/failure callback is a hint: it never decides what
// the patient is told. These helpers are pure (no React) so they can be tested.

/** Bounded backoff (ms) for re-reading authoritative state after an ambiguous outcome. */
export const CONFIRM_DELAYS_MS = Object.freeze([1500, 3000, 5000, 8000, 13000, 20000]);

/**
 * How to treat a failed POST /payments/verify.
 *  failed         the provider authoritatively reported failure (HTTP 402)
 *  reconciliation the backend recorded the payment for review (409 RECONCILIATION_REQUIRED)
 *  rejected       not this user's payment / unknown order: show the error, nothing to confirm
 *  ambiguous      timeout, network loss, 5xx, bad/unconfirmed signature, "verification pending":
 *                 money may have moved, so NEVER show a failure: re-read the backend.
 */
export const classifyVerifyFailure = (error) => {
  const status = error?.response?.status;
  const code = error?.response?.data?.details?.code;
  if (code === "PAYMENT_FAILED" || status === 402) return "failed";
  if (code === "RECONCILIATION_REQUIRED") return "reconciliation";
  if (status === 403 || status === 404) return "rejected";
  return "ambiguous";
};

/**
 * Maps the backend's /payments/status payload to a UI view.
 *  success | confirming | continue | reconciliation | failed | fresh
 */
export const deriveCheckoutView = (recovery) => {
  const state = recovery?.recoveryState;
  if (!state || state === "NONE") return "fresh";
  if (state === "SUCCESS") return "success";
  if (state === "REQUIRES_RECONCILIATION") return "reconciliation";
  if (state === "FAILED") return "failed";
  // PENDING: only offer to pay again when the backend says an unpaid order is
  // awaiting checkout and no verification is in flight.
  const verifying = recovery?.payment?.paymentState === "verification_pending" || recovery?.payment?.reconciliationState === "required";
  if (!verifying && recovery?.currentOrder) return "continue";
  return "confirming";
};

/**
 * Re-reads authoritative state with bounded backoff until it leaves PENDING.
 * Returns { state: "success"|"failed"|"reconciliation"|"unknown", data }.
 * "unknown" means the budget ran out while the backend was still PENDING; the UI
 * must say it is still confirming and must NOT claim success or failure.
 */
export const pollAuthoritativeStatus = async ({ fetchStatus, delays = CONFIRM_DELAYS_MS, sleep, shouldStop = () => false }) => {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last = null;
  for (let i = 0; i <= delays.length; i += 1) {
    if (shouldStop()) return { state: "unknown", data: last, stopped: true };
    try {
      const res = await fetchStatus();
      last = res?.data ?? null;
      const view = deriveCheckoutView(last);
      if (view === "success") return { state: "success", data: last };
      if (view === "failed") return { state: "failed", data: last };
      if (view === "reconciliation") return { state: "reconciliation", data: last };
      if (view === "fresh") return { state: "unknown", data: last };
    } catch {
      // network blip while confirming: keep trying within the bounded budget
    }
    if (i < delays.length) await wait(delays[i]);
  }
  return { state: "unknown", data: last };
};
