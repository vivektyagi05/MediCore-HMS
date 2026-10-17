# CURRENT REMEDIATION CHECKPOINT — 2026-09-23

**This is a CHECKPOINT, not a completion report.** The remediation described
in the original mission is NOT finished. This document exists to transfer
the current working tree to a new session with an accurate, unembellished
record of what has and has not been done, so the next session does not have
to re-audit from scratch and does not accidentally re-claim something as
outstanding that is already fixed (or vice versa).

No claim in this document should be read as "production ready" or
"complete." Several major remediation phases from the original mission have
not been started at all (Section C).

---

## A. IMPLEMENTED AND VERIFIED

Verified means: the code exists in the current working tree, a dedicated
regression test exists and passes in the full backend suite run at the time
of this checkpoint, and (where applicable) the file/function was directly
inspected as part of this checkpoint's verification pass — not merely
reported in an earlier turn's summary.

### Security / authorization
- **Clinical access service** (`services/clinicalAccessService.js`) —
  replaced every `Appointment.exists({doctorId, patientId})` check across
  doctor patient-data endpoints, chat authorization, and the AI clinical
  copilot with a real policy: doctor must be currently approved+active,
  patient must be active, and a **paid, consultation-stage** appointment
  must exist. Reports/insurance/family records are scoped to what was
  actually shared with that doctor (tagged, linked, or attached at
  booking), not "every record the patient has."
- **Report upload tag validation** — `uploadReport` validates
  doctor/appointment tags server-side instead of accepting arbitrary
  client-supplied IDs.
