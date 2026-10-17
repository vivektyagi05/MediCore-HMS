# Phase P9 — Documents & Records

## Real problem identified

A patient uploading a report/document against a named doctor had no
reliable path to that doctor's attention unless the report happened to be
critical or urgent severity. The backend already computed a real,
per-doctor `pendingReports` list (title, category, severity, patient name,
report date) on every Command Center load — but that array was only ever
reduced to a `.length` for a Dashboard counter. The counter's click-through
went to Smart Inbox, which is built entirely from persisted
`NotificationDelivery` records — and normal-severity report uploads never
create one. Result: an accurate "N reports awaiting review" count that,
for most of those N, led nowhere actionable. Separately,
`clinicalEmitter.reportUploaded()` had existed since Phase D2 but was never
called from any producer — confirmed dead code via full-repo grep.

## Already complete — audited, not touched

- `MedicalReport`/`Certificate`/`Prescription` models and all patient-side
  CRUD (family-member scoping, tagging, search, pin, edit, delete, share,
  AI summary — verified honestly grounded, no fabricated content).
- Doctor's own identity/license Document Center + admin verification
  workflow (`DoctorDetailWorkspace.jsx` ↔ `verifyDoctorDocument`).
- Doctor's ownership-checked (`ensureDoctorTreatedPatient`) read access to a
  specific patient's reports, wired into `DoctorPatientProfile` and
  `DoctorClinicalWorkspace`.
- Admin platform-wide critical-report visibility via Mission Control /
  Operations Queue (`critical_report` operation type) — confirmed this
  reuses the existing Unified Operations Queue architecture correctly; its
  lack of an in-drawer "open the file" action is a pre-existing, uniform
  limitation shared by every operation type except `payment_failure`, not a
  Documents-specific gap, and is out of this phase's scope.
- File-storage security: magic-byte signature validation, randomized
  filenames, no static exposure of the storage directory — every file
  access goes through an authenticated, ownership-checked download route.

## What changed

### Backend
- **New**: `backend/services/reportAttentionAggregates.js` —
  `computeReportAttentionItems()`, a pure, DB-independent function
  classifying unreviewed reports into critical/warning/info priority from
  the patient's own declared severity (never inferred from title/notes
  text), oldest-unreviewed-first within each tier. Same pattern as
  `reviewAdminAggregates.js`'s `computeReviewAttentionItems`.
- **Changed**: `commandCenterController.js`'s `pendingReports` field now
  calls this shared function instead of an unclassified ad-hoc `.map()` —
  single source of truth for both the Dashboard's count/preview and the new
  Documents-page panel.
- **Fixed dead code**: `clinicalEmitter.reportUploaded()` is now actually
  called from `uploadReport` (patientWorkflowController) for every report
  with a named doctor, regardless of severity — for parity with its
  siblings (`reportReviewed`, `scheduleUpdated`). Documented honestly in
  code: this raw socket event, like its siblings, is not yet listened for
  anywhere in the frontend's `RealtimeContext` (which only listens for a
  fixed `SOCKET_EVENTS` set). Emitting it is still correct and free — it
  starts working the moment a generic listener is added — but it does not
  itself deliver live-tab UX today. **Wiring a generic dashboard-sync
  listener for all of clinicalEmitter's raw events is a real, confirmed gap
  spanning appointments/prescriptions/certificates/schedule, not just
  documents — explicitly DEFERRED as out of P9's scope.** The doctor's real,
  working attention path remains the persisted critical/urgent notification
  (unchanged) and, for every severity, the Command Center data below.

### Frontend
- **`DoctorDocuments.jsx`**: new "Patient Reports Needing Review" panel —
  the full, real `pendingReports` list (all severities) with a working
  "Mark Reviewed" action (`markReportReviewed`) and an "Open Patient" link
  per item. Reuses `commandCenterApi.getCommandCenter()`, already used
  elsewhere — no new endpoint, no duplicate calculation.
- **`DoctorDashboard.jsx`**: `needsActionItems` now surfaces the top 5
  non-critical (urgent/normal) unreviewed reports with the same working
  action, plus an overflow item linking to the Documents page when there
  are more than 5 — closing the "accurate count, dead-end click" gap for
  the majority (normal-severity) case. Critical reports' existing dashboard
  treatment is unchanged.
- **`DoctorHomeWidgets.jsx`**: the "Reports awaiting review" counter now
  links to `/doctor/documents` (where the full, real list now lives)
  instead of `/doctor/inbox` (which only ever showed the subset with a
  persisted notification).

### Tests
- **New**: `backend/tests/reportAttentionAggregates.test.mjs` — priority
  classification, missing-severity fallback, ordering (priority-first,
  oldest-within-tier), patient-identity unwrapping/fallback, empty-input
  handling. 8 assertions, all passing.

## Deferred (documented, not silently dropped)

- Cross-cutting: no frontend listener exists for any of
  `clinicalEmitter`'s raw per-event socket emissions
  (`report:uploaded`/`reviewed`, `schedule:updated`, `prescription:created`,
  `certificate:created`, `document:verified`) — a generic dashboard-sync
  bridge for these is a real gap spanning multiple phases, out of P9 scope.
