# PHASE 2 — NOTIFICATION REALTIME CLOSURE

## Scope

Closed only the notification lifecycle `eventKey` defect requested for Phase 2. No Phase 3 work and no redesign of notifications, Socket.IO, Brevo, authentication, doctor approval, or Phase-1 verification.

## Defect Found

Doctor lifecycle notification keys were stable for the lifetime of a doctor:

- `doctor-application:<doctorId>`
- `verification:<doctorId>:<status>`

Because `NotificationDelivery` enforces a unique `(recipientId,eventKey)` index, a later application/re-verification cycle could be incorrectly suppressed.

## Implementation

### 1. Persisted lifecycle cycle identity

No second application model was introduced and no new timestamp-based retry identity was created.

The existing persisted `Doctor.verificationHistory` is used as the cycle source. Each transition into `pending` already creates a persisted history subdocument with its own MongoDB `_id`. The latest persisted `pending` history entry is therefore the cycle identity.

A small shared helper was added:

- `backend/utils/verificationCycle.js`
  - `getVerificationCycleId(doctor)`
  - `buildVerificationEventKey(...)`

For legacy pending records with no pending history entry, the helper deterministically falls back to the persisted doctor `_id` for that existing cycle. New pending cycles always receive a new persisted history `_id`.

No `Math.random()` and no retry-time timestamp is used.

### 2. New doctor application key

Changed from:

`doctor-application:<doctorId>`

to:

`doctor-application:<doctorId>:<cycleId>`

The onboarding submission uses the newly persisted pending history entry as the cycle identity.

### 3. Doctor verification key

Changed from:

`verification:<doctorId>:<status>`

to:

`verification:<doctorId>:<cycleId>:<status>`

Approval and rejection resolve the cycle from the existing pending history entry before adding their terminal history record. Therefore approval/rejection retries for the same cycle retain the same key.

Credential changes that move an approved doctor back to `pending` create a new pending history entry, producing a new cycle ID.

### 4. Realtime verification caller

`practiceEmitter.verificationStatusChanged` now requires the persisted cycle identity and constructs the cycle-scoped verification event key. Existing Socket.IO delivery remains unchanged.

### 5. Notification idempotency index

The existing unique index remains unchanged:

`(recipientId,eventKey)` unique/sparse.

It was not weakened or removed.

## Caller Audit

Updated lifecycle callers:

- doctor onboarding submission
- approved-doctor credential re-verification
- SUPER_ADMIN approval
- SUPER_ADMIN rejection
- doctor verification realtime notification

Repository search confirmed the old doctor lifecycle formats are no longer active in those callers.

## Regression Tests Added

`backend/tests/notificationLifecycleIdempotency.test.mjs`

It verifies:

1. First application gets a cycle-scoped admin key.
2. Retrying the same cycle resolves to the same key.
3. First rejection uses the first cycle.
4. Resubmission resolves to a new cycle.
5. Second rejection uses a new cycle key.
6. Approval remains stable for retries within the same cycle.
7. Approval in a later cycle gets a different key.
8. Lifecycle event identities remain distinct per cycle/status.
9. The existing unique `(recipientId,eventKey)` index remains present.
10. The old verification key format is absent from `practiceEmitter`.

The test uses deterministic persisted-ID-shaped values and the actual shared cycle/key helper; it does not generate random identities.

## Tests Actually Executed

### PASS

- `notificationLifecycleIdempotency.test.mjs`
- `notificationPhase2Contract.test.mjs`
- `phase1AdminRegistrationEmail.test.mjs`
- `phase1AuthContract.test.mjs`
- `phase1OnboardingContract.test.mjs`
- `onboardingMassAssignment.test.mjs`
- `doctorApprovalConcurrencyRace.test.mjs` — 4/4 subtests passed
- `emailVerificationConcurrency.test.mjs` — 1/1 subtest passed
- `node --check` for all modified JavaScript files

### Full backend suite

Executed `npm test`.

Result:

- 64 passed
- 43 failed
- 107 total

The failing tests are environment/dependency related in this supplied repository environment. Representative failures report:

`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'mongoose'`

The full suite is therefore **not claimed as passing**.

### Frontend validation

Attempted:

- `npm run lint`
- `npm run build`

Neither could execute because the supplied environment has no usable installed frontend executables:

- `eslint: not found`
- `vite: not found`

These are **not claimed as passing**.

## Remaining Environment Limitations

The repository archive does not contain a usable installed dependency environment. Full integration execution requiring MongoDB/Mongoose-backed modules and frontend tool binaries could not be completed here.

No production behavior was mocked or faked to compensate.

## Files Changed

- `backend/utils/verificationCycle.js`
- `backend/realtime/practiceEmitter.js`
- `backend/controllers/doctorOnboardingController.js`
- `backend/controllers/doctorController.js`
- `backend/tests/notificationPhase2Contract.test.mjs`
- `backend/tests/notificationLifecycleIdempotency.test.mjs`
- `docs/PHASE-2-NOTIFICATION-REALTIME-CLOSURE.md`