- **Doctor onboarding `not_submitted` lifecycle** — `Doctor.verificationStatus`
  now has a real initial state distinct from "pending" (previously the
  schema default WAS `"pending"`, identical to "submitted, awaiting
  review," so a fresh doctor's first submission was rejected with a 409).
  Canonical transition map in `services/doctorLifecycleService.js`.
  Migration: `migrations/006_doctor_verification_not_submitted.js`.
- **Session auth unification** (`services/sessionAuthService.js`) — REST
  (`protect`/`optionalProtect`) and Socket.IO handshake now share one
  session-validity decision (signature, expiry, active user,
  securityVersion). Socket connections also revalidate on their existing
  heartbeat and force-disconnect on a mid-connection password
  reset/deactivation.
- **Presence privacy** — `presenceManager.snapshotFor(user)` scopes the
  online-users list to `super_admin` only; previously every authenticated
  user (patient/doctor included) received every other user's online status
  via the socket handshake and `GET /realtime/presence`.
- **FamilyMember mass-assignment protection** (`utils/familyMemberFields.js`)
  — explicit writable-field allowlist; ownership (`userId`) and lifecycle
  (`isActive`) can never be set through the client body. Same treatment
  applied to Insurance creation (workflow-controlled claim fields stripped).
- **Regex-injection/ReDoS sweep** — 9 unescaped `new RegExp(<user input>)`
  sites fixed across public doctor search, admin search, and AI
  doctor-matching (`utils/regexSafe.js`). A static test bans the pattern
  repo-wide.
- **Legacy `/api/doctors` endpoint** — now serializes through
  `serializeDoctorPublicProfile()` instead of returning raw Mongo documents
  (was leaking unmasked license numbers, internal document paths,
  verification notes).
- **Seed hardcoded password removed** — `seed.js` no longer falls back to a
  fixed literal password; production refuses to boot without an explicit
  `SEED_SUPER_ADMIN_PASSWORD`, development generates and logs a random one.

### AI
- **Native Gemini migration** (`ai/providers/geminiProvider.js`) using
  `@google/genai`. `ai/providers/openaiProvider.js` deleted; a repo-wide
  test confirms no OpenAI code/config remains in the backend.
- **PHI minimization** (`ai/providers/phiMinimizer.js`) — strips contact/ID
  fields and tokenizes names before any data reaches the external provider;
  tokens are restored locally in the response.
- **Real AI health check** — `getAIProviderStatus()` performs an actual
  authenticated model lookup, cached briefly, rather than reporting
  "healthy" merely because a provider object exists.
- **Admin AI UI truthfulness** — the admin AI health card now labels the
  active provider's real kind (`TEMPLATE` vs `LLM_GENERATIVE`) instead of
  implying every provider is a language model.

### Production configuration
- **`config/productionGuards.js`** — a single, unit-tested validator that
  rejects, in production: the in-memory test payment gateway, sandbox
  Razorpay keys (unless explicitly overridden), weak/placeholder JWT
  secrets, localhost origins, non-Gemini AI providers, and ephemeral local
  storage without an explicit persistence confirmation. Verified with real
  child-process boot tests (production actually fails to start with a bad
  config, not just a unit-level assertion).
- **Test payment gateway isolation** (`payments/paymentGateway.js`) — the
  test gateway module is not even importable in a production process, and
  the adapter independently refuses to select it as a second layer.

### Payments / billing
- **Canonical payment-status group** — `Payment.status === "paid"` (not a
  real enum value) was used in two doctor-revenue/funnel queries, always
  returning zero. Fixed via one canonical `CAPTURED_LIKE_PAYMENT_STATUSES`
  export on the `Payment` model; two other files' duplicate/drifted copies
  of the same array consolidated onto it.
- **Tax rate canonicalization** — `HospitalSetting.paymentSettings.taxRate`
  (admin-editable) was previously decorative; actual billing
  (`paymentController.js`, `invoiceService.js`) read a disconnected env var
  `CONSULTATION_TAX_RATE` (default 0%). `invoiceService.js` additionally had
  a unit bug (percentage value multiplied with no `÷100` — `taxRate=18`
  would have produced an 1800% tax line). Fixed via
  `services/hospitalSettingsService.js#getTaxRatePercent()`, consistent
  percentage semantics in both call sites, env var removed from
  `.env.example`.
- **`refundsEnabled` enforcement** — same disconnect pattern; now enforced
  in refund-request intake (patient path) and in the three money-moving
  admin actions (`initiateRefund`, `approveRefundRequest`,
  `retryRefundRequest`), each checked before any state mutation.

### Storage
- **Storage abstraction** (`storage/storageService.js`) — local disk and
  S3-compatible drivers behind one interface, opaque keys, path-traversal
  guarded. S3 driver tested against an injected fake client (no live AWS
  access in this environment).
- **Docker persistent-volume mismatch fixed** — every upload destination
  used to be the bare relative string `"storage/..."`, resolved against
  `process.cwd()`; inside the built Docker image (`WORKDIR /app`, `CMD node
  backend/server.js`) that resolved to `/app/storage/*`, while the
  persistent volume in `docker-compose.yml` is mounted at
  `/app/backend/storage`. Every upload was silently written to the
  ephemeral container layer and lost on redeploy. Fixed for all five
  upload categories (doctor documents fully migrated onto
  `storageService`; patient reports, insurance documents, doctor profile
  photo, and CMS banner fixed to resolve against the same absolute,
  Docker-volume-matching root via `localCategoryDir()`, but not yet fully
  migrated onto the `storageService` abstraction itself — see Section C).
- **Doctor documents — fully migrated end-to-end**: memory-storage upload
  → `storageService.upload()`; magic-byte validation on the buffer
  (`assertValidBufferUpload`); real physical file deletion on delete
  (previously DB-only, permanently orphaning files); verified documents
  blocked from deletion (409) with no replacement workflow yet to supersede
  them; a new authenticated self-download endpoint
  (`GET /doctor/documents/:id/download`); `storageKey` stripped from every
  response (doctor's own list, admin doctor-detail, admin verify-document,
  admin download) so no internal storage path/identifier is ever returned
  to a client. Migration for legacy data:
  `migrations/007_doctor_documents_storage_key.js`.
- **Frontend doctor document download** — previously there was genuinely no
  way for a doctor to view a document they'd uploaded (no button, no
  working link). Added a working download button in
  `src/pages/doctor/DoctorDocuments.jsx` and blocked the delete button for
  verified documents to match the backend guard.

### Scheduler
- **Distributed locking** — `models/CronRunLog.js` has a partial unique
  index (`{jobName}`, `status:"running"`), making MongoDB itself the lock.
  `utils/cronRunTracker.js#trackRun()` detects contention via the resulting
  duplicate-key error, skips a genuinely-running job (resolves with
  `{skipped:true}`, never throws), and reclaims a stale lock (>30 min, no
  `finishedAt`) from a crashed process.
