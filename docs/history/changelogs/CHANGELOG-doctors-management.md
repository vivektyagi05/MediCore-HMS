# PHASE UI-2 — Doctor Management Workspace

## Scope actually delivered

A real, connected Doctor Management Workspace for admins: an enriched list
(search/filter/sort/stats) and a tabbed Doctor Detail Workspace (Overview /
Verification / Documents / Performance / Reputation / Earnings), all backed
by real endpoints — no fabricated metrics, no dead buttons, no duplicate
calculations.

This phase deliberately did **not** rebuild Availability/Schedule editing,
AI capabilities, or realtime event delivery for the Doctor domain (see
"Explicitly not implemented" below) — the existing Doctor domain audit
found these either already served by other pages or requiring
infrastructure (a job scheduler, a true cross-entity notification wiring)
that doesn't exist yet anywhere in the app, and inventing it here would be
exactly the kind of parallel/duplicate system the brief prohibits.

## Doctor domain audit — key findings

- **Doctor model/controller/routes are real and substantial.** Verification
  (approve/reject with history), a Document Center (upload/type/expiry/
  verify), and full CRUD already existed and persist correctly.
- **Reusable intelligence builders already exist**, exported from the
  doctor's own self-service controllers: `buildDoctorAnalyticsIntelligence`,
  `buildDoctorRevenueIntelligence`, `buildDoctorReviewIntelligence`,
  `buildDoctorReputationIntelligence`. The new admin Detail Workspace reuses
  these exact functions — the admin's Performance/Reputation/Earnings
  numbers can never drift from what the doctor sees on their own dashboard.
