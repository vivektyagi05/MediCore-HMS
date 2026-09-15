# P1 — Doctor Experience Foundation

Scope: shared-foundation-only pass following the P0 (backend/product reality
audit) and P0.1 (Doctor UX/component audit) findings. No redesign, no new
features, no backend changes.

## What changed

### 1. MetricCard consolidation
`DoctorBusinessOverview.jsx`, `DoctorPracticeOverview.jsx`, and
`DoctorReputationCenter.jsx` each contained an identical, copy-pasted local
`StatCard` component (22 call sites total) instead of the existing canonical
`src/components/ui/MetricCard.jsx`. All three pages now import and use the
real `MetricCard`; the three duplicate `StatCard` functions are removed.
`sub` props were mapped 1:1 to `caption`; `color="bg-*-600"` props were
mapped to semantic `tone` values.

### 2. MetricCard tone system extended (additive)
The three pages' original colors (violet, amber, indigo, slate, orange)
exceeded `MetricCard`'s original 4-tone vocabulary (`neutral`/`premium`/
`danger`/`success`). Rather than inventing new page-specific styling, the
tone map was extended to match the vocabulary already established by
`Badge.jsx`/`StatusBadge.jsx` (`warning`, `info`, `violet`). This is
backward-compatible — none of the four original tones changed appearance.

Side effect (found while auditing every consumer before changing the shared
component, per the brief's Step 10): three admin files —
`AdminDoctors.jsx`, `RefundDetailWorkspace.jsx`, `PaymentDetailWorkspace.jsx`
— were already passing `tone="warning"` / `tone="info"` to `MetricCard`
before this map defined them, so those call sites were silently rendering
the neutral/royal look instead of the intended warning/info color. They now
render correctly with zero changes on their end.

### 3. ErrorState standardization
All three pages' hand-rolled error blocks (raw `<button>`, off-token
`bg-blue-600` retry button) were replaced with the canonical `ErrorState` +
a real `onRetry` handler.

### 4. Earnings error-state fix
`DoctorEarnings.jsx` previously rendered a hand-rolled
`red-200`/`red-50`/`red-700` error box *above* a full grid of `₹0` metric
cards on any fetch failure — indistinguishable from genuinely zeroed
earnings. This is now split into two real states:
- First-load failure (no `earnings` data yet): full-page canonical
  `ErrorState` with retry, replacing the misleading zeroed dashboard.
- Refresh failure with prior data still on screen: a non-blocking inline
  banner, recolored from the raw `red-*` classes to the project's `rose`
  token (matching `ErrorState`'s own palette) — data stays visible,
  failure is still communicated.

### 5. SectionHeader adoption
`DoctorBusinessOverview.jsx`, `DoctorPracticeOverview.jsx`, and
`DoctorReputationCenter.jsx` now use the canonical `SectionHeader` in place
of bespoke `<h2>`/`<p>` header markup. This is the first Doctor-side
adoption of this existing primitive (previously used only on admin/finance
pages) and establishes the pattern for future pages.

### 6. Data-presentation fix (minimal, found while migrating)
`DoctorPracticeOverview.jsx` was displaying the raw `verificationStatus`
enum value ("approved" / "pending" / "rejected") directly as a metric
value. Added a small `formatVerificationStatus()` capitalizer (mirrors the
labeling convention already used in `DoctorVerificationCenter.jsx` — no new
architecture introduced).

## Files changed
- `src/components/ui/MetricCard.jsx` (additive tone extension only)
- `src/pages/doctor/DoctorBusinessOverview.jsx`
- `src/pages/doctor/DoctorPracticeOverview.jsx`
- `src/pages/doctor/DoctorReputationCenter.jsx`
- `src/pages/doctor/DoctorEarnings.jsx`

## Explicitly NOT changed this phase
- No backend files.
- No business logic, calculations, or API contracts.
- No new libraries; no Tailwind/shadcn/design-system replacement.
- Documents, Practice Settings, Dashboard, Schedule, Patients, Appointments,
  Reviews — untouched (outside this phase's scope).
- Skeleton and a shared Pagination component — deliberately not introduced
  this phase (adoption/creation is a separate, larger piece of work).
- `DoctorMetricCard.jsx` (a fourth, differently-named duplicate found in
  `DoctorAnalytics.jsx`, 11 call sites) — flagged for a future pass, not
  named in the original P0.1 finding or this phase's explicit scope.
- A `StatCard` duplicate in `src/pages/patient/PatientPayments.jsx`
  (patient-side, outside a Doctor Experience phase).

## Verification
- `npm run lint` — 0 errors.
- `npm run build` — clean production build.
- Backend test suite (`node tests/run-all.mjs`) — 60/60 passed (unchanged;
  no backend files were touched this phase).
- Backend boot check — clean; only the expected sandbox
  `ECONNREFUSED 127.0.0.1:27017` (no MongoDB available in this
  environment), no other startup errors.
- Fake-data scan, hardcoded-localhost scan, ad-hoc hex-color scan, and
  nested-interactive-element scan on all five changed files — clean.
- Duplicate-`StatCard` scan repo-wide — the three named duplicates are
  gone; one remaining instance in `PatientPayments.jsx` is out of scope
  (see above).

**NOT VERIFIED:** live MongoDB, live browser rendering/interaction, real
concurrent behavior. All checks above are source-level and build-level
only.
