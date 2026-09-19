# Phase 2 — Notifications + Realtime UX Report

## Existing architecture found

- `NotificationDelivery` in MongoDB is the persistent notification source of truth.
- `notificationEmitter` creates `NotificationDelivery` records and emits `notification:new` through the existing Socket.IO user room.
- `RealtimeContext` loads persisted notifications after authentication and on Socket.IO reconnect.
- `LiveNotificationCenter` consumes the shared realtime state and provides the navbar badge/panel.
- `/api/realtime/notifications` reads only `recipientId: req.user._id`.
- `PATCH /api/realtime/notifications/:id/read` also matches both notification ID and authenticated recipient ID.
- Doctor approval/rejection already uses `practiceEmitter.verificationStatusChanged`.
- Brevo remains in the existing `emailService`; no second transport was introduced.

## Defects found

1. Notification idempotency had a read-before-create race. The pre-check alone could not prevent two concurrent requests from both attempting creation, and a duplicate could still be emitted.
2. Doctor approval/rejection notification event keys included `Date.now()`, so a retried terminal operation could generate a different notification identity.
3. Doctor application event keys included the submission timestamp and therefore were not stable across a repeated submission attempt.
4. Realtime client notification handling incremented the unread count for every socket event even when the notification ID was already present in client state.
5. The realtime UI had no compact dismissible top announcement for a newly received persistent notification.
6. Required review/navigation metadata was missing from the new-user and doctor-application notification payloads.
7. A frontend runtime role tone still declared `receptionist`; the Automation Studio role selector also exposed `receptionist`.

## Implementation performed

### Idempotency

`notificationEmitter.createDelivery()` now:

- performs the existing event-key lookup;
- creates the notification normally;
- relies on the existing unique `(eventKey, recipientId)` MongoDB index as the concurrency guard;
- catches duplicate-key races and retrieves the already-created notification;
- emits Socket.IO only when the notification was actually created.

This keeps MongoDB as the source of truth and Socket.IO as delivery only.

### Stable event identities

- New user: `user-registration:<userId>`
- New doctor application: `doctor-application:<doctorId>`
- Doctor verification state: `verification:<doctorId>:<status>`

### Safe navigation metadata

New user notifications carry `/admin/user-management`.
Doctor application notifications carry `/admin/doctors`.

The payload contains only operationally useful information. Passwords, tokens, documents, medical information, and secrets are not added.

### Realtime UX

`RealtimeContext` now keeps notification IDs in a local set so duplicate socket deliveries do not inflate unread counts or create repeated toasts.

Persisted notifications are still fetched on initial authentication and reconnect, preserving offline/reconnect recovery.

`LiveNotificationCenter` now shows a compact, non-blocking, dismissible top announcement for newly received notifications. It is not a full-screen modal.

### Runtime roles

The touched runtime role surfaces now expose only:

- `super_admin`
- `doctor`
- `patient`

`receptionist` was removed from the frontend access-control role tone and the Automation Studio role selector. Existing admin route names and historical/audit `admin` strings were not rewritten because they are not runtime role declarations and changing them would exceed this notification phase.

## Notification event matrix

| Event | Persistent DB notification | Socket.IO | Recipient | Navigation |
|---|---|---|---|---|
| New user registration | Yes, idempotent by user ID | Yes | SUPER_ADMIN | `/admin/user-management` |
| New doctor application | Yes, idempotent by doctor ID | Yes | SUPER_ADMIN | `/admin/doctors` |
| Doctor approved | Yes, idempotent by doctor/status | Yes | DOCTOR | Existing notification behavior |
| Doctor rejected | Yes, idempotent by doctor/status | Yes | DOCTOR | Existing notification behavior |

Existing Brevo callers remain in place and were not duplicated.

## Security fixes

- Notification read authorization remains server-side through `{ _id, recipientId }`.
- Notifications are not fetched by arbitrary user ID.
- Socket.IO remains authenticated through the existing socket architecture.
- Duplicate socket delivery no longer changes unread state.
- Notification payload changes do not expose credentials, verification tokens, payment secrets, or clinical documents.

## Tests actually executed

### Focused Phase-2 regression

`backend/tests/notificationPhase2Contract.test.mjs`

**PASS**

Validated:
- existing Brevo/new-user notification wiring
- safe user payload fields
- stable notification event keys
- unique notification index
- duplicate-event suppression before Socket.IO emission
- reconnect/listener cleanup contracts
- compact announcement UI
- removal of `receptionist` from touched runtime role selectors

### Existing Phase-1 regression protection

All executed successfully:

- `doctorApprovalConcurrencyRace.test.mjs` — PASS
- `onboardingMassAssignment.test.mjs` — PASS
- `phase1AdminRegistrationEmail.test.mjs` — PASS
- `phase1AuthContract.test.mjs` — PASS
- `phase1OnboardingContract.test.mjs` — PASS
- `emailVerificationCrypto.test.mjs` — PASS
- `emailVerificationConcurrency.test.mjs` — PASS
- `runtimeRolesContract.test.mjs` — PASS

### Full backend suite

Executed `npm test`.

Result:

**63 passed, 43 failed, 106 total**

The failed tests are environment/dependency failures. Representative errors show:

`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'mongoose'`

The supplied repository does not have its backend dependencies installed sufficiently for the complete suite to execute. Therefore the full suite is **not claimed as passing**.

### Frontend lint/build

Attempted:

- `npm run lint`
- `npm run build`

Both could not execute because the supplied environment reports:

`eslint: Permission denied`

and

`vite: Permission denied`

Therefore frontend lint/build are **not claimed as passing**.

## Remaining environment limitations

- Full backend execution requires a usable installed backend dependency tree, including `mongoose`.
- Frontend lint/build requires executable `eslint` and `vite` binaries.
- No production browser + real MongoDB + live Socket.IO/Brevo integration test was claimed from this environment.

No AI, payment, Razorpay, Gemini/OpenAI, authentication, doctor-approval architecture, or Phase-1 email-verification architecture was redesigned.