- Patient-side report "Preview" modal shows notes text + download, not an
  inline file/PDF preview.
- Prescription "Print" uses a page-wide `window.print()` rather than a
  scoped print view.
- Patient's own report list is capped at 100 with no true pagination.

None of the above block P9 completion; each is a genuine, separately
scoped improvement, not manufactured to pad this phase.

## Gap-closure round (rejected-and-resubmitted)

The first submission of this phase was correctly rejected: the count/CTA
fix above was accepted as real, but three genuine Documents workflow gaps
remained un-closed. This round closes all three, in the same codebase, no
parallel implementation:

### 1. Real document preview
- **New**: `src/components/shared/SecureFilePreview.jsx` — fetches the file
  through the exact same authenticated, ownership-checked download endpoint
  every "Download" button already used (no new route, no storage exposure,
  no public URL). Renders it via a short-lived `blob:` object URL: real
  `<iframe>` PDF rendering, real `<img>` for images, a clear "preview
  unavailable + secure download" fallback for anything else, and real
  loading/error/retry states. The blob is re-tagged with the record's own
  stored `mimeType` rather than trusted from the response's Content-Type.
- Wired into `PatientRecords.jsx`'s report preview modal (now `size="xl"`),
  replacing the metadata-only placeholder that only showed notes text.

### 2. Patient report pagination
- `listReports` (patientWorkflowController) now does real DB-level
  `.skip()/.limit()` pagination via the shared, already-tested
  `clampPagination`/`buildPaginationMeta` utility (the same one
  `doctorReviewController` and every admin list endpoint use) — replacing
  the old fixed `.limit(100)` that silently dropped anything beyond it.
  Existing search/category/family-member/pinned/date filters compose with
  pagination at the query level, so nothing is silently lost.
- **New**: `GET /patient/reports/categories` (`getReportCategories`) — a
  tiny, ownership-scoped `distinct()` so the category filter dropdown still
  reflects every category the patient has, not just whichever page happens
  to be loaded now that `listReports` is paginated. Not a second category
  taxonomy — reads the same free-text `category` field that already exists.
- `PatientRecords.jsx` gained a real Previous/Next pagination control
  (same UX convention as `PatientPayments.jsx`), URL-param-driven for
  consistency with this page's existing filter pattern; changing any other
  filter resets to page 1, and the backend's existing page-clamping means a
  delete that empties the last page can never strand the user on a blank
  page.

### 3. Prescription print workflow
- `SecureFilePreview` gained an optional `showPrintButton` prop: for PDFs,
  renders a "Print" button that calls the iframe's own
  `contentWindow.print()` — scoped to just the rendered PDF (the `blob:`
  URL is same-origin to the parent page) instead of `window.print()` on the
  entire application page (nav, sidebar, unrelated cards and all).
- `PatientRecords.jsx`'s prescription list now opens a real preview/print
  modal reusing the exact same `downloadPrescription` source of truth
  (the doctor-generated PDF at `Prescription.pdfPath`) — no second
  prescription model or workflow, just a different destination for the
  same fetched bytes.

### Full-flow re-audit (step 4)
Re-verified patient upload → storage → ownership → doctor attention →
review → patient/doctor visibility → download/preview → timeline → admin
visibility end-to-end. No dead buttons, no fake data, no duplicate source
of truth, no duplicate/colliding routes (`/reports/categories` confirmed
non-colliding with `/reports/:id/...`), no broken deep links, no
authorization bypass (`getReportCategories` uses the same `ownership(req)`
scope as every other report endpoint), no business-rule regression.
Grepped the entire frontend for `window.print()` and bare `<Printer>`
usage — the prescription button fixed here was the only occurrence in the
whole codebase. No existing project files were removed; only the specific
lines described above were changed.

**Explicitly NOT claimed as fixed** (per the correction this round
received): the raw `clinicalEmitter` socket-event listener gap noted in the
first P9 submission remains genuinely cross-cutting (spans appointments,
prescriptions, certificates, schedule — not just documents) and is left
documented as DEFERRED in this file's "Deferred" section above, not
silently patched over or claimed complete.

### Verification (gap-closure round)
- Backend: 64/64 tests passing, unchanged from the first submission (no
  regression) — the reused `clampPagination`/`buildPaginationMeta` utility
  already carries its own dedicated test coverage
  (`paginationValidation.test.mjs`), so its correctness here is inherited,
  not re-implemented.
- `npm run lint`: 0 errors, 0 warnings (one `react-hooks/refs` error and one
  stray eslint-disable found and fixed during this round — see commit
  history — mutating a ref during render was replaced with a `useEffect`
  sync).
- `npm run build`: clean.
- Backend boot: clean (`ECONNREFUSED` on Mongo only — expected).
- Fresh-extract re-verification: performed on this round's packaged ZIP —
  see verification log below.
- Live MongoDB/browser E2E: **UNVERIFIED** — unavailable in this sandbox,
  as in every prior phase. Every other check available in this environment
  (syntax, unit tests, lint, build, boot, fresh-extract, security review)
  was performed.
