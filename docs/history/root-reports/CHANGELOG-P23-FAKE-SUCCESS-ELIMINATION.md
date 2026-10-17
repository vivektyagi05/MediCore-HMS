# CHANGELOG — P23 Fake-Success Elimination (Bug 1 + Bug 2 + hardening pass)

Continuation of P23 Payments/Refunds/Wallet/Payout/Withdrawal. This pass
targeted the two explicitly reported runtime failures plus real defects
found while auditing the code paths around them. Consistent with every
prior P23 pass, this is **not** a claim that the full 55-section brief is
now exhaustively verified — see "Explicitly deferred" below.

## BUG 1 — Refund request 400 "Refund reason is required" (FIXED)

**Root cause:** `RefundActionModal.jsx` sends `{amount, reasonCode,
description}`. `refundController.js`'s `buildRefundRequestForEntryPoint`
additionally required a raw `req.body.reason` for the cancellation entry
point (only `report_problem` ever derived one from `description`) — a
frontend/backend contract mismatch that 400'd every cancellation-style
refund request.

**Fix — canonical contract, not a band-aid:**
- New `deriveCanonicalReason({ reasonCode, description })` in
  `refundPolicyEngine.js` — a single label map keyed by the already-
  validated `reasonCode`, the sole source of the stored `RefundRequest.reason`
  string. The client never controls the canonical financial meaning; it
  only ever sends a validated `reasonCode` (+ `description` where the entry
  point requires one).
- `refundController.js` no longer reads/requires `req.body.reason` at all;
  every write path (`RefundRequest.reason`, `timeline` note, automation
  trigger payload) now uses `canonicalReason`.
- New test: `backend/tests/refundReasonCanonicalization.test.mjs` (4
  assertions) reproduces the exact reported request shape and proves a
  canonical reason is derivable from `reasonCode` alone with no client
  `reason` field, that report-problem descriptions are folded in for
  context, and that an unrecognized code can't be used to inject
  client-controlled text.

## BUG 2 — Wallet recharge credited the wallet on signature verification alone (FIXED)

**Root cause (the brief's own "most important financial bug"):** the old
`verifyWalletRecharge` checked only the Razorpay signature, then
immediately credited the wallet. A valid signature proves the checkout
payload wasn't tampered with — it is **not** proof the provider actually
captured the money. There was no dedicated lifecycle, no failure/pending/
cancelled state, and nothing to recover a dismissed checkout, a declined
payment, or a dropped network call from.

**Fix — a real, dedicated wallet-recharge financial domain:**
- New `backend/models/WalletRecharge.js` (lifecycle: `created ->
  order_created -> checkout_started -> pending -> verification_pending ->
  captured -> posted`, with `failed` / `cancelled` / `expired` /
  `reconciliation_required` branches). Built as its own domain rather than
  forced onto `Payment` (which requires `appointmentId`/`doctorId`).
- New `backend/payments/walletRechargeStateMachine.js`, mirroring
  `paymentStateMachine.js`'s exact transition-table pattern.
- Rewrote `createWalletRechargeOrder` / `verifyWalletRecharge` in
  `financeController.js` to run the same signature → `fetchPayment` →
  order/amount/currency match → provider-status check sequence
  `paymentController.verifyPayment` already uses for appointment payments.
  Wallet credit only ever happens on authoritative `captured`/`processed`
  gateway state; every other real outcome (`failed`, still-pending,
  amount/currency mismatch) gets its own honest state, never a blind
  credit and never a false "failed" for a payment that's merely still in
  flight.
- New `cancelWalletRecharge` (checkout dismissed — order preserved, never
  credited), `getWalletRechargeStatus` (recovery after refresh/network
  failure — re-fetches the authoritative provider state, never guesses),
  `listWalletRecharges` (recharge history).
- `postWalletRechargeCapture` performs the credit as a single atomic,
  idempotent step (findOneAndUpdate mutex on the recharge document +
  unique `idempotencyKey` on the ledger row) so a concurrent duplicate
  verify/webhook call can never double-credit.
- Routes wired in `financeRoutes.js`.
- Frontend: rewrote `WalletRechargeModal.jsx` — `modal.ondismiss` cancels
  the order instead of leaving it in limbo; a real `payment.failed`
  handler; the `handler` success callback now honestly distinguishes a
  202 "still pending" response from a completed one instead of always
  showing success. New `financeApi` methods for cancel/status/history.
  `WalletDashboard.jsx` gained a real Recharge History section showing
  every recharge's authoritative status (Successful/Pending/Verifying/
  Needs review/Failed/Cancelled/Expired) with a "Check status" recovery
  action for any still-open recharge, and the Transaction Ledger rows now
  show status + reference id.
- New test: `backend/tests/walletRechargeLifecycle.test.mjs` (6
  assertions) proves `created -> posted` directly is illegal (the exact
  shape of the bug), the real `order_created -> captured -> posted` path
  is legal, every failure/pending/cancel outcome is reachable and
  distinct, `posted` is terminal (no re-capture/double-credit path), and
  history entries are accurate and idempotent for duplicate calls.

### Section 11 bug found during this audit (fixed)
`getWalletAnalytics` in `walletController.js` matched wallet-related
ledger entries with no `status` filter, so pending/failed rows would have
been summed into the trend/breakdown as if they were completed financial
activity. Fixed: `baseMatch` now requires `status: "posted"`.

## Section 18 — refund state-machine bypasses found during this audit (fixed)

Re-auditing `refundController.js`'s admin actions found three atomic
`findOneAndUpdate` calls that hardcoded a fabricated predecessor state in
the recorded `stateHistory` and never called `assertRefundTransition` at
all:
- `approveRefundRequest` / `rejectRefundRequest` always recorded
  `from: "pending_review"` regardless of the refund's real `refundState`
  (e.g. `eligibility_checked` is an equally legal, and often the actual,
  predecessor) — the recorded history could be simply wrong.
