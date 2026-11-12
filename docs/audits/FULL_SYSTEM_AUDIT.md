# MediCore HMS — Full System Audit (Snapshot Assessment)

**Assessment date:** 2026-11-02  
**Input:** `MediCore-HMS-Windows-Mongo-Fixes-2026-11-01(1).zip`  
**Assessment mode:** Isolated repository snapshot; no `.git`, local `.env`, live MongoDB, production credentials, or browser session was supplied.

## Executive summary

The snapshot contains a substantial React/Vite frontend, Express/Mongoose backend, separate root/backend lockfiles, 221 backend test files at baseline, frontend Vitest tests, database migration tooling, load-test safety gates, and a CI workflow. Static syntax inspection initially covered 808 JavaScript (`.js`, `.mjs`, `.cjs`) files and found no syntax errors; after the changes, 812 such files passed `node --check`. JSX compilation remains unverified because Vite/esbuild could not be installed.

Two concrete correctness defects were repaired in the isolated workspace:

1. Five admin list pages did not synchronize their controlled filter inputs when URL search parameters changed through browser back/forward navigation or cross-page navigation. A shared URL-to-filter helper and synchronization effects were added.
2. Appointment, payment, and refund list controllers silently ignored malformed contextual ObjectId filters. That could turn a malformed deep link into a broader list query. Those filters now return HTTP 400 instead of being silently discarded.

These changes are source-level repairs, not proof of full product stabilization. Dependency installation timed out, preventing reliable full test/lint/build execution. No database was connected, no migration was run, and no E2E or performance test was performed.

## Repository baseline

| Item | Finding |
|---|---|
| Root app | React 19 / Vite 8 / React Router 7 |
| Backend | Node.js / Express 5 / Mongoose 9 |
| Node runtime available | v22.16.0 |
| npm available | 10.9.2 |
| `.nvmrc` | `22` |
| Package engine declarations | `>=22.12.0` in root and backend |
| Lockfiles | Root and backend `package-lock.json` present |
| Git metadata | Not present in ZIP; branch/working-tree state cannot be established |
| Local environment | Only `.env.example` and `backend/.env.example` / load-test example supplied; no real `.env` |
| Dependencies | `npm ci` attempts timed out; resulting `node_modules` trees were incomplete |

The installed Node v22.16.0 emitted `EBADENGINE` warnings for resolved transitive packages requiring Node >=22.19.0 or >=22.22.2. This is an environment/version compatibility warning, not evidence of an application runtime defect by itself.

## Audit coverage and findings

### Frontend and admin navigation

Reviewed the admin patient, appointment, payment, invoice, refund and doctor list-page URL/filter patterns, relevant workspace navigation callbacks, and the corresponding backend list filters.

- **Fixed:** `AdminPatients`, `AdminAppointments`, `AdminPayments`, `AdminInvoices`, and `AdminRefunds` now rehydrate their controlled filter state from `useSearchParams()` when URL state changes. `AdminDoctors` already implemented this synchronization pattern.
- **Fixed:** malformed `patientId`, `doctorId`, `paymentId`, and `appointmentId` query values in the relevant appointment/payment/refund list APIs are rejected with HTTP 400.
- **Remaining:** the reviewed list pages request a fixed first-page limit and display a “narrow with search or filters” message when more records exist. No usable next/previous page control was found in these page implementations. Backend pagination metadata exists, but full interactive pagination remains to be implemented and tested.
- **Remaining:** entity-context chips/labels and clear-context controls are not consistently present for all cross-page filters. The URL and API query are the source of filtering; the filter controls do not represent every contextual key (for example `patientId`).
- **Not verified:** all admin cross-page relationships listed in the master prompt (doctor payouts/reviews/patients, payment-to-refund, refund-to-payment, invoice-to-patient, etc.) have not been exhaustively clicked through in a real browser.

### Backend and API

