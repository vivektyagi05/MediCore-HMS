# Patient Care Journey — Implementation Summary
Doctors → Saved Doctors → Appointments, rebuilt as one connected workflow.

## 1. Business Workflow

```
Doctors (discovery) → Doctor Profile → Save Doctor → Compare Doctors
   → Book Appointment (existing wizard) → Payment → Doctor Approval
   → Appointment Tracking → Consultation → Prescription → Records
   → Invoice → Review → Follow-up → Rebook
```

Every stage is real and backed by existing data — nothing fabricated:
- **Doctors** reuses the existing public discovery/compare/meta backend.
- **Saved Doctors** cross-references real appointment history for
  "previously consulted" and a genuine save-time snapshot for change alerts.
- **Appointments** reuses the existing status lifecycle, payments, invoices,
  prescriptions, insurance and family-member data already modeled.

## 2. User Journey Diagram

```
[Doctors page]
  search/filter/sort → view profile / compare / save → "Book"
        │
        ▼
[Booking Wizard]  (pre-existing, untouched)
        │
        ▼
[Appointments page]
  status tracker → pay → (doctor approves/starts/completes)
  → prescription + report + invoice appear inline
  → rate consultation → book follow-up (loops back to Doctors/Saved Doctors)

[Saved Doctors page]  (reachable from Doctors, and independently)
  shortlist with tags/notes/primary-physician → book again → compare
```

## 3. API Reuse Report

No duplicate endpoints were created. Reused as-is:
- `publicApi.searchDoctors / getSearchMeta / compareDoctors / getSimilarDoctors`
- `appointmentApi.getAppointments / cancelAppointment / createAppointment`
- `patientWorkflowApi.getSavedDoctors / saveDoctor / removeSavedDoctor / getPrescriptions / getReviews / saveReview`
- `invoiceApi.downloadInvoice`, `aiAssistApi.appointmentPrep`
- `AppointmentStatusTracker`, `AIDraftPanel`, `icsGenerator`, `recentlyViewed`, `concernMap`

New, additive-only backend surface:
- `PATCH /api/patient/saved-doctors/:doctorId` (`updateSavedDoctor`) — edits
  notes/tags/primary-physician on an already-saved doctor. Existing
  `POST /saved-doctors` (`saveDoctor`) extended to accept the same fields and
  capture a one-time fee/specialization snapshot on first save.
- `GET /api/appointments` populate extended (additive, non-breaking): patients
  now also receive `insuranceId`, `reportIds`, `paymentId`, `invoiceId`, and a
  wider doctor projection (`hospitalName`, `consultationMode`, `city`,
  `state`), matching what doctor requests already received.

## 4. Components Reused
`Card`, `Button`, `Input`, `Modal`, `Loader`, `EmptyState`,
`AppointmentStatusTracker`, `AIDraftPanel`, `BookingAuthGate` (public page,
untouched), `matchConcerns`, `getRecentlyViewed`, `downloadAppointmentICS`.

## 5. New Components
- `src/components/doctors/DoctorDiscoveryUI.jsx` — extracted from the public
  Doctor Search page (`StarRating`, `SkeletonCard`, `DoctorCard`,
  `FilterPanel`, `SORT_OPTIONS`, `DEFAULT_FILTERS`). The public page now
  imports from here instead of keeping its own copy — this removes the
  duplication that would otherwise exist between the public and patient
  discovery pages. `DoctorCard` gained two purely additive props
  (`saved`, `onToggleSave`) that the public page never passes, so its
  rendering is byte-for-byte unchanged.

## 6. Frontend Changes
- `src/pages/public/DoctorSearch.jsx` — refactored to import shared UI
  pieces; no behavior change (verified via lint + build).
- `src/pages/patient/PatientDoctorsDirectory.jsx` (Doctors) — full rebuild:
  advanced filters, sort, saved/bookmark, direct booking, compare (up to 4),
  recently viewed, popular/trending rail, decision-support chips, saved-only
  toggle.
- `src/pages/patient/PatientDoctors.jsx` (Saved Doctors) — full rebuild:
  tags, primary-physician flag, notes editing, real fee/specialization
  change detection, appointment-history cross-reference, compare, book-again.
- `src/pages/patient/PatientAppointments.jsx` (Appointments) — full rebuild:
  quick-filter tabs (Today/Upcoming/Needs Action/Completed/Cancelled), stats,
  AI visit-prep panel, insurance/report/prescription/invoice summaries per
  appointment, calendar export, join consultation (chat), directions
  (maps link), rebook, cancel, and a working review modal (the previous
  version linked to a `?review=` query param with no modal behind it).