- **`automation/cronJobs.js` standalone entrypoint added** — this file
  (drives 6 reminder jobs, AI insights, and the smart assignment sweep) had
  **no standalone CLI entrypoint at all** before this checkpoint; it could
  only be invoked through the admin on-demand API. Nothing scheduled it in
  production. Now has the same `process.argv[1]?.endsWith(...)` pattern as
  the other four cron scripts.
- **Circular-import TDZ bug found and fixed** — while testing the new
  entrypoint for real (not just reading the code), `automation/cronJobs.js`
  crashed on import with `Cannot access '_internal' before initialization`.
  Root cause: `workflow/assignment/assignmentEngine.js` and
  `assignmentScheduler.js` destructured a circularly-imported export
  (`_internal` from `operationsAdminController.js`) at module top level.
  Fixed by deferring the property access to call time. This would have
  made the exact command the scheduler documentation tells an operator to
  run crash on every invocation.
- **`docs/SCHEDULER-ARCHITECTURE.md`** written — documents every job, its
  suggested schedule, the locking mechanism, and is explicit that the
  platform-side Cron Job configuration itself is not verified in this
  environment.

### Feature toggles
- **`services/featureToggleService.js`** — cached reads, a real
  deterministic per-user rollout-percentage gate (same user always lands on
  the same side of the line for a given feature+percentage), an Express
  middleware, and a socket-safe function form.
- **Five previously-inert toggles now enforced**: `wallet_system` (wallet
  recharge order creation), `subscriptions` (doctor subscription creation),
  `reviews` (review creation), `chat` (socket `chat:send`, with
  `super_admin` support chat explicitly exempted), `ai_features` (all
  patient/doctor-facing AI routes; admin AI monitoring/automation endpoints
  deliberately left ungated so an admin can still see AI health while the
  feature is off for everyone else). `registrations_paused` was already
  genuinely enforced before this checkpoint (verified, not re-implemented).

### Admin permissions
- **Verified, not rebuilt**: `requirePermission` middleware
  (`middleware/adminMiddleware.js`) is genuinely wired across dozens of
  admin routes and reads from the `Permission` model correctly.
- **Found a subtler truthfulness gap**: `super_admin` always bypasses every
  permission check unconditionally, and it is the *only* admin-tier role in
  the three-role model — so the permission-editing UI currently cannot
  affect any real access decision for any role. Rather than removing this
  (reasonable forward-compatible infrastructure) or inventing a disallowed
  fourth role, added a truthful banner to
  `src/pages/admin/AdminAccessControl.jsx` stating this plainly.

---

## B. IMPLEMENTED BUT LIVE-EXTERNAL-VERIFICATION-UNAVAILABLE

These have real, tested code paths (via injected/fake clients or
child-process boot tests) but have **not** been exercised against the real
external system in this environment:

- **Gemini** — `geminiProvider.js` is tested against an injected fake
  `@google/genai` client (real request-shaping, PHI minimization, JSON
  contract enforcement, error handling all exercised). The actual Google
  Generative Language API has never been called from this environment.
- **MongoDB (production)** — this sandbox cannot reach any MongoDB
  instance (`fastdl.mongodb.org` / `repo.mongodb.org` are blocked, no
  local `mongod`/`mongosh` available). Every backend test that would
  normally hit a database instead stubs the relevant Mongoose model
  methods directly (a pattern already established in this repo's test
  suite before this checkpoint, e.g. `Doctor.findOne = ...`). **No test in
  this checkpoint has run against a real MongoDB, including transaction
  semantics, real index behavior, or real aggregation behavior.**
- **Razorpay** — the test-gateway/production-gateway separation and the
  `paymentGateway` adapter are verified structurally and via child-process
  boot tests; no live Razorpay API call has been made from this
  environment.
- **Brevo (email)** — not touched in this checkpoint's changes; email
  delivery-status truthfulness (Phase 16) has not been implemented or
  re-verified.
- **AWS S3** — `storageService`'s S3 driver is tested against a fully
  injected fake `S3Client` (`PutObjectCommand`/`GetObjectCommand`/
  `HeadObjectCommand`/`DeleteObjectCommand` all exercised with real
  request shapes). No real AWS credentials or bucket have been used.
