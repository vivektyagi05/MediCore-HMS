# PHASE 4 — PERFORMANCE + NAVIGATION REPORT

## Status

**PARTIALLY COMPLETED**

Phase 4 performance work was implemented only where the repository inspection identified concrete, code-level performance problems. Phase 5 was not started. Phase 1/2/3 architecture was not redesigned.

## 1. Repository Areas Inspected

- React entry point, routing, protected/public layouts
- `AuthContext` session bootstrap
- `RealtimeContext` and Socket.IO client lifecycle
- Axios request/deduplication layer
- public doctor search and coverage APIs
- admin doctor listing API
- Doctor, Appointment, NotificationDelivery and MasterData indexes
- public/admin API clients
- existing Phase 1/2/3 regression tests
- root/backend package scripts and dependency availability

## 2. Baseline Evidence

Runtime latency and browser network timings were **not measurable in the supplied environment** because frontend dependencies (`vite`, `eslint`) and backend runtime dependencies (`mongoose`) are not installed.

Static request/query-path inspection did establish these concrete baselines:

### Authenticated realtime bootstrap

`RealtimeContext` performed the initial notification/presence REST hydration immediately after socket creation and then performed the same two REST reads again from the first Socket.IO `connect` event. This created two possible reads of `/notifications` and `/presence` during one initial connection lifecycle.

### Admin doctor listing

The doctor list aggregation previously looked up **all Appointment documents for each returned doctor** and materialized them into an `appointments` array solely to calculate `appointmentCount`.

The count aggregation also performed a User `$lookup` even when no name/email search was supplied.

### Public geographic coverage

`getDoctorCoverage` previously executed four independent Doctor aggregation pipelines plus one separate coordinate `countDocuments` query: **5 database operations** for one coverage request, all repeating the same base Doctor filter and location expansion work.

## 3. Changes Implemented

### A. Realtime initial-sync deduplication

**File:** `src/context/RealtimeContext.jsx`

Changed the initial authenticated lifecycle so:

- REST notification/presence hydration still starts immediately.
- The first Socket.IO `connect` event only changes connection state.
- REST hydration is not repeated on that first connection.
- A genuine reconnect still reloads persisted notifications and presence.
- Socket.IO remains the existing source of realtime delivery.
- Persisted notifications remain the source of truth.

This removes the confirmed initial-connect duplicate read without weakening offline/reconnect recovery.

### B. Admin doctor appointment-count query

**File:** `backend/controllers/admin/doctorAdminController.js`

Changed the appointment lookup from materializing every matching appointment document into an array to a `$lookup` pipeline that performs `$count` directly for each doctor.

The response still exposes the same `appointmentCount` value and keeps existing sorting/filtering semantics.

Also changed the pagination count pipeline so the User lookup only occurs when the request actually contains a name/email search.

### C. Public doctor coverage aggregation

**File:** `backend/controllers/publicController.js`

Replaced the previous four independent coverage aggregations plus coordinate count with one Doctor aggregation using `$facet`.

The single matched Doctor stream now produces:

- state coverage
- district coverage
- city coverage
- total doctor count
- coordinate doctor count

The existing primary-location/clinic-location semantics and response shape are preserved.

## 4. Database / Index Findings

No new MongoDB indexes were added because the inspection did not provide a measured query plan demonstrating that an additional index would be justified.

Existing relevant indexes were preserved, including:

- Doctor `specializationMasterId`
- Doctor `stateMasterId`
- Doctor `districtMasterId`
- Doctor `cityMasterId`
- Doctor `location` 2dsphere
- Appointment `doctorId`
- Appointment `date`
- Appointment `status`
- NotificationDelivery `(recipientId, readAt, createdAt)`
- NotificationDelivery unique `(eventKey, recipientId)`
- MasterData `(kind, parentId, normalizedName)` unique

No duplicate indexes were introduced.

## 5. Frontend Changes

- Removed the confirmed duplicate initial notification/presence REST synchronization caused by the first Socket.IO connect event.
- Preserved reconnect synchronization.
- No arbitrary caching was added.
- No public-page authentication or Socket.IO initialization was introduced.
- No navigation architecture was rewritten.

