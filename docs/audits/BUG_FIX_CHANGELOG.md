# MediCore HMS — Bug Fix Changelog

**Date:** 2026-11-02  
**Scope:** Isolated ZIP snapshot only.

## FIX-001 — Admin URL filters became stale after browser navigation

**Severity:** Medium  
**Affected pages:** Patients, Appointments, Payments, Invoices, Refunds.

**Root cause:** Each page initialized its controlled `filters` state from `searchParams` once with `useState`. Its data-loading effect reacted to later URL changes, but the form state did not. Browser back/forward and navigation to a list with a new query could therefore show stale form controls while the API request used the updated URL.

**Change:** Added `readAdminFilterState()` and an effect on each affected page to rehydrate the controlled filter state whenever `searchParams` changes. Unknown context parameters remain in the URL/API query and are not copied into unrelated form fields.

**Regression coverage:** `src/utils/adminQueryFilters.test.js` covers URL hydration and clearing removed query values. The helper was also exercised directly with Node assertions in the audit environment. Full Vitest execution is blocked by incomplete dependency installation.

## FIX-002 — Malformed contextual ObjectId filters silently widened admin list queries

**Severity:** High for correctness of contextual navigation.  
**Affected endpoints:** Admin appointment, payment and refund list filters.

**Root cause:** The controllers only applied `patientId`, `doctorId`, `paymentId` or `appointmentId` when `mongoose.Types.ObjectId.isValid()` returned true. Invalid non-empty values were silently ignored. A malformed deep link could consequently return a general list instead of an explicit validation error.

**Change:** Added `readOptionalObjectIdQuery()` and used it to validate contextual ObjectId query parameters before building the database filter. Empty/absent values remain optional; malformed strings, arrays and objects produce HTTP 400.

**Regression coverage:** `backend/tests/adminQueryObjectId.test.mjs` passed directly using Node. It tests valid, absent, empty, malformed, repeated-array and object-shaped values. The full backend runner remains blocked by missing installed packages.

## Changed files

| File | Change |
|---|---|
| `src/utils/adminQueryFilters.js` | New URL filter helper |
| `src/utils/adminQueryFilters.test.js` | New helper tests |
| `src/pages/admin/AdminPatients.jsx` | URL-to-form synchronization |
| `src/pages/admin/AdminAppointments.jsx` | URL-to-form synchronization |
| `src/pages/admin/AdminPayments.jsx` | URL-to-form synchronization |
| `src/pages/admin/AdminInvoices.jsx` | URL-to-form synchronization |
| `src/pages/admin/AdminRefunds.jsx` | URL-to-form synchronization |
| `backend/utils/queryObjectId.js` | New optional ObjectId query validator |
| `backend/tests/adminQueryObjectId.test.mjs` | New dependency-free backend test |
| `backend/controllers/admin/appointmentAdminController.js` | Reject malformed patient/doctor filters |
| `backend/controllers/admin/paymentAdminController.js` | Reject malformed patient/doctor/appointment filters |
| `backend/controllers/admin/refundAdminController.js` | Reject malformed patient/payment/doctor/appointment filters |

## Verification

- Direct backend validator test: PASS.
- JavaScript syntax checks for changed `.js` / `.mjs` files: PASS.
- Full frontend tests: BLOCKED (Vitest executable unavailable after npm install timeout).
- Full backend suite: BLOCKED by incomplete dependencies; see `TEST_RESULTS.md`.

## Continuation — N-001 / N-023 index, path and storage stabilization (2026-11-02)

### FIX-003 — Windows ESM filesystem-path conversion

**Root cause:** `loadAllModels()` passed a Windows path directly to dynamic `import()`. Several tests also used `URL.pathname` as a filesystem path, which is not a portable Windows path conversion. The S3 child process inherited an incomplete environment and used the same invalid cwd conversion.

**Change:** Use `pathToFileURL()` for dynamic model imports and `fileURLToPath()` for filesystem paths. The S3 probe inherits `process.env` and checks spawn error, exit code and output separately.

**Files:** `backend/migrations/lib/indexInventory.js`, `backend/tests/storageService.test.mjs`, `backend/tests/canonicalTaxRate.test.mjs`, `backend/tests/familyMemberOwnership.test.mjs`.

**Verification:** All changed JS/MJS files passed `node --check`. Native Windows execution and the S3 probe remain blocked by the unavailable Windows runtime/dependencies.

### FIX-004 — Index reconciliation and migration-state safety

**Root cause:** Text indexes could be accepted by name alone; incompatible same-key indexes were attempted as additive creates; legacy sparse inspection errors were hidden; migration leases were not renewed during long index builds; stale takeover did not compare the exact lease snapshot.

**Change:** Compare text index behavior, report incompatible same-key definitions as conflicts (except the explicit legacy sparse-to-partial replacement), pass collation into duplicate aggregation, propagate legacy scan errors, add lease renewal/heartbeat and exact-value takeover CAS, and require an unexpired lease for finalization.

**Files:** `backend/migrations/lib/indexInventory.js`, `backend/migrations/lib/indexMigration.js`, `backend/migrations/lib/migrationState.js`, `backend/migrations/011_ensure_production_indexes.js`, `backend/tests/helpers/fakeDb.mjs`, `backend/tests/indexInventoryMigration.test.mjs`.

**Verification:** Direct migration-state fake-DB smoke passed; changed-file syntax checks passed. Full Mongoose inventory and real MongoDB index tests remain blocked.

### FIX-005 — Remove misleading invoice-only storage configuration

**Root cause:** `invoiceStorageDir` / `INVOICE_STORAGE_DIR` was an unused second path setting while new invoice PDF operations used `storageService` and `STORAGE_LOCAL_ROOT`. The old test asserted the unused property rather than the active write path.

**Change:** Removed the unused config property. The PDF regression test now supplies a conflicting legacy setting and checks the active storage driver/root.

**Files:** `backend/config/env.js`, `backend/tests/pdfDurableStorage.test.mjs`.

**Verification:** Syntax check passed; PDF integration test not executed because backend packages are missing.

### FIX-006 — Destructive MongoDB test target guard

**Root cause:** A database name containing a `test` token was accepted even on a remote MongoDB host, although the integration suites drop the selected database.

**Change:** Added a shared disposable-target guard requiring a database named `test` or ending `_test` / `-test`; remote targets require `MONGODB_TEST_ALLOW_REMOTE=1`.

**Files:** `backend/tests/mongo/safety.mjs`, `backend/tests/mongoSafety.test.mjs`, all five `backend/tests/mongo/*.mongo.test.mjs` entry points.

**Verification:** `node tests/mongoSafety.test.mjs` passed. No MongoDB connection or database mutation occurred.