- Reviewed the appointment, payment, refund and patient list-filter paths relevant to the admin navigation flow.
- The appointment list populates patient and doctor references and applies the `patientId` / `doctorId` filters at the database query level.
- The patient registry search accepts a valid Mongo ObjectId as an exact `_id` match in addition to name/email search. Therefore existing links that encode a patient ID in the `search` query are supported by the current patient controller.
- Invalid contextual ObjectIds in appointment/payment/refund list queries were previously conditional no-ops; this was corrected by a shared validator.
- Full mounted-route, ownership, permission and response-contract review remains incomplete.

### Database and migrations

- Reviewed the DB connection configuration, environment loading, release script and load-test database safety gate.
- `connectDB()` uses `MONGO_URI`, logs host/database without credentials, and enables automatic index creation only outside production.
- The load-test seeder requires explicit `SEED_LOAD_TEST=1`, a separate `MONGO_URI_TEST`, a database name ending `_loadtest` or `_test`, and a write password; it refuses a target matching the configured application database.
- The release script sequences preflight, master-data import, payment active-slot processing, index migration and index verification.
- **Blocked:** no actual database URI or live database was supplied. Actual database name, collections, indexes, legacy documents, orphans, financial relationships and migration execution state could not be inspected. No migration or write operation was executed.

### Financial correctness and security

- Financial controllers and services were not exhaustively audited end-to-end in this pass.
- The appointment list controller already strips payment/invoice references for admins without `manage_payments`; this is a useful server-side data minimization control.
- No real payment gateway, webhook, wallet ledger, refund or payout transaction was executed.
- No security penetration test, cross-account API test, or clinical-data privacy review was executed.

### CI, build and deployment

- CI workflow defines separate backend, MongoDB-backed backend, and frontend jobs. It runs backend tests, Mongo tests with a service container, and frontend lint/build.
- The root and backend package manifests and lockfiles are present.
- **Blocked:** npm dependency installation did not complete in the audit environment, so lint/build/test outcomes cannot be used as product pass/fail evidence.

## Changed files

- `src/utils/adminQueryFilters.js` — shared URL filter-state reader.
- `src/utils/adminQueryFilters.test.js` — frontend helper regression tests.
- `src/pages/admin/AdminPatients.jsx`
- `src/pages/admin/AdminAppointments.jsx`
- `src/pages/admin/AdminPayments.jsx`
- `src/pages/admin/AdminInvoices.jsx`
- `src/pages/admin/AdminRefunds.jsx`
- `backend/utils/queryObjectId.js` — optional contextual ObjectId query validation.
- `backend/tests/adminQueryObjectId.test.mjs` — dependency-free validator regression test.
- `backend/controllers/admin/appointmentAdminController.js`
- `backend/controllers/admin/paymentAdminController.js`
- `backend/controllers/admin/refundAdminController.js`

## Acceptance status

The repository is **not certified complete**. Backend/frontend dependency-based test suites, live MongoDB reconciliation, browser E2E, full security review, financial reconciliation and load testing remain blocked or unverified. See `TEST_RESULTS.md` and `REMAINING_ISSUES.md`.

## Continuation — N-001 / N-023 index, migration and storage review

The N-001 and N-023 uploaded evidence files are byte-identical and therefore not independent verification runs. The implementation review found Windows ESM path conversion defects, unsafe text-index classification, incorrect same-key conflict handling, swallowed legacy sparse-index inspection errors, missing migration-lock renewal, and an overly permissive destructive MongoDB test target guard. These were repaired in the isolated workspace; the unused `INVOICE_STORAGE_DIR` / `env.invoiceStorageDir` second path setting was removed in favor of the active `StorageService` configuration.

The direct migration-state fake-DB smoke, Mongo safety guard test and changed-file syntax checks passed. The complete backend suite executed 223 test files: 108 passed and 115 failed during module resolution because dependencies are unavailable. Frontend tests, lint and build are blocked by missing executables. Real MongoDB tests were not run because no disposable Mongo URI or MongoDB server was available. See `docs/audits/INDEX_AUDIT_RECONCILIATION.md` for exact source paths and evidence.

**Acceptance remains BLOCKED. No database was connected or modified. Do not deploy.**
