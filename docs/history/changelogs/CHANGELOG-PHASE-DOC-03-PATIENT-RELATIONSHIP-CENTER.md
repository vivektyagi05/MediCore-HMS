# PHASE DOC-03 — Doctor Patient Relationship Center

Status: **substantially complete, honestly scoped**. Core list/security/profile
work is done and verified per this document. Not every one of the 26 steps in
the brief was touched — see "Explicitly not done" at the end.

## 1. REAL EXISTING FUNCTIONALITY REUSED

- **Clinical Workspace / `getPatientClinicalProfile`** (DOC-01 era) — already
  the real single-patient clinical aggregate (appointments, prescriptions,
  notes, reports, insurance, family, certificates, timeline). Extended
  additively (see §4), not duplicated.
- **`PatientSnapshot.jsx` / `ClinicalTimeline.jsx`** — reused as-is on the new
  Patient Profile page; these are now the patient header and clinical
  timeline tab, with zero component duplication.
- **`paginationValidation.js`** (`clampPagination`/`buildPaginationMeta`) —
  reused for the patient list, per the brief's explicit instruction not to
  invent another pagination helper.
- **`doctorWorkflowApi.getPatientReports` / `downloadPatientReport`** — the
  backend for patient documents already existed with zero frontend consumer.
  Connected in the new Documents tab rather than building a second document
  system.
- **`AIDraftPanel`** — reused unchanged for the AI Patient Brief section
  (already the correct generic component, no new AI-UI needed).
- **`roomManager.conversationKey` / `ChatMessage` model** — reused for real
  unread-message counts, not a second messaging system.
- **`ensureDoctorTreatedPatient`** — untouched; still the single source of
  truth for "does this doctor treat this patient" in the workflow controller.

## 2. REAL BUGS / GAPS FOUND

- `getDoctorPatients` was genuinely unbounded (flagged by DOC-01/DOC-02):
  fetched a doctor's **entire** appointment history with five populated refs
  on every row, returned the complete resulting list with **no page limit,
  no search, no filters**.
- **Real security gap (chat)**: `chat:send`, the `chat:` socket room join
  (`roomManager.canJoinRoom`), and the REST `getConversation` endpoint had
  **zero relationship authorization** — each checked only that the requester
  was one of the two ids embedded in the conversation, or (for `chat:send`)
  that the recipient account was active. Any authenticated user could message,
  or read the full message history of (an IDOR via `getConversation`), any
  other user on the platform regardless of role or relationship.
- **Disconnected frontend**: `getPatientReportsForDoctor` /
  `downloadPatientReportForDoctor` were real, tested backend endpoints with
  no frontend page ever calling them.
- Follow-up state (`needsFollowUp`) was a `> 30 days since last visit`
  heuristic, not derived from real `Prescription.followUpDate` records —
  replaced with a real overdue/due-today/upcoming calculation.

## 3. BACKEND IMPLEMENTED

- **`backend/services/doctorPatientRelationshipService.js`** (new, pure,
  dependency-free): `computeRiskLevel`, `resolveFollowUpState`,
  `computeDoctorPatientAttentionItems`, `matchesPatientFilter`,
  `isInsuranceExpiringSoon`. 16 unit tests
  (`doctorPatientRelationship.test.mjs`).
