# Phase 01 — Payment core, state machine & webhook integrity

Date 2026-10-14 · Base: `MediCore-HMS-PHASE-00-FOUNDATION-2026-10-13.zip` · Tests 172 -> **175/175**, eslint clean, build OK.

## Evidence statuses (honest)
| Item | Status |
|---|---|
| N-030 failed-webhook downgrade | IMPLEMENTED + LOCALLY_VERIFIED |
| N-031 canonical CAS transitions | IMPLEMENTED + LOCALLY_VERIFIED |
| N-032 attempt correlation / old-order capture | IMPLEMENTED + LOCALLY_VERIFIED |
| N-033 retry races / orphan orders | IMPLEMENTED + LOCALLY_VERIFIED |
| N-034 one active payment per appointment | IMPLEMENTED + LOCALLY_VERIFIED; unique index + migration 012 **BLOCKED_EXTERNAL** (no mongod) |
| N-035 webhook lifecycle / recovery | IMPLEMENTED + LOCALLY_VERIFIED |
| N-036..N-039 | IMPLEMENTED + LOCALLY_VERIFIED |
| Any item | INTEGRATION_VERIFIED / PRODUCTION_VERIFIED: **none** |

"LOCALLY_VERIFIED" = in-memory model layer (`tests/helpers/memoryModels.mjs`) that evaluates the real filters/updates and yields between every read and write, so interleavings are real, but MongoDB's own atomicity and index enforcement are not exercised. Not run: `tests/mongo/phase01.mongo.test.mjs`, Razorpay sandbox, browser E2E, Docker/CI.

## Tests executed
`npm --prefix backend test` 175 passed / 0 failed. New: `phase01PaymentCore` (53 checks: state machine, webhook failed/captured, old-order capture, late capture after failure, crash recovery, stale workers, retries, slot uniqueness, migration 012 logic, browser verify), `phase01CheckoutRecovery` (9), `phase01Contracts`. Mutation check: removing the capture-protection guard or the stale-attempt guard makes tests fail.

## Operator runbook
1. `npm run migrate:payment-slot -- --dry-run` on a production copy. Exit 2 lists every payment id of each appointment with several active payments: resolve through the admin refund/cancel flow (never delete). Nothing is written while blocked.
2. `npm run release` (012 then 011). 3. `npm run verify:indexes` must show `uniq_payment_active_appointment`. 4. Confirm the `recoverPaymentEvents` heartbeat.
Rollback: the new fields are additive; the code works without the index (an app-level active-payment check also exists). Reverting the code leaves `activeAppointmentSlot` unused.

## Remaining Phase 01 risks
* Provider orders are not closed after a retry; an old order stays payable. Handled (captured on its attempt, second capture -> reconciliation) but not prevented.
* A capture on a payment whose appointment was fulfilled by a different payment still runs the invoice step (pre-existing behaviour); refund routing for `captureEvidence` duplicates is manual (flagged `reconciliationState=required`, visible to the existing reconciliation report).
* Controller post-processing internals (invoice/payout/ledger) were not individually crash-injected; they were already idempotent in earlier slices.
* Subscription handlers still use read-modify-save. Historical stored webhook payloads still contain provider PII.
* Frontend verified by pure-logic and source-contract tests only.
* `uniq_payment_active_appointment` is not marked critical in readiness checks (app-level guard exists); consider promoting it after P1-G5 passes in production.

## Next: Phase 02
Wallet reservations, wallet-only checkout atomicity, split-payment atomicity/recovery (wallet + gateway), wallet recharge idempotency, coupon reservation safety. Phase 02 should also wire the `captureEvidence`/duplicate-capture cases into an explicit admin resolution (refund or accept) flow.
