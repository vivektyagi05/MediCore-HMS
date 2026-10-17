# Phase 02 — Final Closure Report

**Verdict: Phase 02 is IMPLEMENTATION-COMPLETE LOCALLY. It is NOT integration-verified and NOT production-ready.**
Every blocker that remains is external (no `mongod`, no Razorpay sandbox credentials, no browser E2E environment in the authoring sandbox). No Phase 03 work is in this closure.

## 1. Verification performed (exact commands, exit codes, counts)
Environment for all backend commands: `MONGO_URI=mongodb://x/test JWT_SECRET=x NODE_ENV=test` (no database is contacted; `bufferCommands=false` makes any un-faked DB call fail fast).

| Command (from repo root unless noted) | Exit | Result |
|---|---|---|
| `cd backend && npm test` | 0 | **185 passed, 0 failed (185 files)** — was 175 at Phase 01, 179 at first Phase 02 report |
| `npx eslint backend src` | 0 | clean |
| `npm run build` | 0 | Vite production build OK |
| `cd backend && npm run test:mongo` | 0 | all four real-Mongo suites printed **SKIP** (no `MONGODB_TEST_URI`) — **not evidence of anything** |
| `node tests/phase01PaymentCore.test.mjs` | 0 | 53/53 (Phase 01 regression, run on the extended test helper) |
| `node tests/walletReservation.test.mjs` | 0 | 19 checks |
| `node tests/walletRechargeIdempotency.test.mjs` | 0 | 12 checks |
| `node tests/phase02Recovery.test.mjs` | 0 | 13 checks |
| `node tests/phase02CrashMatrix.test.mjs` | 0 | 25 checks (real controllers/services, faked provider) |
| `node tests/captureResolution.test.mjs` | 0 | 8 checks |
| `node tests/captureCasesHttp.test.mjs` | 0 | 5 checks (real express router + JWT + middleware) |
| `node tests/captureCaseDisplay.test.mjs` | 0 | 6 checks (frontend display logic, no UI runtime) |
| `node tests/financialAuthorization.test.mjs` | 0 | 7 checks (route sweep, reservation admin HTTP, money inputs) |
| `node tests/phase02Indexes.test.mjs` | 0 | 5 checks (index inventory, no DB connection) |
| `node tests/walletPrecisionAudit.test.mjs` | 0 | 6 checks |

Phase 00 tests are part of the 185 and pass. The repository has no frontend test runner; the capture-case UI is verified by lint + production build + the pure-logic test above. **The page was never rendered in a browser.**
Migration/index checks that do not mutate anything: inventory built offline (`phase02Indexes`); `011` was not run against a database.

## 2. Findings and statuses
| ID | Finding | Status |
|---|---|---|
| N-P2-01 | Wallet double-spend: reservation (`Wallet.holds`, atomic conditional hold) | LOCALLY_VERIFIED (real-Mongo race test written, not run) |
| N-P2-02 | Capture followed by wallet debit failure | LOCALLY_VERIFIED |
| N-P2-03 | Wallet-only crash windows + ambiguous-debit handling | LOCALLY_VERIFIED |
| N-P2-04 | Recharge pipeline, webhook, late capture, recovery | LOCALLY_VERIFIED |
| N-P2-05 | Coupon orphan recovery, evidence-gated release | LOCALLY_VERIFIED (coupon *concurrency* needs `$expr`: real Mongo only → not locally testable) |
| N-P2-06 | Holds/coupons of unpayable appointments released | LOCALLY_VERIFIED |
| N-P2-07 | Capture-case resolution API + **SUPER_ADMIN workspace UI** | API LOCALLY_VERIFIED; UI IMPLEMENTED (built, linted, display logic tested, **not browser-verified**) |
| **N-P2-08** | **NEW defect fixed:** recharge verify/cancel/status used whole-document `save()` on a possibly stale document and could overwrite a concurrent webhook's captured/posted state | LOCALLY_VERIFIED (regression test) |
| **N-P2-09** | **NEW defect fixed:** concurrent duplicate checkout submissions each opened their own provider order (3 orders for 1 payment) | LOCALLY_VERIFIED (regression in crash matrix). Duplicates now get 409 `PAYMENT_CREATION_IN_PROGRESS` with no provider call; frontend handles it |
| **N-P2-10** | **NEW defect fixed:** recharge amounts accepted `Infinity`/>2 decimals (stored amount could differ from provider paise) | LOCALLY_VERIFIED |
| N-P2-11 | `Wallet.balance` is a rupee **float** | **NOT_FIXED (documented, intentional)** — see §4 |
| N-P2-12 | No UI for `recovery_required` wallet reservations (API + audit exist) | NOT_FIXED (UI); API LOCALLY_VERIFIED |
| N-P2-13 | Coupon `usedBy[]` serves as reservation and redemption record | NOT_FIXED (documented limit) |
| F-018 | Wallet-only checkout | LOCALLY_VERIFIED |
| — | Real MongoDB behaviour of every atomic update / unique index | **BLOCKED_EXTERNAL** |
| — | Razorpay sandbox behaviour | **BLOCKED_EXTERNAL** |
| — | Browser E2E of checkout, wallet, capture-case page | **BLOCKED_EXTERNAL** |

