# CHANGELOG — Phase P6 FINAL: Clinical Workspace 2.0 Gap-Closure

This is a gap-closure pass on the P6 deliverable described in
`docs/CHANGELOG-PHASE-P6-CLINICAL-WORKSPACE-2.0.md` (kept, not replaced —
this file records what changed since). No working system was rebuilt; every
change below is additive/corrective on top of the existing implementation.

## What was genuinely wrong before this pass

1. **IA was scattered, not hierarchical.** Since Last Visit and Medication
   Reconciliation only appeared on the "Overview" tab, invisible while
   actually documenting a consultation. Attention items existed but there
   was no distinct "what must I DO" queue (Open Clinical Actions).
2. **Desktop layout was two equal-width columns, not
   Context/Consultation/AI.** The Consultation tab was a plain 2-column grid
   with prescribing and AI panels mixed together.
3. **Attention-item routing was wrong.** Every non-chat/appointments item
   (follow-up, allergy, unreviewed report) fell into one bucket that jumped
   to the Consultation tab — report review didn't go to reports, follow-up
   didn't go to scheduling, allergy didn't go to patient context.
4. **Patient Context mixed clinical and administrative info at equal
   visual weight** (insurance/family pills sat next to allergy/medication
   pills with identical styling).
5. **Copilot's intent matching was too narrow** — 5 fixed phrases only, no
   synonym coverage, and evidence was a bare `{type: "prescription"}` tag
   with no date, description, or way to open the underlying record.
6. **No dedicated action queue** distinguishing "why this matters"
   (Attention) from "what I must do about it, and when" (Actions).

## What this pass fixed (real, not cosmetic)

### 1–3. Information architecture + desktop hierarchy
- Since Last Visit + Medication Reconciliation moved into the **persistent
  spine** (Header → Patient Context → Attention → Since Last Visit), so
  they're visible regardless of which tab (`?tab=overview` /
  `?tab=prescriptions` / `?tab=notes`) the doctor is on.
- The Consultation tab is now a genuine 3-column desktop layout:
  **LEFT** = condensed Patient Context (allergies, current medicines,
  vitals, recent reports, last visit — all read straight from
  `clinicalProfile`, nothing recomputed); **CENTER** = Consultation PRIMARY
  (consultation picker → SOAP note → prescription, stacked, wide);
  **RIGHT** = AI supporting intelligence (Ask Copilot, follow-up
  suggestion, patient education draft) — genuinely secondary, the center
  column works with zero AI calls.
- Consultation Readiness + Complete Consultation is its own full-width band
  below the 3 columns, exactly as required.
- Timeline + the new Open Clinical Actions queue sit together on the
  Overview tab.
- **Zero tab values changed.** `?tab=overview|prescriptions|notes|
  certificates|history`, `?patientId=`, `?appointmentId=` all resolve
  exactly as before — verified by re-reading every consumer
  (`DoctorPatientProfile.jsx`, `DoctorDashboard`, appointment/review
  drawers) rather than assumed.

### 5. Clinical Attention action routing (was wrong, now correct)
`computeDoctorPatientAttentionItems` (backend/services/
doctorPatientRelationshipService.js) now emits distinct `action` values
instead of lumping everything into `"clinical"`:
- follow-up items → `"followup"` (routes to appointments/scheduling)
- unreviewed-report item → `"report"` (routes to the Reports on File card)
- allergy item → `"profile"` (routes to patient context, was `"clinical"`)
- unchanged: appointments → `"appointments"`, unread messages → `"chat"`,
  insurance → `"profile"`, outstanding bill → `"appointments"`

Both consumers were updated to match — `DoctorClinicalWorkspace.jsx`'s
`handleAttentionAction` and `DoctorPatientProfile.jsx`'s inline handler —
so an attention item resolves the same real way from either page.

### 6. New: Open Clinical Actions (backend/services/
doctorPatientRelationshipService.js → `buildOpenClinicalActions`)
A genuinely distinct engine from attention items: WHAT the doctor must do,
WHY, WHEN, and a routable ACTION — built only from `followUp` (already
computed) and unreviewed reports/consultations-awaiting-completion (already
fetched) inside `getPatientClinicalProfile`, so this is **zero additional
queries**. Rendered by the new `OpenClinicalActions.jsx` component. Six new
unit tests cover: no fabricated actions when there's no real data, overdue
follow-up, per-report review actions (only unreviewed ones), and
consultation-completion actions.

### 4. Patient Context visual hierarchy (`PatientSnapshot.jsx`)
- Allergies get their own alert banner (border + icon + explicit "Allergy
  Alert" label) instead of a pill with the same weight as everything else —
  never relies on color alone.
- Critical clinical facts (medications, chronic conditions, report count,
  last visit) form one full-opacity white row.
- Insurance/family/billing moved to a visually separated, muted footer row
  (smaller text, reduced opacity, a top border) — administrative
  information no longer competes with clinical information for attention.

### 12–14. AI Brief + Copilot coherence, wider intent coverage, actionable evidence
- The Overview tab's "AI: Patient Clinical Brief" card now sits beside an
  explicit "Ask Copilot about this brief" button that opens the **same**
  drawer used everywhere else — one coherent intelligence layer, one
  grounding model, not two disconnected features.
- `resolveCopilotQuestionKey` (backend/ai/generativeAssistant.js) now
  covers natural-language variants of 9 intents (was 5 fixed phrases):
  what changed, summarize history, medication changes, **current
  medicines** (new), pending actions, recent reports, **follow-up status**
  (new), **previous visit** (new), **recent clinical events** (new) — all
  still deterministic pattern matching over real data, never an LLM guess;
  an unmatched question still returns "I don't have this information in
  the available MediCore records."
- Evidence is now actionable (§14): every entry carries `type`, `date`, a
  real short `description`, and a `route` when one genuinely exists. The
  drawer renders date + description inline and an "Open" button that
  navigates there — not just a bare "prescription" tag.

### 15–16. AI safety / graceful degradation (verified, not just claimed)
- The copilot independently re-checks `Appointment.exists({doctorId,
  patientId})` before reading any data — confirmed by a new static test
  that the ownership check textually precedes the data-fetch `Promise.all`
  in `clinicalCopilotAnswer`.
- The report-review endpoint's ownership guard is confirmed (same test
  style) to run before the report is read/updated.