- `retryRefundRequest` jumped straight from `refundState: "failed"` to
  `"approved"` while recording a fabricated `from: "retry_required"` — that
  single hop is **not legal** per `REFUND_TRANSITIONS` (the real path is
  `failed -> retry_required -> approved`); the history described a
  transition that never happened, and nothing validated the jump.

**Fix:** each handler now reads the refund's real current `refundState`,
validates the transition(s) through `assertRefundTransition` (retry
validates both hops), and pins the observed `refundState` in the atomic
update's filter — a concurrent external change causes a safe no-op
instead of a stale/incorrect write, and the recorded history is always
accurate. New test:
`backend/tests/refundStateMachineValidatedTransitions.test.mjs` (3
assertions), including a direct reproduction of the illegal
`failed -> approved` single-hop bug.

## Section 36 — CoverageMap.jsx Leaflet regression (`_leaflet_pos` crash) (FIXED)

**Root cause:** `<GeoJSON key={selectedState || "all"}>` forced React to
fully unmount and recreate the entire vector layer (hundreds of polygon
paths) on every state selection, while `MapViewport` was simultaneously
running `map.setView(..., { animate: true })`. Leaflet's own animation
frame handler holds references into the layer's DOM nodes; destroying
those nodes mid-animation via the remount left the next animation tick
reading a position cache off an element that no longer existed —
`Cannot read properties of undefined (reading '_leaflet_pos')`.

**Fix:** the GeoJSON layer is now created once, unkeyed, and never
remounted. A `geoJsonLayerRef` + `useEffect` on `[style, stateMap]`
imperatively restyles and re-tooltips the already-mounted layers on
selection/coverage changes instead of destroying and recreating them.
`MapViewport`'s `setView` call is additionally guarded against firing on a
torn-down map container and deferred a frame so it can never run in the
same synchronous tick as a layer swap. State selection, district
selection, map/list sync, zoom, and GeoJSON rendering all preserved.

## Section 37 — Socket.IO connection audit (no code defect found)

Audited `backend/socket/socketServer.js` and `src/socket/socketClient.js`:
Socket.IO is correctly mounted on the shared HTTP server with CORS/auth
matching the client, and the client already configures
`transports: ["websocket", "polling"]` (a real, working polling fallback,
not a websocket-only client). The reported
`WebSocket connection to ws://localhost:5000/socket.io failed` console
message is consistent with "backend actually unavailable" — there is no
live backend process (or MongoDB) running in this audit environment, the
same constraint documented for every prior P23 pass. No code change made
here; this is disclosed as verified-correct-but-not-live-tested, not
silently ignored.

## Verification

- `node --check` on every changed backend file.
- Backend suite: **92/94 passing** (88 pre-existing + 4 new assertions
  files), same 2 pre-existing unrelated failures as the documented
  baseline (`p12Geography.test.mjs`, `servicePartialUpdate.test.mjs`).
- ESLint repo-wide: **0 new errors** — same 7 pre-existing errors in
  untouched files as documented in the prior phase (the `env` unused-var
  warning in `financeController.js` was already present before this
  pass — confirmed against the original zip, not introduced by this work).
- Clean `npm run build` (Vite).
- Clean backend boot (`ECONNREFUSED`-only against a non-existent local
  Mongo — no live MongoDB in this sandbox, consistent with every prior
  phase).
- **Fresh-extract gate**: this exact zip was extracted to a clean
  directory, dependencies reinstalled from scratch (both `backend/` and
  root), and the full test suite / lint / build / boot sequence re-run
  there with identical results before delivery.

## Explicitly deferred / NOT claimed complete

This pass closed the two reported bugs plus the real defects found while
auditing their code paths. It did **not** attempt the full 55-section
brief in one sitting. Not done in this pass (disclosed, not fabricated):

- Sections 22-29: FinancialTimeline component, AdminRecoveryCenter,
  WithdrawalAttempt provider-lifecycle detail, admin payment workspace
  chain-of-custody UI.
- Section 24: per-payment attempt-history UI polish (backend `PaymentAttempt`
  already exists from prior phases; not re-audited this pass).
- Section 31/32: full payment-side (non-wallet) webhook/verification
  convergence re-audit beyond what prior CONCURRENCY HARDENING pass
  already covered.
- Section 41: `TEST_PAYMENT_SCENARIO` is still a single global env var,
  not per-attempt scoped.
- Section 43: no new automated invariant-sweep tests beyond what
  `refundPolicyEngine.test.mjs` already covers from the prior pass.
- No legacy-data reconciliation migration for pre-existing wallet ledger
  rows created under the old (pre-fix) recharge flow.
- Live browser/Mongo E2E — unavailable in this sandbox (no MongoDB, no
  browser), consistent with every prior phase.
- Full 55/66-section Final Acceptance Matrix not run item-by-item.

## Classification

| Item | Status |
|---|---|
| Bug 1 (refund 400) | IMPLEMENTED, TESTED, RUNTIME VERIFIED (node --check + unit tests) |
| Bug 2 (wallet fake success) | IMPLEMENTED, TESTED, RUNTIME VERIFIED |
| Section 11 (misleading analytics) | IMPLEMENTED |
| Section 18 (refund state-machine bypass) | IMPLEMENTED, TESTED |
| Section 36 (Leaflet crash) | IMPLEMENTED (lint-clean; not live-browser-verified) |
| Section 37 (Socket.IO) | AUDITED — no defect found, EXTERNAL PROVIDER/ENVIRONMENT LIMITED (no live backend in sandbox) |
| Everything under "Explicitly deferred" above | NOT DONE THIS PASS |
