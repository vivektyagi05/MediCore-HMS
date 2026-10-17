# PHASE DOC-04 — Doctor Appointments Rebuild

## 1. What already existed and was reused (not rebuilt)

- Appointment model, status enum, `STATUS_TRANSITIONS`, `CANCELLABLE_STATUSES`, `ACTIVE_STATUSES` — unchanged, reused as-is.
- `cancelAppointmentCore` (shared cancellation service: reason capture, automatic refund-request creation for paid appointments, notification, cancelReason persistence) — already used by patient and admin cancellation. Doctor cancellation is now routed through it too (see below) instead of a rebuild.
- `ensureDoctorAvailable`, `findBlockedDate`, `generateDaySlots`, leave-request conflict checks — all reused verbatim by the new reschedule endpoint. No second conflict-detection engine was written.
- Conflict detection at booking/approval time — already real and correct; untouched.
- Design system primitives (Card, Button, Modal, StatusBadge, MetricCard, Tabs, Select, Textarea, ErrorState, EmptyState, Loader) — all reused, none re-invented.
- Admin's `AppointmentCancelDialog`, `AdminAppointments.jsx`, `AppointmentDetailWorkspace.jsx` — behavior fully preserved; the cancel dialog is now a thin wrapper over a new shared component instead of a rewrite.
- Realtime/notification conventions (`notificationEmitter.emitToUser`, `dashboardSyncTick`) — the new reschedule notification follows the exact same pattern the existing (tested) cancellation flow already uses, including its known limitation that `emitToUser` alone does not ping `dashboard:sync` — this matches existing behavior, not a new gap.

## 2. What was actually broken (found via source audit, not assumed)

1. **Doctor-initiated cancellation bypassed the shared cancellation service.** `DoctorAppointments.jsx` and `DoctorDashboard.jsx`'s "Reject"/"Cancel" actions called the generic `PUT /:id/status` with `status: "cancelled"`. That path never captured a reason, never created an automatic refund request for a paid appointment, and never set `cancelReason` — a real financial/audit gap, not cosmetic. Patient and admin cancellations already went through `cancelAppointmentCore`; the doctor path had silently drifted from it.
2. **No dedicated doctor cancel endpoint existed** — `PATCH /:id/cancel` was patient-only.
3. **No server-side search** on the doctor appointment list — it fetched a capped 200 rows and filtered patient name/email in the browser, silently missing matches outside that page.
4. **No real backend-driven pagination on the frontend**, and no summary endpoint — stats (Total/Pending/etc.) were computed from whatever page happened to be loaded, which becomes wrong the moment real pagination is used (admin already solves this with a dedicated summary endpoint; doctor had none).
5. **Rescheduling did not exist anywhere in the codebase** — no model field, no endpoint, no UI (only a reminder-message string mentioned the word "reschedule").
6. **The "needs attention" rule was defined only in the admin controller** — the doctor page had no equivalent, and duplicating it inline would have created two independently-maintained copies of the same rule.
7. **`buildDateRangeFilter` had no `quickDate` shortcut** — only `dateFrom`/`dateTo`, while admin's controller had grown its own separate `quickDate` handling inline, an emerging duplicate.

## 3. Backend changes

