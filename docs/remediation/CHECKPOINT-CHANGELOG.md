# CHECKPOINT CHANGELOG — 2026-09-23

Companion to `CHECKPOINT-STATUS-2026-09-23.md`. This document lists what
changed, file by file, across the full remediation session that produced
this checkpoint (spanning the Phase 0 audit through the feature-toggle and
billing-settings fixes). It does not repeat the narrative explanation for
each fix — see the inline code comments (marked `SECURITY FIX`, `BUGFIX`,
or `FIX`) and `CHECKPOINT-STATUS-2026-09-23.md` Section A for that.

## New files created

### Config / production safety
- `backend/config/productionGuards.js` — production configuration validator.

### Services
- `backend/services/clinicalAccessService.js` — canonical clinical-relationship policy.
- `backend/services/doctorLifecycleService.js` — canonical doctor verification state machine.
- `backend/services/sessionAuthService.js` — shared REST/socket session validity.
- `backend/services/featureToggleService.js` — feature-toggle read/enforcement, with rollout-percentage support.
- `backend/services/hospitalSettingsService.js` — canonical admin-settings reader (tax rate, refunds-enabled).

### AI
- `backend/ai/providers/geminiProvider.js` — native Gemini provider.
- `backend/ai/providers/phiMinimizer.js` — PHI/PII minimization for external AI calls.
- `backend/ai/providers/responseContract.js` — shared JSON-shape enforcement helpers for LLM providers.

### Storage
- `backend/storage/storageService.js` — local/S3 storage abstraction.

### Utils
- `backend/utils/regexSafe.js` — escape helpers for building RegExp from user input.
- `backend/utils/familyMemberFields.js` — FamilyMember writable-field allowlist.

### Migrations
- `backend/migrations/006_doctor_verification_not_submitted.js`
- `backend/migrations/007_doctor_documents_storage_key.js`

### Documentation
- `docs/SCHEDULER-ARCHITECTURE.md`
- `docs/remediation/CHECKPOINT-STATUS-2026-09-23.md`
- `docs/remediation/CHECKPOINT-CHANGELOG.md` (this file)

### Deleted
- `backend/ai/providers/openaiProvider.js` — removed as part of the Gemini migration.
- `backend/utils/chatAuthorization.js` — removed; superseded by `clinicalAccessService.js`.

## Modified files, by area

### Clinical data access
- `backend/controllers/doctor/workflowController.js` — patient reports list/download,
  clinical profile, report-review, follow-up scheduling now use
  `clinicalAccessService`; added `downloadDoctorDocument`; rewrote
  `uploadDoctorDocument`/`deleteDoctorDocument`/`getDoctorDocuments` onto
  `storageService`.
- `backend/controllers/doctor/commandCenterController.js` — pending-reports
  queue scoped by the clinical-access policy; report-review delegates to
  the shared `markSharedReportReviewed`.
- `backend/ai/generativeAssistant.js` — clinical copilot uses
  `assertDoctorPatientRecordAccess` instead of a bare appointment-exists
  check.
- `backend/controllers/patient/patientWorkflowController.js` —
  `uploadReport` validates doctor/appointment sharing tags;
  `createFamilyMember`/`updateFamilyMember` use the allowlist;
  `createInsurance` no longer accepts client-supplied claim fields.
- `backend/socket/roomManager.js`, `backend/socket/eventHandlers.js`,
  `backend/controllers/realtimeController.js` — repointed from the deleted
  `chatAuthorization.js` to `clinicalAccessService.js`.

### Doctor lifecycle
- `backend/models/Doctor.js` — `verificationStatus` enum gains
  `not_submitted`; it is now the default (was `pending`).
  `documents[].filePath` renamed to `documents[].storageKey`.
- `backend/controllers/doctorOnboardingController.js` — `submitOnboarding`
  validates the transition through `canTransitionDoctorVerification`.
- `backend/services/doctorProfileIntelligenceService.js`,
  `backend/services/doctorPublicSerializer.js` — handle the new
  `not_submitted` state correctly instead of defaulting to `pending`.
- `src/pages/doctor/DoctorVerificationCenter.jsx`,
  `src/pages/doctor/DoctorPracticeOverview.jsx` — display `not_submitted`
  distinctly instead of falling back to "Pending Review".

### Session / socket auth
- `backend/middleware/authMiddleware.js` — `protect`/`optionalProtect`
  delegate to `sessionAuthService`.
- `backend/socket/socketAuth.js` — handshake delegates to
  `sessionAuthService`; failures are now logged (previously silent).
- `backend/socket/eventHandlers.js` — `presence:ping` heartbeat
  revalidates the session and force-disconnects on rejection; `chat:send`
  checks the `chat` feature toggle (admins exempted).
