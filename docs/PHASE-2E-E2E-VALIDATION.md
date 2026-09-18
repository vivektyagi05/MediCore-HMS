# Phase 2-E — E2E Validation Status

Legend: LIVE PASS | AUTOMATED PASS | FIXED + PASS | BLOCKED BY EXTERNAL PROVIDER | NOT YET TESTED

## 0. Environment constraint
This pass was run in a sandboxed container with no reachable MongoDB, no
Brevo/Razorpay credentials, no browser, and a network allowlist that blocks
`fastdl.mongodb.org` (so `mongodb-memory-server` cannot fetch a real mongod
binary here). Every item below is either a static/automated finding or is
marked NOT YET TESTED / BLOCKED — nothing here was rubber-stamped from
source-reading alone.

## 1. Withdrawal contract defect — FIXED + PASS
- Defect: `src/api/withdrawalApi.js` called `/doctor/withdrawals/*`
  (singular); `doctorRoutes.js` owning those 4 routes is mounted at
  `/api/doctors` (plural) in `app.js`. Every doctor-side withdrawal call
  404'd.
- Root cause: frontend client mismatched the canonical mount.
- Fix: changed the 4 calls to `/doctors/withdrawals/*`. No duplicate routes
  added.
- Verified: `getWithdrawalDetail` and `computeDoctorWithdrawableBalance` are
  both correctly scoped/authoritative server-side (checked directly against
  source) — cross-doctor withdrawal-ID access returns 404, balance is never
  client-supplied.
- Remaining limitation: not exercised against a live server/browser (no DB
  in this environment) — code-level fix + IDOR/authority check only.

## 2. Frontend ↔ backend contract sweep (item 11) — AUTOMATED PASS
- Method: parsed every `app.use()` mount, every `router.<method>()` across
  18 route files (523 registered routes), and every `apiClient.<method>()`
  call across 30 `src/api/*.js` files (526 calls), resolving `${BASE}`
  constants and template params.
- Result: 0 forward mismatches (frontend→backend) after the withdrawal fix.
- 5 backend routes have no frontend caller — see item 3.

## 3. Orphan backend APIs / dead frontend controls — FIXED (partial) + NOT YET TESTED
- `PUT /api/doctor/prescriptions/:id` — implemented correctly and safely
  (ownership-scoped to `doctorId`) but no "edit prescription" control exists
  anywhere in the doctor UI. Feature gap, not a bug.
- `PUT /api/doctor/leaves/:id/status` — real, non-trivial logic (approving
  blocks every date in the leave range on the doctor's calendar) gated to
  SUPER_ADMIN, but **no admin page anywhere calls it** — grepped the entire
  admin frontend, zero references to leave requests. Doctors can submit
  leave requests that can never be approved or rejected through the product.
  This is a genuinely incomplete exposed feature per the brief's definition.
- `GET /api/finance/payouts` + `PATCH /api/finance/payouts/:id/settle` —
  superseded by the withdrawal domain; likely safe to delete rather than
  wire up.
- `GET /api/admin/process/graphs/all` — orphaned, not investigated further.
- Not fixed: building the missing admin leave-approval UI is a feature
  build, not a bug fix — flagging for a decision rather than doing it
  unprompted.

## 4. Booking / double-booking (item 4) — AUTOMATED PASS (partial)
- `Appointment` has a real unique compound index
  `{doctorId, date, timeSlot}` with a partial filter over the full
  `ACTIVE_STATUSES` lifecycle (not just pending/approved) — this is the
  actual concurrency guarantee, not just the pre-check.
- `createAppointment` catches Mongo `E11000` and converts it to a
  controlled 409, not a 500.
- `slotEngine.test.mjs` (dependency-free) passed 99/99 alongside the rest
  of the suite, covering slot generation/derivation logic.
- NOT YET TESTED: an actual concurrent-request race against a live DB
  (blocked, no reachable Mongo here).

## 5. Refund IDOR (item 7) — AUTOMATED PASS (partial)
- `getRefundRequestDetail` checks `isOwner || isAdmin` and 403s otherwise.
  Verified directly in source.
- Existing regression tests (`refundConcurrencyAndStateMachine`,
  `refundAdminTransitionIntegrity`, `refundStateMachineValidatedTransitions`,
  `refundPolicyEngine`, `refundReasonCanonicalization`) all pass.
- NOT YET TESTED live: Razorpay is unreachable here, so real
  gateway-refund flows are BLOCKED BY EXTERNAL PROVIDER.

## 6. Backend test suite — AUTOMATED PASS
- `npm test` (99 dependency-free unit/contract tests): 99/99 passed,
  including doctor access control, mass-assignment guards, approval
  concurrency race, follow-up scheduling concurrency, payment status guard,
  payment window expiry, review rating, SLA aggregates.
- `tests/doctorApproveBodyContract.test.js` (vitest + supertest): passed —
  covers no-body/malformed-body approve requests, 404 for nonexistent
  doctor, 401 without auth.
- `tests/api.test.js` (vitest + `mongodb-memory-server`, real DB):
  BLOCKED — cannot download the mongod binary in this sandbox
  (`fastdl.mongodb.org` unreachable, 403). 5 tests skipped as a result,
  including the live double-booking and RBAC-filtered-appointment-list
  assertions.

## 7-13 (Clinical, Payment/Refund gateway, Super Admin, Public, Realtime,
Contract sweep beyond item 11, Regression/full E2E) — NOT YET TESTED
- Spot-checked clinical prescription/note creation: both properly scoped to
  `doctorId` + appointment ownership, both gate on appointment status
  (can't create before consultation completes). No defect found in the
  code paths inspected.
- Everything requiring a live server, browser, session cookies/JWT
  round-trips, sockets, Razorpay, or Brevo is NOT YET TESTED in this
  environment and should not be marked PASS on source-reading alone.
