# MediCore HMS — Doctor Command Center (Phase D1)

Scope: Doctor Dashboard, Doctor Patients, Doctor Appointments — evolved into
one connected Doctor Command Center, per the mission brief's stop condition.
Everything below is additive on top of the existing Doctor Workspace ->
Digital Clinic phase; no architecture was rewritten, no model was replaced.

## 1. Audit findings — what already existed but was never surfaced

This was the single biggest finding, and it drove almost everything shipped
in this phase:

- `Appointment` documents already carry real per-visit clinical data
  (allergies, existingConditions, currentMedications, painLevel, symptoms,
  consultationMode) from the earlier Appointment Journey phase, plus real
  links to Insurance, MedicalReport, FamilyMember, Payment, and Invoice — but
  `getDoctorPatients` only ever extracted name/email/gender/bloodGroup/visit
  count. None of that linked data was ever populated or shown to the doctor.
- `User.patientProfile` already stores medicalConditions, medications,
  allergies, and vitals (from the Personal Health Intelligence phase) — never
  joined into the doctor-facing patient view at all.
- `getDoctorAnalytics` already computed solid productivity numbers
  (approval rate, most active day, revenue trend) but had no visibility into
  the doctor's actual *workload state* — pending prescriptions, incomplete
  consultations, today's emergencies.
- `dashboardSyncTick` (realtime) was already wired app-wide but only
  `DoctorDashboard` listened to it — Patients and Appointments never
  refreshed on realtime events.
- The existing AI pipeline (promptLibrary / templateProvider /
  generativeAssistant / aiAssistController) was fully built out for
  patient-side and admin-side use, but had no doctor-facing per-patient
  summary capability.

## 2. Bug found and fixed

`getDoctorPatients`'s "Last Visit" was computed as `max(date)` across *all*
appointments regardless of whether they were in the past or future — so a
newly booked future appointment could show up as the patient's "Last Visit."
Fixed by splitting into real `lastVisit` (most recent non-cancelled visit
`<= now`) and `nextVisit` (earliest non-cancelled visit `> now`), which is
also exactly what the mission brief asks the Patient card to show.

## 3. Backend changes (all additive)

- **`getDoctorPatients`** (`backend/controllers/doctorController.js`) —
  same original response shape preserved, extended with: real risk level
  (deterministic, rule-based from pain level / condition count / allergies —
  explicitly *not* an AI guess), clinical alerts (allergy on file, insurance
  expiring, outstanding bill, high pain level), insurance status, outstanding
  bill amount, linked report count + recent reports, linked family members,
  recent prescription count, and upcoming follow-up date (from real
  `Prescription.followUpDate`). One extra lightweight `Prescription` query
  added; everything else reuses populate() on the existing appointment
  query, mirroring the pattern already used in `appointmentController.js`.
- **`getDoctorAnalytics`** (`backend/controllers/doctor/workflowController.js`)
  — extended (all existing fields untouched) with `pendingApprovals`,
  `incompleteConsultations`, `pendingPrescriptions` (consultation completed
  but no `Prescription` on file for that appointment — computed via one
  lightweight `Prescription` projection query), `emergencyToday` (pain level
  ≥ 8 today), `reportsSharedToday`.
- **New AI capability: `patientClinicalBrief`** — added to the existing
  pipeline (`promptLibrary.js`, `templateProvider.js`,
  `generativeAssistant.js`, `aiAssistController.js`, `aiAssistRoutes.js`,
  new route `GET /api/ai/assist/patients/:patientId/brief`, doctor-only).
  Grounded only in that doctor's own real visit history with the specific
  patient (verified via a real `Appointment.find({doctorId, patientId})`
  before ever generating text) — never a diagnosis, never an invented
  condition/medicine/date. This is the "AI Summary" the mission brief asks
  for on the Patient Relationship Center, built by extending the existing
  swappable-provider pipeline — not a new chatbot.

## 4. Frontend changes