## 7. Backend Changes
- `backend/models/SavedDoctor.js` — additive fields: `tags`,
  `isPrimaryPhysician`, `feesAtSave`, `specializationAtSave`.
- `backend/controllers/patient/patientWorkflowController.js` — `saveDoctor`
  extended (snapshot + tags/primary on upsert, primary-physician exclusivity);
  new `updateSavedDoctor`.
- `backend/routes/patient/workflowRoutes.js` — new `PATCH /saved-doctors/:doctorId`.
- `backend/controllers/appointmentController.js` — `getAppointments` populate
  extended for patient requests (see API Reuse Report). Ownership is
  unaffected: `buildRoleBasedFilter` already scopes every patient query to
  their own `patientId`, so this only ever returns the patient's own records.
- `src/api/patientWorkflowApi.js` — added `updateSavedDoctor`.

## 8. Security
- New `PATCH /saved-doctors/:doctorId` route sits behind the same
  patient-auth middleware as the existing saved-doctors routes; the
  controller re-derives ownership from `req.user._id` on every call — a
  patient can only ever edit their own saved-doctor record.
- The widened `getAppointments` populate was checked against
  `buildRoleBasedFilter`: patients are always filtered to `patientId: req.user._id`
  before any populate runs, so no cross-patient data exposure was introduced.
- `isPrimaryPhysician` exclusivity is enforced server-side (not just in the
  UI) via an `updateMany` that unsets any other primary for that patient.

## 9. Performance
- No new N+1 queries: the Saved Doctors "previously consulted" and "active
  appointment" data is derived from the single existing
  `appointmentApi.getAppointments` call already made by that page, grouped
  client-side by `doctorId` — not a per-card fetch.
- The "Popular with patients like you" rail on the Doctors page reuses the
  existing `sort=bookings` server-side aggregation instead of a new endpoint
  or client-side scoring.
- Recently-viewed and decision-support chips remain pure client-side/local
  storage as originally designed — zero extra network calls.

## 10. UX Improvements
- Every button performs a real action against real data — the previous
  Appointments page's "Review" button linked to a dead `?review=` query
  param; it now opens an actual review modal wired to the existing
  `saveReview` endpoint.
- Empty states, skeleton loading, and sticky compare/filter bars carried
  over from the public search experience for visual consistency across the
  whole care journey.
- Fee/specialization change badges on Saved Doctors are computed from a real
  save-time snapshot — never a fabricated "3 days ago" style claim.

## 11. AI Integration Summary
- Doctors page: "Popular with patients like you" rail (real `bookings` sort,
  not a fabricated ML score).
- Appointments page: "AI: Prepare for your next visit" panel using the
  existing `aiAssistApi.appointmentPrep` + `AIDraftPanel`, identical pattern
  to the Patient Dashboard — every draft carries the existing disclaimer and
  is grounded in the appointment's own real data. No diagnosis, nothing
  auto-applied without the patient generating it explicitly.

## 12. Verification Report
- **Frontend lint:** `npx eslint src/` → 0 errors, 0 warnings (full repo).
- **Frontend build:** `npm run build` → clean, all three rebuilt pages plus
  the new shared `DoctorDiscoveryUI` chunk built successfully.
- **Backend syntax:** `node --check` on every modified backend file → clean.
- **Backend boot:** `node server.js` with a sandbox `.env` → loads all
  routes/controllers/models cleanly; only failure is the expected
  `ECONNREFUSED` (no live MongoDB in this sandbox).
- **Backend tests:** all 17 pre-existing plain-assert test scripts pass
  unchanged. The one Vitest-based suite (`tests/api.test.js`) could not run
  because `mongodb-memory-server` cannot download its MongoDB binary in this
  network-restricted sandbox (blocked domain, unrelated to this change) —
  flagged as unverified rather than claimed passing.
- **Not verified:** a live end-to-end click-through against a real MongoDB
  instance (booking → save → appointment lifecycle → review) — no live DB
  available in this environment.

## Explicitly deferred (not fabricated)
- "Slot alerts" / real-time push notifications for saved-doctor availability
  changes — no notification-scheduling infrastructure exists for this yet;
  the fee/specialization change badges are the honest, data-backed version
  of this feature available today.
- Doctor "distance" filtering — no patient/doctor geocoordinates exist in the
  data model.
- Family appointments as a first-class filter on the Appointments page —
  the family member is now shown per-card (real data), but a dedicated
  family filter was left out pending confirmation this is wanted, per the
  "next implementation mission" scope boundary (Payments/Wallet excluded).