- **Deployment-platform scheduler (Render Cron Jobs / equivalent)** —
  `docs/SCHEDULER-ARCHITECTURE.md` documents the exact commands and
  suggested schedule, but no Render account or equivalent platform
  configuration exists or has been verified from this environment. Whether
  these jobs are actually scheduled anywhere in a real deployment is
  **unknown** and must be configured and confirmed separately.

---

## C. STILL NOT IMPLEMENTED

Everything below is either untouched or only partially addressed. This list
is deliberately specific rather than a repeat of the original 40-phase
prompt.

1. **Storage abstraction — remaining upload categories.** Patient reports,
   insurance documents, doctor profile photos, and CMS banners got only the
   Docker-path fix (`localCategoryDir()`), not the full end-to-end
   `storageService` migration doctor documents received (no S3 support for
   these categories yet, `filePath`-style fields likely still stored
   verbatim for these — needs re-verification against the current schema
   for each model).
2. **Appointment booking-window / daily-limit enforcement.**
   `HospitalSetting.appointmentLimits.bookingWindowDays` and
   `dailyPerDoctor` are read only for public display; nothing actually
   stops a patient from booking arbitrarily far in the future or enforces
   a per-doctor daily cap. Found but not fixed.
3. **Full appointment/payment/refund/payout state-machine audit** per
   Phases 2, 4, 6, 7, 8 of the original mission — a substantial amount of
   this was found, on inspection, to already be well-implemented in the
   existing codebase (a real `STATUS_TRANSITIONS` map, signature+amount+
   idempotency-guarded payment finalization, a real refund state machine).
   This has **not** been independently re-verified end-to-end in this
   checkpoint session beyond the specific `Payment.status==="paid"` bug
   already fixed. Treat the original mission's claims about this area with
   skepticism until re-audited — several of its other claims about this
   codebase did not hold up under inspection.
4. **CMS / Articles / Services publish-state truthfulness** (Phase 22) —
   not inspected or touched.
5. **Analytics metric definitions** (Phase 23) — not inspected or touched
   beyond the payment-status fix in Section A.
6. **Pagination / unsafe large-list limits** (Phase 27) — not inspected.
7. **Admin user activation idempotency** (Phase 28) — not inspected.
8. **Exports (CSV/PDF correctness, truncation disclosure)** (Phase 29) —
   not inspected.
9. **Standardized error-code taxonomy** (Phase 30) — not inspected.
10. **Database integrity audit** (dangling relations, duplicate indexes,
    orphan records) (Phase 31) — not performed.
11. **Transactional consistency review** (MongoDB sessions/transactions for
    multi-document invariants) (Phase 32) — not performed. Given this
    environment cannot reach a real MongoDB, transaction behavior
    specifically cannot be verified here even if implemented.
12. **Email (Brevo) delivery-status truthfulness** (Phase 16) — not
    touched.
13. **Privacy/data-deletion lifecycle truthfulness** (Phase 17) — not
    touched.
14. **Subscription/payout financial truthfulness** (Phases 7–8 of the
    original mission — "manual settlement vs real transfer," entitlement
    enforcement) — not independently re-verified in this checkpoint.
15. **Dead-code / duplicate-endpoint sweep** (Phase 35) — not performed as
    a dedicated pass.
16. **Repo-wide security sweep beyond what's listed in Section A** (Phase
    36) — the regex-injection and mass-assignment sweeps ARE done; IDOR,
    CORS, rate-limiting, and file-upload MIME validation beyond what
    already existed have not been independently re-audited in this
    checkpoint.
17. **Full API↔UI connection matrix** (Phase 38) — not built.
18. **The six final deliverable documents** named in the original mission
    (`FINAL-REMEDIATION-REPORT.md`, `FINAL-REMEDIATION-MATRIX.json`,
    `FINAL-API-MATRIX.md`, `FINAL-AUTHORIZATION-MATRIX.md`,
    `FINAL-STATE-MACHINE.md`, `FINAL-TEST-REPORT.md`) **do not exist.**
    Only `docs/SCHEDULER-ARCHITECTURE.md` and this checkpoint's two
    documents exist.
19. **Production-like E2E test run** (Phase 39, real HTTP + real Socket.IO
    + real frontend flows) — not performed; this environment has no
    reachable MongoDB to run the actual application against.