- `backend/socket/presenceManager.js`, `backend/socket/socketServer.js`,
  `backend/controllers/realtimeController.js` — `snapshotFor(user)` scopes
  presence to `super_admin` only.

### Payments / billing
- `backend/models/Payment.js` — added `CAPTURED_LIKE_PAYMENT_STATUSES`.
- `backend/controllers/doctor/workflowController.js`,
  `backend/controllers/doctor/doctorEarningsController.js`,
  `backend/services/finance/financeAggregates.js` — fixed the
  `Payment.status === "paid"` bug and consolidated duplicate
  `CAPTURED_LIKE` definitions onto the model's canonical export.
- `backend/controllers/paymentController.js`,
  `backend/services/invoiceService.js` — tax rate now sourced from
  `hospitalSettingsService.getTaxRatePercent()` with consistent
  percentage semantics (was a disconnected, unit-inconsistent env var).
- `backend/controllers/refundController.js` — `refundsEnabled` now enforced
  in refund-request intake and the three money-moving admin actions.
- `backend/.env.example` — `CONSULTATION_TAX_RATE` documentation removed
  (no longer read anywhere).

### Production configuration
- `backend/config/env.js` — calls `productionGuards.js` at boot; defines
  `env.ai`, `env.paymentGatewayMode`, `env.storage`, `env.clinical`.
- `backend/payments/paymentGateway.js` — the test gateway module is not
  importable at all in a production process.
- `backend/seed.js` — removed the hardcoded fallback password; production
  refuses to seed without `SEED_SUPER_ADMIN_PASSWORD`, development
  generates and logs a random one.

### AI
- `backend/ai/providers/textGenerationProvider.js` — provider registry
  rewritten: real async health probe (was synchronous, "healthy" if an
  object merely existed), `gemini`/`template` providers only.
- `backend/services/ai/aiSystemHealthAggregates.js`,
  `backend/controllers/admin/platformHealthAdminController.js` — `await`
  the now-async health check; surface real provider kind/model.
- `src/pages/ai/AdminAIInsights.jsx` — labels TEMPLATE vs generative
  provider truthfully instead of a generic "active provider" line.

### Regex-injection sweep
- `backend/controllers/publicController.js` (7 sites),
  `backend/controllers/doctorController.js` (`getDoctors`, also rewritten
  to serialize output instead of returning raw documents),
  `backend/controllers/admin/doctorAdminController.js`,
  `backend/controllers/admin/adminReviewController.js`,
  `backend/controllers/admin/appointmentAdminController.js`,
  `backend/controllers/appointmentController.js`,
  `backend/ai/doctorRecommendation.js` — all unescaped `new
  RegExp(<user input>)` sites now use `utils/regexSafe.js`.

### Storage / Docker
- `backend/routes/doctor/workflowRoutes.js` — doctor-document upload
  switched from `multer.diskStorage` to `multer.memoryStorage()`.
- `backend/routes/patient/workflowRoutes.js`,
  `backend/routes/doctor/practiceRoutes.js`,
  `backend/routes/admin/cmsAdminRoutes.js` — multer destinations use
  `localCategoryDir()` (resolves against the Docker-volume-matching root)
  instead of a bare `process.cwd()`-relative string.
- `backend/app.js` — the two `express.static` mounts (doctor-profile, cms)
  resolve against `env.storage.localRoot` instead of `process.cwd()`.
- `backend/controllers/admin/doctorAdminController.js`,
  `backend/controllers/doctorController.js` — `storageKey` stripped from
  every admin-facing document response; admin download streams through
  `storageService` instead of `res.download(filePath)`.
- `backend/utils/fileValidation.js` — added a buffer-based magic-byte
  check (`assertValidBufferUpload`/`bufferMatchesDeclaredType`) alongside
  the existing disk-path-based one, for the memory-storage upload flow.
- `src/api/doctorWorkflowApi.js`, `src/pages/doctor/DoctorDocuments.jsx` —
  added `downloadDocument`; wired a working download button; blocked the
  delete button for verified documents.

### Scheduler
- `backend/models/CronRunLog.js` — partial unique index on
  `{jobName}`/`status:"running"`; new `timed_out` status; `host`/`pid`
  fields.
- `backend/utils/cronRunTracker.js` — rewritten to acquire/reclaim the
  lock; emits an automation trigger on job failure (was already partially
  present, retained).
- `backend/automation/cronJobs.js` — added the standalone CLI entrypoint.
- `backend/workflow/assignment/assignmentEngine.js`,
  `backend/workflow/assignment/assignmentScheduler.js` — fixed a real
  circular-import TDZ crash (`_internal` accessed at call time instead of
  destructured at module load time).