- **`DoctorDashboard.jsx`** — added: Emergency Alerts section (today's
  pain-level ≥ 8 patients), Doctor Productivity stat row (incomplete
  consultations, pending prescriptions, approval rate, unread reviews),
  priority-colored rows in Today's Clinic, Follow-up Queue and Patient Risk
  Summary cards (real data from the enriched patients endpoint), Smart
  Search (client-side, over already-fetched patients), Recently Viewed
  Patients, and a Live Activity Feed reusing the existing realtime
  notifications list. All existing sections (current consultation, pending
  approvals, upcoming patients, earnings, quick actions) preserved.
- **`DoctorPatients.jsx`** — rebuilt as the Patient Relationship Center:
  risk-level badge + clinical alerts per card, insurance status, outstanding
  bill, report count, family members, condition/allergy chips, next-visit
  field (bug fix above), pin/bookmark (client-only, localStorage, mirrors
  the existing recently-viewed pattern used elsewhere in the app), risk /
  follow-up / pinned filters, sort by name/last-visit/risk, and an inline
  "AI Summary" panel per patient powered by the new `patientClinicalBrief`
  endpoint. Now listens to `dashboardSyncTick` for realtime refresh.
- **`DoctorAppointments.jsx`** — rebuilt as Appointment Intelligence: queue
  tabs (Today / Upcoming / Pending Approval / Emergency / Completed /
  Cancelled / All), insurance / report / "needs prescription" badges per
  row (from data already returned by the existing `getAppointments`
  endpoint), bulk "Quick Approve Selected" for the pending queue (loops the
  existing single-appointment update endpoint — no new bulk backend
  endpoint was fabricated), an AI Queue Optimization panel reusing the
  existing `getWorkflowSuggestions` endpoint. Now listens to
  `dashboardSyncTick` for realtime refresh.
- **New shared utility** `src/utils/doctorPatientPreferences.js` — pinned
  patients + recently-viewed patients, localStorage-only, mirroring the
  existing `src/utils/recentlyViewed.js` pattern already used elsewhere.

## 5. Explicitly deferred, not fabricated

- A true bulk-update backend endpoint (bulk approve currently loops the
  existing single-update endpoint — real and correct, just not a single
  round trip).
- Calendar view, drag-and-drop timeline, and keyboard shortcuts — genuine
  UI investments with no missing backend data behind them; scoped out as
  follow-up polish rather than rushed.
- "Missing report" / "incomplete prescription" *alerts as push
  notifications* — the counts are real and now surfaced, but no
  notification-delivery hook was added for them (would need new cron/socket
  wiring, out of scope for this phase per the mission's own "extend only
  where necessary").
- Exact ₹ outstanding-bill amount inside the AI clinical brief — the brief
  currently reports only a count of unpaid visits there (the full Payment
  populate needed for the exact amount isn't loaded in that code path);
  the Patient Relationship Center card itself does show the real ₹ amount.

## 6. Verification

- `npm run build` — clean, no errors.
- `npx eslint` on every new/modified file — zero errors (one pre-existing,
  unrelated `no-unused-vars` in `templateProvider.js`'s `renderExpenseSummary`
  from an earlier phase, confirmed untouched).
- `node --check` on all 7 modified/added backend files — all pass.
- `node server.js` boot check (dummy `MONGO_URI`/`JWT_SECRET`) — all routes
  and controllers load cleanly; fails only on `ECONNREFUSED` to MongoDB,
  since there is no live database in this sandbox. Not claimed as a live
  end-to-end verification.
- All 17 pre-existing plain-assert backend test files — all pass, unchanged.
- The one Vitest suite (`api.test.js`) still cannot run in this sandbox:
  `mongodb-memory-server` needs to download a MongoDB binary from
  `fastdl.mongodb.org`, which isn't reachable from this network-restricted
  environment. Flagged as unverified, not claimed as passing.
- Not verified: a live click-through of the new AI patient brief, bulk
  approve, or realtime refresh against a real MongoDB + running frontend —
  no live DB/browser available in this sandbox.

## Deliverable

`MediCore-HMS-doctor-command-center.zip`
