# Global Flow Integrity Audit — 2026-09-25

Scope covered in this pass: **Section 3/4/5/6 — Doctor Onboarding, the
reported "empty onboarding accepted" bug, document verification
invariants, and the admin approval guard.** This is a P0-only pass, not
the full 24-flow (A–Z) sweep the source prompt describes — see
"What's not covered yet" at the bottom.

Investigation method: read the actual repository source (routes →
controller → model → frontend form) rather than assuming the field list;
no code was changed until the root cause was confirmed in all three
layers.

---

## ONB-001 — Doctor onboarding accepted with all mandatory fields/documents empty

- **Area:** Doctor onboarding (backend + frontend)
- **Severity:** CRITICAL
- **Current behavior (confirmed):** `POST /api/doctor/onboarding` returned
  `200` and moved `verificationStatus` to `"pending"` for a payload with
  every credential/location field blank and zero documents uploaded.
- **Expected business rule:** A submission missing any mandatory
  credential field or with no uploaded document must be rejected with an
  error before any lifecycle mutation occurs.
- **Root cause (all three layers confirmed empty):**
  1. **Frontend** (`src/pages/doctor/DoctorOnboarding.jsx`): no input has
     a `required` attribute, there is no client-side validation function,
     and the submit button is disabled only by `saving`/status, never by
     field completeness.
  2. **Route** (`backend/routes/doctor/onboardingRoutes.js`): `POST
     /onboarding` runs `protect` and `authorizeRoles` only — no
     validation middleware/schema of any kind.
  3. **Schema** (`backend/models/Doctor.js`): `licenseNumber`,
     `medicalCouncil`, `qualification`, `collegeName`, `graduationYear`,
     `state`, `district`, `city` are all `default: "" / null`, not
     `required: true`. `specialization` is `required: true` but also
     `default: "General Medicine"`, so omitting it entirely still passes
     schema validation with a fabricated value.
  4. **Controller** (`backend/controllers/doctorOnboardingController.js`,
     `submitOnboarding`): merged whatever fields were present via
     `pickOnboardingFields` (which only checks `!== undefined`, not
     blank/empty-string) and unconditionally set
     `verificationStatus = "pending"` — no completeness check existed at
     all.
  5. **Existing "regression test"**
     (`backend/tests/phase1OnboardingContract.test.mjs`) never caught
     this because it doesn't call the endpoint — it `fs.readFileSync`s
     the controller source and greps for string literals. It would pass
     regardless of whether the mandatory-field check existed.
- **Affected files:** `backend/routes/doctor/onboardingRoutes.js`,
  `backend/controllers/doctorOnboardingController.js`,
  `backend/models/Doctor.js`, `src/pages/doctor/DoctorOnboarding.jsx`.
- **Affected APIs:** `POST /api/doctor/onboarding`.
- **Affected UI:** Doctor onboarding form.
- **Data consistency risk:** Doctor records enter the admin verification
  queue looking reviewable (`verificationStatus: "pending"`) while
  containing no real credential data, and (see ONB-002) could previously
  be approved in that state.
- **Recommended fix (implemented in this pass):** Added
  `getOnboardingMissingRequirements(doctor)` in
  `doctorOnboardingController.js` — a single exported backend gate
  checked against the fully-merged, post-master-data-resolution doctor
  state. `submitOnboarding` now throws a `400 AppError` listing every
  missing field/document and performs **no mutation and no `save()`**
  when anything is missing (no partial record, no admin notification, no
  email). Deliberately **not** applied to `updateOnboarding` — an
  already-approved doctor must still be able to save incremental edits
  (location fields are explicitly allowed to be cleared for that flow;
  see `masterDataService.js`).
- **Test added:** `backend/tests/onboardingMandatoryFields.test.mjs`
  (cases A, B, D, G from the source prompt's negative-case list, plus the
  full-completeness positive case).
- **Still to do:** ~~add real `required` markers + client-side validation
  to `DoctorOnboarding.jsx`~~ — done in the 2026-09-25 P0-completion follow-up
  below.