## 3. What the application-path matrix (new) proves — and does not
`tests/phase02CrashMatrix.test.mjs` drives the real `createPaymentOrder`, `verifyPayment`, Razorpay webhook handler, `debitWalletForPayment`, recharge controllers and recovery jobs and asserts persisted payment state, wallet balance, active holds, ledger idempotency, appointment state and provider-order count. Covered: gateway order created + persistence failure; capture + commit failure; ledger failure after debit; webhook ‖ verify race; crash before appointment completion; late capture after cancel/release; ambiguous release refusal; failed-then-captured; wallet-only (success, completion crash, concurrent spend, cap); coupon claim then Payment failure; orphan coupon; recharge (binding failure, ledger failure, final-status failure, race, late capture, wrong amount); recovery worker crash / lost lease / completed-operation re-run.
**Limits (stated plainly):** the provider is a mock (not Razorpay evidence); appointment completion inside post-processing is a stand-in (the real invoice/payout/notification fan-out is not exercised in these tests; the wallet commit and ledger step inside it are the real code); the model layer is in-memory, so MongoDB's own atomicity/index semantics are untested.

## 4. Monetary and authorization audit
* Allocation is server-authoritative: split computed from **available** balance, client amount only ever lowers it; verified by tests including `Infinity`, `1e12`, negative.
* `Wallet.balance` float: all spend comparisons are integer paise (`$round(balance*100)`), holds are integer paise, amounts are validated ≤2 decimals, so drift cannot cause an overspend or a mismatch. **Remaining risk:** repeated `$inc` of doubles can accumulate IEEE error below 1e-6 rupee; display could theoretically show 0.30000000000000004. **Why not changed now:** converting to integer paise (or `Decimal128`) is a data migration of every wallet plus every reader/writer; doing it silently or untested against real data would be riskier than the bounded drift. **Requirement before changing:** a reviewed migration with a rollback plan, run on a copy, using the read-only `npm run audit:wallet-precision` (new, never writes) to size the problem first.
* Authorization: static test sweeps every refund/wallet/finance/payment/admin-payment route for `protect` + role/permission gate and for roles outside the three allowed. Capture-case and reservation admin endpoints are SUPER_ADMIN-only at the router (`protect`+`requireAdmin`+`manage_payments`) **and** in the service; patients/doctors/anonymous get 401/403 and nothing changes.
* Record-only guarantee: resolving a capture case or reservation never refunds, credits, pays out or edits the ledger (asserted). `refund_required` only records the decision.
* Ambiguous capture cannot trigger release (`paymentAllowsRelease`, cleanup sweep): tested.

## 5. Exact next integration commands (not run here)
```
# 1. disposable MongoDB (name MUST contain "test"; the script DROPS the database)
export MONGODB_TEST_URI="mongodb://localhost:27017/hms_phase02_test"
cd backend && npm run test:mongo                       # Phase 00 + 01 + 02 real-Mongo suites
# 2. real index build + report (staging only, after a backup)
node migrations/011_ensure_production_indexes.js --dry-run --json
node migrations/011_ensure_production_indexes.js --json
# 3. read-only wallet precision inventory (copy or secondary)
MONGO_URI=... npm run audit:wallet-precision
# 4. Razorpay sandbox: create a split order, pay, verify webhook + browser race, recharge with a test card, duplicate payment
```
Then browser E2E of `/patient/payments/:appointmentId`, wallet recharge, and `/admin/capture-cases`.

## 6. Unresolved
Everything in §2 marked BLOCKED_EXTERNAL or NOT_FIXED. No unresolved *known local code defect* remains. Phase 03 starts from this baseline: refund finalization, balance↔ledger reconciliation report, separate coupon redeemed state, durable financial events, wallet integer-paise migration, reservation-review UI.