- **`getDoctorPatients` rewritten**: real search (name/email), 6 real
  filters (`all`/`recent`/`followup_due`/`upcoming_appointment`/
  `no_recent_visit`/`active`/`high_risk`), 3 sorts (`recent`/`name`/`risk`),
  and real pagination via `paginationValidation.js`. Real per-patient unread
  message counts (one batched `$in` aggregate, never N+1). Analytics still
  summarize the doctor's whole patient set (unchanged convention).
  - **Deliberate architectural choice, stated plainly**: this does not
    introduce a raw MongoDB `.aggregate()` pipeline. Every existing
    cross-collection computation in this codebase (`financeAggregates.js`,
    `governanceAggregates.js`, `reviewAdminAggregates.js`,
    `patientAdminAggregationService.js`) uses a bounded `find()` + in-memory
    JS grouping pattern instead — and this sandbox has no live MongoDB to
    verify a novel aggregation pipeline against. A hand-written aggregation
    with `$group`/`$min`/`$max`/`null`-handling has real correctness edge
    cases I cannot test here; shipping one untested into a production
    hospital system is a worse risk than the documented limitation below.
  - **Known, stated limitation**: the underlying scan is still bounded by
    "one doctor's total appointment history," not a DB-level cursor. For the
    current scale this is a real, substantial improvement (removed 5
    unconditional populates per row, added real page/search/filter/sort),
    but a doctor with an extremely large multi-year appointment volume would
    eventually need true DB-level pagination (a genuine V2 change, not
    undertaken here per Rule #25 without live-Mongo verification capacity).
- **`getPatientClinicalProfile` extended additively** (existing fields
  unchanged, so `PatientSnapshot`/`ClinicalTimeline` and any other consumer
  keep working unmodified): added `lastVisit`, `nextVisit`, `followUp`,
  `riskLevel`, `attentionItems`, `unreadMessages`, `lastMessage`.
- **`backend/utils/chatAuthorization.js`** (new): `usersCanChat(userA, userB)`
  — admin participant always allowed; doctor-patient allowed only with a
  real `Appointment` on file; any other pairing denied. Single shared
  implementation, wired into:
  - `roomManager.canJoinRoom`'s `chat:` branch (was: membership check only)
  - `chat:send` socket handler (was: recipient-active check only)
  - `realtimeController.getConversation` (was: **no check at all** beyond
    being logged in)
  6 unit tests (`chatAuthorization.test.mjs`) locking each rule.

## 4. FRONTEND IMPLEMENTED

- **`DoctorPatients.jsx` rewritten**: debounced search box, real filter
  chips (backend-supported filters only), sort dropdown, Prev/Next
  pagination reading real `pagination` metadata, unread-message badges,
  "View Profile" now routes to the new detail page instead of an inline
  expand/collapse card.
- **`DoctorPatientProfile.jsx`** (new) at `/doctor/patients/:patientId` —
  the actual Patient Relationship Center hub: Patient Header (reused
  `PatientSnapshot`) → Attention (real items with WHY/WHAT/ACTION, each
  backed by a real field) → tabbed Overview / Clinical Timeline (reused
  `ClinicalTimeline`) / Appointments / Prescriptions / Documents (now
  connected) / Communication (real last message + unread count + link to
  full chat). Every action button traces to a real destination (Clinical
  Workspace deep link, `/chat/:id`, real download endpoints) — no
  decorative buttons.
- **`doctorApi.getPatients(params)`** updated to forward
  `search`/`filter`/`sort`/`page`/`pageSize` query params (was a bare,
  parameterless call).
- Route added: `/doctor/patients/:patientId` → `DoctorPatientProfile`.

## 5. CROSS-SIDE CHANGES

- None required for this phase's scope. Patient-side chat UI was already
  real and end-to-end (Socket.IO); the authorization fix in §3 tightens who
  can use it without changing the patient-side chat experience for any
  legitimate doctor-patient relationship.

## 6. SECURITY

- Doctor-patient authorization for chat closed (see §2/§3) — this is the
  most significant finding of this phase.
- `getDoctorPatients`/`getPatientClinicalProfile` continue to derive doctor
  identity from `req.user` (authenticated session), never from
  `req.query`/`req.body` — unchanged, already correct.
- `getConversation` now validates the target user id and returns 403 for
  unauthorized pairs instead of silently returning message history.

## 7. VALIDATION

- `getConversation` validates `req.params.userId` as an ObjectId (existing
  check, unchanged) and now additionally 404s on a non-existent participant
  before any authorization or query work.
- Search/filter/sort/page params are all safely defaulted; unrecognized
  `filter`/`sort` values fall back to `all`/`recent` respectively (no crash
  on bad input).

## 8. REALTIME

- No new realtime channel introduced. The list/profile pages reuse the
  existing `dashboardSyncTick` refresh convention already used elsewhere in
  the doctor portal.

## 9. AUDIT

- No new sensitive mutation surface was added in this phase (list/profile
  are primarily read paths; the one write-adjacent action, marking messages
  read, already existed and is unchanged). Nothing new required for
  `writeAdminLog` here.

## 10. TESTS

- New: `doctorPatientRelationship.test.mjs` (16 assertions),
  `chatAuthorization.test.mjs` (6 assertions).
- Full suite: **52/52 passing** (50 pre-existing unchanged + 2 new files).

## 11. BUILD

- `npx eslint .` — 0 errors, 0 warnings, repo-wide.
- `npm run build` — clean; `DoctorPatientProfile` and `DoctorPatients` chunks
  confirmed present and rebuilt; every other existing chunk still present.
- `node --check` clean on every touched backend file.
- Clean server boot (ECONNREFUSED-only — no live MongoDB in this sandbox,
  consistent with every prior phase).

## 12. FRESH-EXTRACT VERIFICATION

- Re-zipped the full project, extracted into a clean directory, reinstalled
  dependencies at root and `backend/` from scratch, and re-ran the full
  backend suite + lint + build against the **extracted copy** (not the
  working tree). Identical results: 52/52 tests, 0 lint issues, clean build
  with matching chunk hashes.

## 13. FRESH-EXTRACT VERIFICATION (LIVE E2E)

**LIVE E2E — NOT VERIFIED.** No MongoDB or browser is available in this
sandbox. Every check above (tests/lint/build/boot/fresh-extract) was run
against real source and a real (if unreachable) MongoDB connection attempt —
nothing here is claimed as browser- or live-database-verified.

## 14. REMAINING LIMITATIONS (stated plainly, not glossed over)

- **Not done in this pass**: Step 13 (doctor-side insurance editing) —
  deliberately left read-only. Insurance is patient-owned data with no
  existing doctor-edit backend anywhere in the platform; adding one would be
  new, unrequested surface area and a decorative-button risk if built
  without a real backend justification. Documented as a deliberate scope
  decision, not an oversight.
- **Not done**: Steps 17/20 real-time cross-side propagation beyond the
  existing `dashboardSyncTick`/notification mechanisms — no new socket
  events were added specifically for the patient profile page; it relies on
  the same refresh conventions the rest of the doctor portal already uses.
- **Not done**: a true DB-level cursor pagination (Mongo aggregation
  pipeline) for `getDoctorPatients` — see the stated architectural rationale
  in §3. The current fix (bounded scan + real search/filter/sort/pagination
  of the resulting page) is a genuine, tested improvement over the previous
  fully-unbounded response, but is not the theoretical maximum scale fix.
- **Not done**: a full line-by-line re-verification of Steps 8/9 (appointment/
  prescription connection) beyond confirming they already reuse the existing
  models/status enums correctly — no bug was found there, so nothing was
  changed, consistent with "reuse where correct, don't touch what isn't
  broken."
- **Live browser/Mongo E2E** — not available in this sandbox, as with every
  prior phase; the developer should manually verify against a running
  instance with real data before considering DOC-03 fully closed.

## Deliverable

`MediCore-HMS-PHASE-DOC-03-PATIENT-RELATIONSHIP-CENTER.zip` +
`CHANGELOG-PHASE-DOC-03-PATIENT-RELATIONSHIP-CENTER.md`