## 6. Backend Changes

- Admin Doctor appointment counting now counts inside the MongoDB lookup rather than transferring/materializing appointment arrays.
- Admin Doctor total-count query avoids an unnecessary User lookup when search is absent.
- Public Doctor geographic coverage now shares one base Doctor scan through `$facet`.
- Existing authorization, filtering, serialization and response contracts were preserved.

## 7. Realtime Findings

The existing Socket.IO connection reuse and listener cleanup were inspected and preserved.

A confirmed initial-connect duplicate REST synchronization was fixed.

No Socket.IO architecture or notification lifecycle/idempotency implementation was redesigned.

## 8. Measurements

No real latency, payload-size, browser-render, or MongoDB execution-time measurements were available because the supplied runtime lacks required dependencies and a runnable application/database environment.

Measured/code-derived request/query topology:

| Flow | Before | After |
|---|---:|---:|
| Initial authenticated realtime REST hydration | 2 initial reads + up to 2 repeated reads on first connect | 2 initial reads; reconnect only performs the refresh |
| Admin doctor appointment count | Appointment documents materialized per doctor | MongoDB `$count` inside lookup |
| Public geographic coverage DB operations | 4 aggregations + 1 count query | 1 aggregation with `$facet` |

These are code-path/query-operation counts, not latency benchmarks.

## 9. Tests Actually Executed

### Passed

- `backend/tests/phase4PerformanceContract.test.mjs`
- `backend/tests/phase1AuthContract.test.mjs`
- `backend/tests/emailVerificationCrypto.test.mjs`
- `backend/tests/emailVerificationConcurrency.test.mjs`
- `backend/tests/phase1OnboardingContract.test.mjs`
- `backend/tests/onboardingMassAssignment.test.mjs`
- `backend/tests/phase1AdminRegistrationEmail.test.mjs`
- `backend/tests/notificationPhase2Contract.test.mjs`
- `backend/tests/notificationLifecycleIdempotency.test.mjs`
- `backend/tests/phase3MasterDataContract.test.mjs`
- `backend/tests/phase3MigrationSafety.test.mjs`
- `backend/tests/phase3CanonicalFiltering.test.mjs`
- `backend/tests/p12GeographicHelper.test.mjs`
- `backend/tests/doctorApprovalConcurrencyRace.test.mjs` — 4/4 subtests passed

Modified backend JavaScript files also passed `node --check`.

### Full backend suite

Command:

`npm --prefix backend test`

Result:

**67 passed / 43 failed / 110 total**

The failed tests are blocked by the supplied environment because `mongoose` is unavailable. The failures are not represented as application-test passes.

### Frontend lint

Command:

`npm run lint`

Result:

**BLOCKED — `eslint: not found`**

### Frontend build

Command:

`npm run build`

Result:

**BLOCKED — `vite: not found`**

## 10. Files Changed

- `src/context/RealtimeContext.jsx`
- `backend/controllers/admin/doctorAdminController.js`
- `backend/controllers/publicController.js`
- `backend/tests/phase4PerformanceContract.test.mjs`
- `docs/PHASE-4-PERFORMANCE-REPORT.md`

## 11. API / Contract Changes

No public API route or response contract was intentionally changed.

The optimized public coverage implementation preserves the existing response structure.

## 12. Security / Regression Preservation

No authentication, authorization, ownership, email verification, doctor approval, notification authorization, Socket.IO architecture, Brevo, payment, AI, role, or MasterData architecture was changed.

The Phase-1, Phase-2 and Phase-3 targeted regression contracts executed in this environment passed.

## 13. Remaining Limitations

1. No browser runtime was available for real request-count/latency/render measurements.
2. `mongoose` is unavailable, preventing a fully executable backend runtime and full backend suite.
3. `vite` is unavailable, preventing a frontend production build.
4. `eslint` is unavailable, preventing frontend lint execution.
5. No live MongoDB query-plan/`explain()` evidence was available, so no speculative indexes were added.

Because these acceptance items could not be executed, Phase 4 is reported as **PARTIALLY COMPLETED**, not fully completed.

## 14. Phase Boundary

**No Phase 5 work was started.**