- **`backend/utils/appointmentAttention.js` (new):** `buildAttentionMatch()` (Mongo fragment) and `computeNeedsAttention()` (pure predicate) extracted from the admin controller's previously-inline `ATTENTION_MATCH`/`needsAttention` logic. Admin controller now imports and re-exports `ATTENTION_MATCH` from here instead of holding its own copy — confirmed byte-identical behavior via the pre-existing `adminAppointmentAttentionAndFinance.test.mjs`, which still passes unchanged.
- **`buildDateRangeFilter` (appointmentController.js) extended, not replaced:** added `quickDate=today|upcoming|past` support. `dateFrom`/`dateTo` still take priority when present, and the function's exported name and existing behavior for those two parameters is byte-for-byte unchanged — the pre-existing `appointmentDateRangeFilter.test.mjs` still passes unmodified.
- **`resolvePatientSearchFilter()` (new):** real, index-backed patient name/email search, scoped to doctor/admin callers only (a patient searching their own appointments by their own name is meaningless).
- **`getAppointments` extended:**
  - `search` param (see above), combined via `$and` with any existing filter (e.g. a doctor viewing one patient's history + searching within it).
  - `excludeStatus` param (comma-separated) for "today, but not cancelled"-style queries without a second round trip.
  - `status` param now also accepts a comma-separated list (`$in`), so the frontend's "Completed" tab (`consultation_completed,completed,review_eligible`) is one real paginated query instead of three merged client-side fetches.
  - `attentionOnly=true` param (doctor-only) for a real, paginated Attention queue.
  - Doctor-facing rows are now enriched with a real `needsAttention` flag using the same rule as admin's list — never two different definitions of "needs attention" depending on which screen you're on.
- **`getAppointmentSummary` (new, doctor-only, `GET /api/appointments/summary`):** real parallel `countDocuments` aggregate over the doctor's full appointment collection (not the paginated slice the list renders) — Total/Pending/Approved/PaymentPending/PaymentCompleted/ConsultationStarted/ConsultationCompleted/Completed/Cancelled/ReviewEligible/Today/Upcoming/Emergency/NeedsAttention. Deliberately does not include revenue (that's Doctor Business Intelligence's job — not duplicated here).
- **`updateAppointmentStatus` now refuses `status: "cancelled"` outright** with a 400 explaining the caller must use the dedicated cancel endpoint. This closes the bug at the root for every current and future caller (doctor, admin, or anyone else), rather than patching each UI call site individually.
- **`cancelAppointment` is now role-aware:**
  - Patient branch: unchanged ownership check and behavior.
  - Doctor branch (new): verifies the doctor owns the appointment (via `ensureDoctorProfileForUser` + doctor ID match), **requires a non-empty reason** (matching admin's existing requirement), and calls `cancelAppointmentCore` with `cancelledBy: "doctor"`. This is the single fix that makes refund-request creation, notification, and `cancelReason` persistence work correctly for doctor cancellations — the `cancelledBy !== "patient"` branch in `cancelAppointmentCore` already notified the patient correctly for any non-patient canceller, so no change was needed there.
- **`rescheduleAppointment` (new, `PATCH /:id/reschedule`):** real, end-to-end implementation.
  - Eligibility gate reuses `CANCELLABLE_STATUSES` (one source of truth — locked in by a new contract test, see below) rather than a second hand-maintained status list.
  - Re-validates the new date/slot with the *exact same* `ensureDoctorAvailable` + approved-leave + active-appointment-conflict checks the booking flow already uses — never a UI-only date picker.
  - Records a real `rescheduleHistory` entry (from/to date+slot, who rescheduled, optional reason, timestamp) rather than silently overwriting the old value.
  - Notifies whichever side did not initiate the reschedule, and emits a realtime `appointment:rescheduled` event, following the exact same pattern the existing cancellation flow uses.
- **`Appointment` model:** additive `rescheduleHistory` array field, defaulted to `[]` — every existing document and consumer is unaffected.
- **`appointmentEmitter.rescheduled()` (new):** mirrors the existing emitter functions' structure and the cancellation flow's notification pattern exactly.
- **Routes:** `GET /appointments/summary` (doctor-only), `PATCH /:id/cancel` (now also authorizes `DOCTOR`), `PATCH /:id/reschedule` (new, patient/doctor/admin).

## 4. Frontend rebuilt

- **`DoctorAppointments.jsx`** fully rebuilt around the brief's recommended information architecture:
  - Tabs: Today's Clinic / Attention / Pending Approval / Upcoming / Completed / Cancelled / All — replacing the old flat 7-tab row's ad hoc "Emergency" tab with a real, backend-driven Attention queue (while keeping the emergency pain-level visual highlight inline on rows, since that's a distinct clinical signal from the operational attention rule).
  - Real server-side search (debounced), status filter, and Prev/Next pagination — no more capped 200-row client-side fetch-and-filter.
  - Stats strip now reads from the new doctor-scoped summary endpoint instead of being computed from whatever page happens to be loaded.
  - New "Details" action opens `DoctorAppointmentDetailDrawer` (new component) — built entirely from data the list endpoint already returns (no new backend call), with deep links to Open Patient / Open Clinical Workspace / Message Patient rather than duplicating those pages, per the brief's explicit Step 4 guidance.
  - New "Reschedule" action opens `RescheduleAppointmentDialog` (new, shared component) — pulls real available slots via the existing `getAvailableSlots` endpoint.
  - "Reject"/"Cancel" now open the new shared `CancelAppointmentDialog` (reason required) instead of firing a bare status update.
- **`DoctorDashboard.jsx`:** its "Reject"/"Cancel" quick actions (both in Today's Clinic and Pending Approval Requests) now go through the same shared `CancelAppointmentDialog` + the new cancel endpoint instead of the old broken direct `updateStatus(id, "cancelled")` call.
- **`src/components/shared/CancelAppointmentDialog.jsx` (new):** role-agnostic cancel modal. Admin's `AppointmentCancelDialog.jsx` is now a thin wrapper over it (same public props, zero changes needed in `AdminAppointments.jsx` or `AppointmentDetailWorkspace.jsx`) instead of a second hand-maintained modal.
- **`src/components/shared/RescheduleAppointmentDialog.jsx` (new)** and **`src/components/doctor/DoctorAppointmentDetailDrawer.jsx` (new)** as described above.
- **`appointmentApi.js`:** added `getAppointmentSummary()` and `rescheduleAppointment()`.

## 5. Patient-side / Admin-side impact

- No patient-side UI changes were required for basic reschedule reflection — `PatientAppointments.jsx` already renders `appointment.date`/`appointment.timeSlot` generically, so a reschedule shows up correctly without code changes. Patient-side reschedule *initiation* UI was deliberately not built this phase (out of scope for a Doctor Appointments phase) — the backend endpoint already supports it for a future patient-side phase.
- Admin's appointment pages are unaffected: `needsAttention` enrichment and the new `search`/`excludeStatus`/`attentionOnly` params only apply to the shared `appointmentController.getAppointments`, which the doctor/patient pages use — admin has its own separate `listAppointmentsAdmin` controller, untouched.
- Admin's cancel flow is unaffected in behavior (confirmed via the wrapper refactor); admin cancellation still requires a reason exactly as before.

## 6. Tests

- `appointmentQuickDateAndAttention.test.mjs` (new): locks in `quickDate` behavior and priority over `dateFrom`/`dateTo`, and confirms the extracted `computeNeedsAttention`/`buildAttentionMatch` produce the documented rule.
- `appointmentCancelRescheduleContract.test.mjs` (new): confirms via source inspection that (a) `rescheduleAppointment` gates eligibility through the shared `CANCELLABLE_STATUSES` list rather than a second one, (b) `cancelAppointment`'s doctor branch requires a reason, and (c) `updateAppointmentStatus` refuses direct cancellation.
- Pre-existing `appointmentDateRangeFilter.test.mjs` and `adminAppointmentAttentionAndFinance.test.mjs` still pass unmodified, confirming the extractions didn't change behavior.
- Full suite: **55/55 passing** (53 pre-existing + 2 new files).

## 7. Verification

- `node --check` clean on every backend file (fresh-extract sweep).
- Full backend test suite: 55/55 passing, both in the working tree and against a fresh extraction with dependencies reinstalled from scratch.
- `eslint .`: 0 errors / 0 warnings repo-wide (both working tree and fresh extraction).
- `npm run build`: clean production build, `DoctorAppointments` chunk present and grew (confirming compile), all other existing chunks still present.
- Clean server boot (ECONNREFUSED-only — no live MongoDB in this sandbox, consistent with every prior phase).
- Structural scans clean: no duplicate `/api/*` mounts, no hardcoded localhost in touched files, no fake/dummy/mock data patterns, no nested-button violations in new/touched JSX.

## 8. Explicitly NOT done (stated plainly, not glossed over)

- **Live browser/Mongo E2E** — unavailable in this sandbox, consistent with every prior phase. The 20-item manual verification checklist in the brief (Step 27) could not be run live; every item that can be verified statically/via tests/build has been.
- **Patient-side reschedule-initiation UI** — deliberately out of scope for a Doctor Appointments phase; the backend already supports it for later.
- **A new automation-studio trigger type for reschedule** — realtime event + notification are real and wired, but no `APPOINTMENT_RESCHEDULED` entry was added to `triggerRegistry.js` since no existing automation flow depends on one and this felt like scope creep beyond what's needed for the visible feature to work.
- **`emitToUser`-only realtime limitation on reschedule notifications** — inherited from the existing (already-shipped, tested) cancellation notification pattern, not something introduced or fixed this phase. Noted here rather than silently carried forward.