20. **The final ZIP deliverable named in the original mission**
    (`MediCore-HMS-FINAL-END-TO-END-REMEDIATED.zip`) — not created. This
    checkpoint's zip is explicitly a mid-remediation snapshot, not that
    final deliverable.

---

## D. TEST STATUS (this checkpoint, run just before packaging)

| Check | Result |
|---|---|
| Backend test suite (`npm --prefix backend test`) | **144 passed, 0 failed (144 total)** |
| Frontend test suite | **No frontend test script exists in `package.json`** — there is nothing to run. `npm run test:backend` is the only test script defined at the root; `vitest`/`jest` are not configured for the `src/` frontend. |
| ESLint (`npx eslint .`, repo root) | **Clean — 0 errors, 0 warnings** |
| Production frontend build (`npm run build`) | **Succeeds.** Output: `dist/assets/index-*.js` at 706.42 kB (207.40 kB gzip), with Vite's standard >500 kB chunk-size advisory (not an error). |

No live-MongoDB test run was possible in this environment (see Section B).

---

## E. NEXT REMEDIATION ORDER

Suggested order for the next session, highest real-world risk first, based
on what Section C identifies as still open:

1. **Re-verify Section C item 3** (appointment/payment/refund/payout state
   machine) independently before trusting either the original mission's
   claims or this checkpoint's provisional "looks already solid" read —
   this is financially load-bearing and deserves its own dedicated audit
   pass, not an assumption in either direction.
2. **Booking-window / daily-limit enforcement** (Section C item 2) — small,
   well-scoped, already root-caused.
3. **Finish the storage abstraction migration** for patient reports,
   insurance documents, doctor profile photos, and CMS banners onto
   `storage/storageService.js` (Section C item 1), following the exact
   pattern already established for doctor documents.
4. **Database integrity + transactional consistency** (Section C items
   10–11) — do this before, not after, any further financial-flow changes,
   since it will surface issues that change how those flows should be
   written.
5. **CMS/analytics/exports/pagination/error-taxonomy** (Section C items
   4–9) — these are independent of each other and can be parallelized
   across sessions if needed.
6. **Email (Brevo) + privacy lifecycle** (Section C items 12–13).
7. **Dead-code sweep + full API↔UI matrix** (Section C items 15, 17) — do
   this near the end, after the functional work above, so it reflects the
   final shape of the code rather than an intermediate state.
8. **Write the six final deliverable documents** (Section C item 18) —
   last, once there is something true left to document.
9. **Production-like E2E run** (Section C item 19) — requires a reachable
   MongoDB; if the next session also lacks one, this step must remain
   explicitly marked unverified rather than skipped silently.

---

## F. KNOWN LIMITATIONS

- **No git repository exists in this working tree.** `git status` returns
  `fatal: not a git repository`. There is no commit history, no hash, and
  no way to diff this checkpoint against a prior state via git. The next
  session may want to `git init` and commit this checkpoint as a baseline
  before continuing, if change tracking is wanted going forward.
- **No live database has ever been used to validate any of this session's
  work.** Every test in Section A/D that touches a Mongoose model does so
  via direct method stubbing, not a real MongoDB instance. Index behavior
  (including the new partial unique index for cron locking), aggregation
  pipelines, and transaction semantics are unverified against real MongoDB
  in this environment.
- **The original mission's problem list should not be taken as an accurate
  audit of this specific codebase.** Repeatedly during this remediation,
  claims in the injected task prompts (e.g., "permission matrix is largely
  cosmetic," implicitly "state machine is unreliable") did not hold up
  against direct inspection of the actual code — this repository had
  already received substantial prior remediation work (visible in
  extensive pre-existing "AUDIT FINDING" comments) before this session's
  involvement began. Sections A and C above reflect what was *actually*
  found and fixed or found and left open in this codebase, not the
  original prompt's generic list.
- **This checkpoint's own fixes have only been verified via this
  repository's existing test conventions** (source-inspection assertions,
  stubbed models, injected fake external clients, child-process boot
  proofs). They have not been verified via a running application under
  real traffic.
- **Frontend has no automated test coverage at all**, checkpoint or
  otherwise — this predates this session and was not addressed.