- **Real bugs found and fixed** (see below).
- **Permission model is role-level only** (no `manage_doctors`/
  `manage_payments` enforcement existed on doctor routes before this phase,
  even though those permission keys were already defined in the `Permission`
  model and used by the Executive Dashboard's revenue widgets). Extended
  that same precedent to the new admin earnings endpoint rather than
  inventing a new permission scheme.

## Real bugs found and fixed

1. **"Add Doctor" was completely non-functional.** The user picker was
   populated from the *Doctor list* and submitted a Doctor profile `_id` as
   the linked User's `_id`. `createDoctor`'s `User.findById(req.body.userId)`
   would always return null for that value, so every creation attempt
   failed with "Doctor user account was not found" — a real dead-end
   control that looked like it worked. Fixed with a new
   `GET /admin/doctors/eligible-users` endpoint (real doctor-role users
   without an existing Doctor profile) and rewired the form to use it.

2. **`deleteDoctor` was a blind hard delete with no safety check**, despite
   Doctor being referenced by Appointment/Review/Payment/Invoice (audited
   and confirmed — unlike Service, which has zero FK references anywhere,
   so its hard-delete was correctly left as-is in the prior phase). Deleting
   a doctor with appointment history would have silently orphaned every
   linked appointment, review, payment, and invoice. Extracted a pure
   `assertDoctorDeletable(appointmentCount)` guard (unit tested — see
   `tests/doctorDeleteSafety.test.mjs`) that blocks deletion when the doctor
   has any appointment on record and tells the admin to deactivate instead.

3. **Document "Open Document" was a broken, unauthenticated link.** The
   frontend built `href="http://localhost:5000/${doc.filePath}"` — hardcoded
   to localhost (breaks in any real deployment), pointing at a path this
   server has never statically served (no `express.static` mount exists for
   `storage/` anywhere), and carrying no auth token at all. Replaced with a
   real authenticated `GET /admin/doctors/:doctorId/documents/:documentId/
   download` endpoint (`res.download()`, same pattern already used for
   prescriptions/certificates/reports) and a blob-based frontend download —
   the same pattern every other real download in the app already uses.

4. **Document verification had no UI at all.** The backend route
   (`PUT /doctors/:doctorId/documents/:documentId/verify`) existed but had
   no client wrapper and no admin surface calling it — every uploaded
   document was permanently stuck at "pending." Added `doctorApi.
   verifyDocument()` and wired real Verify/Reject buttons into the
   Documents tab.

5. **Financial-data leak around the permission gate.** The shared
   `buildDoctorAnalyticsIntelligence` builder bundles revenue-derived fields
   (`revenue`, `revenueTrend`, `revenueFunnel`, `revenueForecast`,
   `growthForecast`, `monthlyGrowth`) together with pure activity metrics —
   correct for the doctor's own dashboard, which is always allowed to see
   its own revenue. The new admin Performance tab is intentionally *not*
   gated behind `manage_payments` (only the dedicated Earnings tab is), so
   those revenue fields are now stripped server-side in
   `getDoctorDetailAdmin` for any admin who doesn't hold that permission —
   otherwise Performance would have silently exposed the exact numbers
   Earnings was built to lock down.

## Backend changes

- `backend/controllers/admin/doctorAdminController.js` (new): `listDoctorsAdmin`
  (real aggregate: search by name/email via a `$lookup` on `users`,
  filter by verificationStatus/specialization/consultationMode/status/
  minRating, sort by name/newest/rating/experience/activity, real
  per-doctor `appointmentCount` and `pendingDocumentsCount` via aggregate),
  `getDoctorStatsAdmin` (real counts only — `attentionRequired` is a
  documented rule: pending verification OR any pending document OR a
  deactivated account, never a fabricated score), `getDoctorDetailAdmin`,
  `getDoctorEarningsAdmin` (gated behind `manage_payments`),
  `downloadDoctorDocumentAdmin`, `getEligibleDoctorUsersAdmin`.
- `backend/controllers/doctorController.js`: hardened `deleteDoctor` (see
  bug #2); extracted `assertDoctorDeletable` for unit testing.
- `backend/routes/admin/doctorAdminRoutes.js` (new), mounted at
  `/api/admin/doctors` in `app.js`.
- `backend/tests/doctorDeleteSafety.test.mjs` (new, 4 assertions).

Deliberately **not duplicated**: create/update/delete/approve/reject/
verify-document all stay on the existing `/api/doctors` routes; activate/
deactivate reuses the existing `PATCH /api/admin/users/:id/status` against
`doctor.userId` (a doctor's operational status IS their linked User's
`isActive` — there is no separate flag to invent).

## Frontend changes

- `src/pages/admin/AdminDoctors.jsx`: full reconstruction — SectionHeader,
  real stats row, FilterBar (search/verification/status/sort), AdminTable
  (Doctor/Specialization/Verification+pending-docs/Rating/Activity/Status/
  Actions), inline Approve/Reject for pending doctors (ConfirmDialog for
  approve, a real reason-required modal for reject — no `window.confirm`),
  Activate/Deactivate toggle, safe-delete ConfirmDialog whose copy reflects
  the real backend guard, and a fixed create-doctor form backed by the new
  eligible-users endpoint.
- `src/components/admin/DoctorDetailWorkspace.jsx` (new): the tabbed
  Overview/Verification/Documents/Performance/Reputation/Earnings drawer.
  Every field rendered is read from the real builder output confirmed by
  reading the backend source — no placeholder metrics. Earnings tab
  distinguishes a genuine 403 ("Financial data restricted") from any other
  load failure rather than treating every error the same way.
- `src/components/ui/Tabs.jsx` (new): tokenized tabs primitive for
  workspace-style pages.
- `src/components/ui/Modal.jsx` / `src/components/admin/AdminModal.jsx`:
  additive `size` prop (`md` default unchanged for all 21 existing
  callers; `xl` used only for the Doctor Detail Workspace).
- `src/api/adminApi.js`, `src/api/doctorApi.js`: new client methods for all
  of the above, including a real blob-based document download.

## Verification performed

- `node --check` clean on every new/modified backend file.
- Backend test suite: **29/29 passing** (28 pre-existing + 1 new
  `doctorDeleteSafety.test.mjs`).
- Clean server boot (ECONNREFUSED-only — no live MongoDB in this sandbox,
  same as every prior phase).
- `npx eslint .` across the whole frontend repo: **0 errors, 0 warnings**.
- Clean `npm run build` (AdminDoctors chunk confirmed present in the
  manifest, route tree intact).
- Manual read-through of every new component against the actual UI
  primitive contracts (Modal/ConfirmDialog/AdminTable/FilterBar/Select/
  Textarea) to avoid inventing props those components don't support.

## Explicitly NOT verified

- **Real browser / live-MongoDB end-to-end runs.** This sandbox has neither
  a browser nor a reachable MongoDB instance. Every "verified" claim above
  is a real, reproducible check (syntax, tests, boot, lint, build) — no
  click-through, network-tab, or DB-persistence check was performed or is
  being claimed.
- **Accessibility audit** (focus states, keyboard nav) — components reuse
  existing primitives that already carry `aria-label`/`aria-invalid`/
  `role` attributes, and new interactive elements got explicit
  `aria-label`s, but no automated or manual a11y pass was run.
- **Realtime/notification wiring for verification/document events** —
  intentionally left on refetch-after-mutation rather than inventing a new
  socket/event path (the brief explicitly prohibits a second event system;
  no existing Doctor-domain realtime channel covers these events yet).

## Explicitly not implemented (documented, not fabricated)

- **Availability/Schedule editing from the admin side.** The doctor's own
  Schedule/Availability pages already own this data end-to-end and are the
  single source of truth appointment booking reads from; building a
  second admin-side editor risked exactly the "duplicated availability
  state" the brief calls out. Left for a dedicated phase if genuinely
  needed.
- **AI capabilities** (verification summary, reputation summary, etc.) —
  the existing `promptLibrary`/`templateProvider`/`generativeAssistant`
  pipeline was audited but not wired into this phase; the Detail Workspace
  ships with real data only. Adding AI on top is additive future work, not
  a blocker for the core workspace.
- **A distinct reviewer/approver role for doctor verification** — the
  `Permission` model is role-level only (no reviewer/approver granularity),
  same constraint documented in the earlier Process Governance phase.

## Final completion matrix

| Feature | Status |
|---|---|
| Doctor domain audited | REAL + VERIFIED |
| Doctor list rebuilt (search/filter/sort/stats) | REAL + VERIFIED |
| Doctor detail workspace (6 tabs) | REAL + VERIFIED |
| Verification approve/reject | REAL + VERIFIED (reused existing endpoints) |
| Document verify | FIXED + VERIFIED (bug #4) |
| Document download | FIXED + VERIFIED (bug #3) |
| Create doctor (user picker) | FIXED + VERIFIED (bug #1) |
| Delete safety (FK check) | FIXED + VERIFIED (bug #2) |
| Activate/deactivate | REAL + VERIFIED (reused existing endpoint) |
| Performance / Reputation | REAL + VERIFIED (reused existing builders) |
| Earnings + permission gate | REAL + VERIFIED (bug #5 fix included) |
| Availability/Schedule admin editing | INTENTIONALLY NOT IMPLEMENTED |
| AI capabilities | INTENTIONALLY NOT IMPLEMENTED |
| Realtime event push for doctor events | INTENTIONALLY NOT IMPLEMENTED (refetch instead) |
| Browser / live-DB E2E run | UNKNOWN — NEEDS LIVE VERIFICATION |
| Accessibility audit | UNKNOWN — NEEDS LIVE VERIFICATION |