### Feature toggles
- `backend/routes/financeRoutes.js` — `wallet_system`, `subscriptions`
  gates.
- `backend/routes/patient/workflowRoutes.js` — `reviews` gate.
- `backend/routes/aiRoutes.js`, `backend/routes/aiAssistRoutes.js` —
  `ai_features` gate (admin AI monitoring/automation left ungated).

### Admin permissions
- `src/pages/admin/AdminAccessControl.jsx` — added a truthful banner
  explaining that, with only `super_admin` as an admin-tier role which
  always bypasses permission checks, the permission matrix currently has
  no effect on real access.

## Tests added (all under `backend/tests/`, all in the full-suite run)

- `productionConfigGuards.test.mjs`
- `geminiProvider.test.mjs`
- `phiMinimizer.test.mjs`
- `clinicalAccessPolicy.test.mjs` (replaces the deleted `chatAuthorization.test.mjs`)
- `noWeakRelationshipChecks.test.mjs`
- `familyMemberOwnership.test.mjs`
- `sessionAuthService.test.mjs`
- `presencePrivacy.test.mjs`
- `doctorOnboardingDeadlock.test.mjs`
- `paymentStatusCanonical.test.mjs`
- `publicSearchInjectionSafety.test.mjs`
- `seedPasswordSafety.test.mjs`
- `storageService.test.mjs`
- `doctorDocumentStorageMigration.test.mjs`
- `cronJobLocking.test.mjs`
- `automationCronEntrypoint.test.mjs`
- `assignmentEngineCircularImport.test.mjs`
- `featureToggleEnforcement.test.mjs`
- `canonicalTaxRate.test.mjs`
- `refundsEnabledEnforcement.test.mjs`

Pre-existing tests updated in place (source-inspection assertions pinned to
a literal string/pattern that a fix legitimately changed):
`sessionRestoration.test.mjs`, `clinicalWorkspaceGapClosure.test.mjs`,
`followUpSchedulingAndRangeContract.test.mjs`,
`phase3CanonicalFiltering.test.mjs`.

## Migrations added

- `006_doctor_verification_not_submitted.js` — backfills existing
  `verificationStatus:"pending"` doctors with an empty `verificationHistory`
  to `not_submitted` (they never actually submitted).
- `007_doctor_documents_storage_key.js` — backfills existing
  `documents[].filePath` values into `documents[].storageKey` using the raw
  MongoDB driver (the Mongoose schema no longer declares `filePath` at
  all). Data-shape fix only; does not move any file into S3.

Neither migration has been run against a real database in this environment
(see `CHECKPOINT-STATUS-2026-09-23.md` Section B).

## Configuration changes required for a real deployment

These are **new required environment variables / settings** introduced by
this session's work. A deployment that does not set them will fail to boot
in production (enforced by `config/productionGuards.js`) or will silently
keep old, possibly-wrong behavior in development:

- `AI_TEXT_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL` — required in
  production; `template`/`openai` are rejected.
- `STORAGE_DRIVER` (`local` or `s3`) — production requires either
  `STORAGE_DRIVER=s3` with `STORAGE_S3_BUCKET`/`STORAGE_S3_REGION`, or
  `STORAGE_DRIVER=local` with an absolute `STORAGE_LOCAL_ROOT` and
  `STORAGE_LOCAL_PERSISTENT=true`.
- `PAYMENT_GATEWAY_MODE` — must be `razorpay` (or unset) in production;
  `test` is rejected.
- `SEED_SUPER_ADMIN_PASSWORD` — now required to run `seed.js` in
  production (previously silently defaulted).
- `CONSULTATION_TAX_RATE` — **removed**. The tax rate is now set from
  Admin → Settings (`HospitalSetting.paymentSettings.taxRate`), not an env
  var. Any deployment script that sets this env var should stop doing so
  (it is simply ignored now, not harmful, but misleading to keep).
- `CHAT_FOLLOWUP_WINDOW_DAYS` (optional, default 30) — how long after a
  completed appointment chat remains open for follow-up questions.
- `AI_TIMEOUT_MS`, `AI_HEALTH_CACHE_MS` (optional) — Gemini call timeout and
  health-probe cache duration.

---

## APPOINTMENT ENGINE REMEDIATION — 2026-09-24 (continuation pass)

Scoped follow-up to this checkpoint, focused solely on the appointment
engine's server-side timing/window correctness. Full detail:
`docs/remediation/APPOINTMENT-ENGINE-REMEDIATION-2026-09-24.md`.