- The Copilot drawer's error state now shows an explicit **Retry** button
  and never touches the rest of the workspace — the SOAP note,
  prescription editor, and Complete Consultation flow have zero dependency
  on any AI call succeeding.

## Backend changes
- `backend/services/doctorPatientRelationshipService.js` — corrected
  `action` values on attention items; new `buildOpenClinicalActions`.
- `backend/controllers/doctor/workflowController.js` —
  `getPatientClinicalProfile` now also returns `openClinicalActions`.
- `backend/ai/generativeAssistant.js` — wider `INTENT_PATTERNS`, 4 new
  copilot question types (current_medicines, follow_up, previous_visit,
  recent_events), `evidenceFor` helper producing actionable evidence.
- `backend/tests/clinicalWorkspaceGapClosure.test.mjs` (new, 9 tests): open
  clinical actions engine, copilot intent resolution incl. new synonyms,
  and the two static ownership-ordering security checks.

## Frontend changes
- `src/components/clinical/OpenClinicalActions.jsx` (new).
- `src/components/clinical/PatientSnapshot.jsx` — clinical/administrative
  visual separation, allergy alert banner, added report-count + last-visit
  facts.
- `src/components/clinical/AIClinicalCopilotDrawer.jsx` — richer quick
  questions, actionable evidence rendering with Open/navigate, explicit
  Retry on error.
- `src/pages/doctor/DoctorClinicalWorkspace.jsx` — full IA restructure
  (spine + 3-column consultation layout), corrected attention-action
  routing, Open Clinical Actions wired into Overview tab, Ask-Copilot entry
  point next to the AI Brief.
- `src/pages/doctor/DoctorPatientProfile.jsx` — attention-action routing
  updated to match the corrected `action` values.

## Verification
- `node --check` — all touched backend files: clean.
- Backend test suite: **63/63 test files passing** (61 pre-existing +
  `clinicalComparisonService.test.mjs` from the prior P6 pass +
  `clinicalWorkspaceGapClosure.test.mjs` new this pass, 9 assertions).
- ESLint: **0 errors, 0 warnings** repo-wide.
- Production build (`vite build`): clean.
- Server boot check: clean startup; only failure is the expected
  `ECONNREFUSED` to MongoDB (no live DB in this sandbox).
- Fake/dummy/placeholder scan across every file touched this pass: clean
  (only a pre-existing multer filename `Math.random()` and a `pending|
  action|todo` regex literal for copilot intent matching — both reviewed
  and legitimate, not fabricated clinical data).
- Hardcoded-localhost scan: clean.
- Nested-interactive scan: every new `<button>` reviewed — none nested
  inside another interactive element.
- Route/deep-link audit: every `navigate()` target
  (`/doctor/patients`, `/doctor/patients/:id`, `/doctor/appointments`,
  `/doctor/clinical`) confirmed to exist in `AppRoutes.jsx`; every
  `?tab=`/`?patientId=` value confirmed unchanged against its real
  consumers.
- Security/ownership audit: both new endpoints' ownership-guard-before-data
  -read ordering is now enforced by an automated test, not just manual
  review (no live DB in this sandbox to run an HTTP-level penetration
  test, consistent with every prior phase).
- Fresh-extract gate: this exact zip was extracted into a clean directory,
  dependencies reinstalled from scratch, and lint/build/tests/boot rerun
  before finalizing.

## Known limitations (explicitly deferred, not fabricated)
- **No live E2E** (browser + real MongoDB) — unavailable in this sandbox,
  as in every prior phase. The full user journey in item §28 of the
  gap-closure brief was verified structurally (every step's underlying
  data/action/route exists and is wired) rather than click-tested live.
- **Section-level loading skeletons (§21) were not built.** The workspace
  still shows one top-level loader on initial load. This is a real,
  acknowledged gap, not something claimed as done.
- **Tablet/mobile responsive breakpoints (§20) were not explicitly
  re-tuned** for the new 3-column layout; it degrades via existing
  Tailwind `xl:` breakpoints to a stacked single column below `xl`, which
  is directionally correct (Context → Consultation → AI stacking) but was
  not verified against the exact tablet/mobile mockup in the brief.
- **Medication Reconciliation frequency-change detection (§8)**: dosage
  and frequency are already both compared (a change in either already
  produces `DOSE_CHANGED`) — this pass did not add a *separate* status for
  frequency-only vs dosage-only changes, since the underlying Prescription
  model doesn't distinguish a reason for the change and inventing one
  would violate the "do not fabricate reasons" requirement in the same
  section.
- **Copilot NLU remains deterministic pattern-matching**, not a real
  language model — intentional (§13 explicitly says "do not blindly add an
  LLM"), but still narrower than true natural-language understanding; an
  unrecognized phrasing of a supported intent will honestly return "don't
  have this" rather than partially understanding it.