---

## ONB-002 — Admin could approve a doctor with zero verification documents

- **Area:** Admin doctor verification
- **Severity:** CRITICAL
- **Current behavior (confirmed):** `approveDoctor`
  (`backend/controllers/doctorController.js`) only checked
  `verificationStatus === "pending"` via an atomic
  `findOneAndUpdate`. Nothing checked `documents.length`, so any doctor
  that reached "pending" (e.g. via ONB-001) could be approved with no
  evidence on file.
- **Expected business rule:** "Verified doctor → all prerequisites
  required by the repository's actual verification rules must already be
  satisfied" (source prompt, §5). At minimum: at least one document must
  exist.
- **Root cause:** No document-presence check anywhere in the approval
  path; the concurrency-safe atomic transition (a real, previously-fixed
  race-condition guard) only ever validated lifecycle status, not
  evidence completeness.
- **Affected files:** `backend/controllers/doctorController.js`
  (`approveDoctor`).
- **Affected APIs:** `PATCH`/approval endpoint wired to `approveDoctor`
  (see `backend/routes/doctorRoutes.js` for the exact verb/path).
- **Data consistency risk:** A doctor could be publicly listed as
  `verificationStatus: "approved", isVerified: true` with no supporting
  documents ever having existed.
- **Recommended fix (implemented in this pass):** `approveDoctor` now
  throws a `409 AppError` before the atomic update if
  `existing.documents` is empty. This is defense-in-depth, independent of
  ONB-001 — it holds even if a future change reopens the submission-side
  gap.
- **Test added:** `backend/tests/doctorApprovalDocumentGuard.test.js` —
  a real Express app + supertest integration test (real routes, real
  middleware, real `approveDoctor`), with only the `Doctor`/`User`
  Mongoose models mocked, matching the existing
  `doctorApproveBodyContract.test.js` pattern. (Correction to this
  document's earlier text: the existing harness does **not** run against
  a real Mongo connection — a live MongoDB isn't reachable in this
  sandbox at all, and `mongodb-memory-server`'s binary download is
  blocked by network egress rules here, exactly as documented in that
  file's own header comment. The mocked-model + real-HTTP-layer pattern
  is this repo's established, honest substitute, not a shortcut taken for
  this fix.) Covers: zero-documents → 409, the atomic transition is never
  reached in that case, doctor status is left untouched, and at-least-one-
  document → approval still succeeds normally. Also fixed a real
  regression this guard caused in the pre-existing
  `doctorApproveBodyContract.test.js` fixture (its fake doctor had no
  `documents` field) by adding a document to that fixture, not by
  weakening the new guard.

---

## What's not covered yet

The source prompt's Sections 7–24 (transaction/partial-mutation safety
across all 26 business flows A–Z, error-swallowing audit via
`try/catch`/`console.warn` grep, master-data edge cases, file/storage
integrity, the duplicate `CronRunLog` index warning, and a full
API-response-contract normalization) were **not** attempted in this
pass. This repository is large (backend has 25+ doctor-related files
alone, plus appointments, payments, wallet, subscriptions, CMS, etc.),
and each of those sections deserves the same read-the-actual-code,
confirm-root-cause-in-every-layer treatment given to ONB-001/ONB-002
rather than a fast pass that risks exactly the kind of "looks fixed but
isn't" outcome this audit exists to prevent.

Suggested next slice, in the priority order the source prompt itself
lays out: finish P0 (frontend validation for ONB-001, the ONB-002
integration test) — that's the next message-sized chunk — then move to
P1 (error-swallowing audit, §14) since it's mechanically searchable and
likely to surface more `res.json({success:true})`-after-`catch` patterns
like the ones ONB-001/002 grew around.

---

## 2026-09-25 follow-up — P0 completion (frontend validation + ONB-002 test)

Closes the two "still to do" items above. Everything here was verified
with real tool runs in this sandbox (`npm install` worked — the registry
is reachable even though a live MongoDB is not), not asserted from
reading code alone.