### Fixed
- **CRITICAL**: `createAppointment`/`rescheduleAppointment`
  (`controllers/appointmentController.js`) and
  `scheduleFollowUpAppointment` (`controllers/doctor/workflowController.
  js`) each only rejected a booking whose CALENDAR DATE (UTC-midnight
  normalized) was in the past — a past TIME on today's date (e.g. booking
  09:00 when the real server time is already 12:00 the same day) was
  incorrectly accepted. Fixed via new canonical
  `services/appointmentBookingPolicyService.js`, wired into all three
  write paths.
- Section C item 2 from this checkpoint (`HospitalSetting.appointmentLimits.
  bookingWindowDays`/`.dailyPerDoctor` read-only, never enforced) — fixed
  in the same pass, via the same policy service +
  `hospitalSettingsService.getAppointmentLimits()`.
- `getAvailableSlots` now returns `reason: "beyond_booking_window"` instead
  of silently offering slots the write path would then reject.

### Added
- `backend/services/appointmentBookingPolicyService.js`
- `backend/tests/appointmentBookingPolicy.test.mjs`
- `hospitalSettingsService.getAppointmentLimits()`
- `docs/remediation/APPOINTMENT-ENGINE-REMEDIATION-2026-09-24.md`

### Verified
- 145/145 backend tests (144 + 1 new file), 0 ESLint errors/warnings,
  clean frontend build, clean boot (ECONNREFUSED-only, no sandbox Mongo).

### Explicitly NOT done in this pass (see the remediation doc's Section 15)
- Daily-cap check is not atomic (soft limit, not a hard concurrency
  guarantee).
- Pre-existing `scheduleFollowUpAppointment` claim-rollback gap (found,
  not introduced, not fixed here).
- Timezone remains UTC-literal end-to-end by deliberate decision, not
  projected through `HospitalSetting.timezone` (documented, not silently
  skipped).
- Every other still-open item from this checkpoint's own Section C is
  untouched — this pass is scoped to the appointment engine only.

---

## 2026-09-24 — Master Data + Doctor Onboarding Location Flow (City dropdown)

Continuation after the Appointment Engine remediation (previous entry).
Scope: State→District→City master-data flow in doctor onboarding /
professional-profile forms only. Full detail:
`docs/remediation/MASTER-DATA-ONBOARDING-REMEDIATION-2026-09-24.md`.

### Root cause
City was implemented as a plain free-text input in the shared
`DoctorLocationFields` component — the only gap in an otherwise fully
correct, symmetric State/District/City stack (source data, importer,
MongoDB, API, hierarchy validation, and Doctor-model resolution were
already generic across all three levels and required no changes).

### Fixed (frontend only — no backend/DB change)
- `src/hooks/useLocationOptions.js` — added city fetching keyed off the
  selected district, symmetric with district-under-state.
- `src/utils/doctorLocation.js` — removed the city-specific
  always-free-text logic (`setCityText` and the bespoke branches in
  `locationFromDoctor`/`buildLocationPayload`); city now uses the same
  generic MASTER/OTHER helpers as state/district.
- `src/components/doctor/DoctorLocationFields.jsx` — city is now a
  `<select>` sourced from canonical cities of the selected district, with
  an explicit "Other" free-text fallback, disabled until a district is
  chosen.

### Updated tests
- `backend/tests/doctorLocationForm.test.mjs` — rewritten (16 assertions)
  for the new city-select model.
- `backend/tests/finalDataFlowContract.test.mjs` — its `DoctorLocationFields`
  assertions previously required a text-input city and forbade
  `cities.map`; updated to require the dropdown instead.
- `backend/scripts/ui-verification/{locationFields,doctorForms}.harness.jsx`
  (manual, not part of `npm test`, require a live server) — updated to
  exercise the city select; not executed (no reachable DB in this
  sandbox).

### Verified
- 145/145 backend tests (unchanged total — one file rewritten, not
  added), 0 ESLint errors, clean frontend build, fresh-extract gate
  passed.

### Explicitly NOT done in this pass (see the remediation doc's Section 16)
- Live MongoDB/browser E2E — no reachable MongoDB in this sandbox
  (same recurring, disclosed limitation as every prior checkpoint).
- Admin doctor edit (Phase 12): traced — no location-editing UI exists
  for admins at all; unrelated to master data; not built here.
- Multi-clinic location UI (`DoctorPracticeSettings.jsx`): the `clinics`
  array already has parallel location fields server-side, but no UI
  exists to enter them; pre-existing gap, unrelated to the reported bug,
  not built here.
- Every other still-open item from the 2026-09-23 checkpoint's Section C
  is untouched — scoped to the master-data/city flow only.