- **Frontend validation implemented:** `src/utils/doctorOnboardingValidation.js`
  (new) mirrors `getOnboardingMissingRequirements` field-for-field.
  `src/pages/doctor/DoctorOnboarding.jsx` now shows required-field markers,
  inline RED errors after the first submit attempt, a documents-missing
  banner, a location-missing banner, and blocks submission client-side
  (toast, no request sent) when required data is missing. `specialization`'s
  schema-level `default: "General Medicine"` was investigated per the task's
  explicit instruction: the default was **not** removed (a legitimate
  already-approved doctor's record still needs a non-crashing fallback
  value elsewhere in the app), but the onboarding completeness gate treats
  an unselected specialization as missing regardless of that default — both
  the backend (`effectiveMasterValue`, reading the MASTER/OTHER selection,
  never the fallback-filled plain field) and the new frontend contract judge
  the doctor's *selection*, not the schema default.
- **Dependency-loading/failure gating:** `DoctorLocationFields.jsx` gained
  an additive, backward-compatible `onStatusChange(loading, error)` prop
  (its other caller, `DoctorProfessionalProfile.jsx`, does not pass it and
  is unaffected). Submit is disabled while specialization/location data is
  still loading (YELLOW warning if attempted) and blocked with a RED error
  if that data failed to load (a reload is genuinely required at that
  point, which is why it's an error rather than a warning).
- **Input-focus regression: investigated, no defect found.** Read
  `DoctorOnboarding.jsx`, `Input.jsx`, `Card.jsx`, `Button.jsx`, and
  `DoctorLocationFields.jsx` end to end looking for the classic causes (a
  component type defined inside another component's render body, an
  unstable `key`, a remounting parent). None of those patterns exist in
  the current code — every input is a stable, module-level component
  rendered directly, and `updateField`/`onChange` handlers being
  recreated each render does not itself cause focus loss. No frontend
  test tooling (vitest/jsdom/testing-library) is configured in this repo
  to mechanically prove typing behavior, so this is a code-reading
  conclusion, not a passing test — reported as "not reproducible in the
  current source" rather than "fixed," since there was nothing here to
  fix. If this was observed in a running browser, it may be worth
  re-checking directly against a live instance.
- **ONB-002 integration test:** added and passing — see the ONB-002
  section above for detail (test file, what it covers, and the real
  regression it caught in an existing fixture).
- **Incidental finding (not fixed, out of scope for this pass):**
  `npm test` (`backend/tests/run-all.mjs`) only discovers `*.test.mjs`
  files. The vitest-style `*.test.js` integration tests — the
  pre-existing `doctorApproveBodyContract.test.js`, `api.test.js`, and
  the new `doctorApprovalDocumentGuard.test.js` — are never run by that
  script; they only run via `npx vitest run`. This means the real-HTTP
  integration coverage for `approveDoctor` (including the new ONB-002
  test) currently requires a manual `npx vitest run` and is not part of
  whatever CI/pre-commit step calls `npm test`. Wiring vitest into the
  official test script is worth doing but touches CI/build config beyond
  this focused task's scope.
- **Verification performed:**
  - `node tests/run-all.mjs` (backend): **147/147 passed** (146 existing +
    `onboardingMandatoryFields.test.mjs` from the earlier ONB-001/002
    backend pass; a 147th test, `doctorOnboardingValidation.test.mjs`, was
    added in this follow-up).
  - `npx vitest run tests/doctorApproveBodyContract.test.js
    tests/doctorApprovalDocumentGuard.test.js`: **8/8 passed**.
  - `npm run lint` (root ESLint): **clean, zero errors/warnings.**
  - `npm run build` (Vite production build): **succeeded** (pre-existing
    unrelated chunk-size-limit informational warning only).
  - Fresh-folder verification: see the delivered checkpoint zip and its
    accompanying report for the clean-extract re-run of the above.
