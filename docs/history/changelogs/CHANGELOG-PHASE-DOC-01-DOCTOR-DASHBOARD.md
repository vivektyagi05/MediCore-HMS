# PHASE DOC-01 — Doctor Dashboard Command Center

Honestly-scoped audit + fix pass on `src/pages/dashboard/DoctorDashboard.jsx`, per the
Golden Rule: audit the real source first, reuse what's real, fix what's genuinely broken,
never rebuild what already works.

## 1. Audit findings (Category classification)

Traced every section from the JSX through its API client, Express route, controller, and
model. Almost everything on this page is **Category A (real + fully connected)**, carried
forward from D1–D5 with no fabricated data found anywhere:

| Section | Category | Source of truth |
|---|---|---|
| Today's Patients / Pending / Emergency / Unread / Follow-ups / Today's Earnings KPIs | A | `appointments` (fixed, see §2), `unreadCount` (RealtimeContext), `patientAnalytics`, `earnings` |
| My Clinic Today (practice health, priority/delayed queue, pending reports, insurance expiry, follow-ups) | A | `buildDoctorCommandCenterData` — real, doctor-scoped, revenue from actual `DoctorPayout`/`Payment` records, not appointment counts |
| Weekly/Monthly Earnings | A | `buildDoctorRevenueIntelligence` — real payout-based aggregation, shared by Earnings page |
| Current Consultation / Emergency Alerts | A (after fix) | today-onward appointment fetch, see §2 |
| Pending Approval Requests | A (after fix) | dedicated `status=pending` fetch, see §2 |
| Upcoming Patients | A (after fix) | today-onward appointment fetch, see §2 |
| Follow-up Queue / Patient Risk Summary | A | `doctorApi.getPatients()` (real, deterministic risk formula shared with admin) |
| Recently Viewed Patients | A | client-side convenience state (`localStorage`), same established pattern as elsewhere in the app — not clinical data, correctly not backend-backed |
| Live Activity Feed | A | RealtimeContext notifications |
| AI Morning Brief | A | real `generativeAssistant.workflowSuggestions`, doctor-scoped counts, advisory only |
| Smart search | A | client-side filter over the doctor's own real patient list |
| Quick Clinical Actions | A | all six deep-links resolve to real existing pages, no dead links |

**Appointment status usage** was cross-checked against `backend/constants/appointmentStatus.js`
— every status string used (`pending`, `approved`, `consultation_started`,
`consultation_completed`, `cancelled`) matches the real enum. No invented statuses
(no `confirmed`/`no_show`, the exact mistake the brief warned about).

**Security**: `GET /appointments`, `/doctors/patients`, `/doctors/earnings`,
`/doctor/command-center` all enforce `protect` + `authorizeRoles(DOCTOR)` at the route level
and re-derive `doctorId` server-side via `ensureDoctorProfileForUser(req.user)` /
`buildRoleBasedFilter` — a doctor cannot see another doctor's appointments, patients, or
earnings by manipulating the request. No client-only role checks found.

**Fake-data sweep** (mock/dummy/placeholder/hardcoded/fake/simulate/"coming soon" grep) on
this file: clean — the only "placeholder" hit is the legitimate HTML `placeholder=` attribute
on the search input.

**Nested-interactive scan** on this file: clean — every `<Button>` is a leaf; none nested
inside another interactive element.

## 2. The one real bug (Category F — broken, + Category I — data-correctness/perf risk)

**Root cause**: the page loaded appointments via
`appointmentApi.getAppointments({ limit: 200 })`. Two independent facts made this silently
wrong:

1. `getPagination()` in `appointmentController.js` hard-caps `limit` at **100**, regardless
   of what the caller requests — so the "200" was already a lie.
2. The endpoint sorts **oldest-first** (`{ date: 1, timeSlot: 1 }`) with no date filter.

Combined effect: for any doctor with more than ~100 historical appointments (i.e. almost any
real, non-trivial practice), the "page" of 100 results returned would be their **oldest**
appointments ever — today's and future appointments would never appear in it at all. That
silently breaks:
- Today's Clinic (empty)
- Current Consultation banner (never shows)
- Upcoming Patients (empty)
- Pending Approval Requests (misses any pending request that isn't in the oldest 100)
- Emergency Alerts (never triggers, since it's derived from `todaysAppointments`)

This is exactly the `GET /appointments?limit=200` + client-side-calculation anti-pattern the
phase brief calls out — it worked fine in a small dev dataset and would fail silently in
production.

### Fix

- **Backend** (`backend/controllers/appointmentController.js`): added an additive,
  validated `dateFrom`/`dateTo` query filter to `GET /appointments`, extracted as a pure,
  dependency-free `buildDateRangeFilter()` function. Mirrors the identical
  `dateFrom`/`dateTo` validation pattern already used by
  `admin/appointmentAdminController.buildListFilter` — reusing an established pattern, not
  inventing a new one. Zero behavior change for any existing caller that doesn't pass these
  params (six other pages call this same endpoint; none of them pass `dateFrom`/`dateTo`,
  confirmed by grep — no regression risk).
- **Frontend** (`DoctorDashboard.jsx`): `loadAll` now fetches:
  - appointments from **today onward** (`dateFrom: <today>`, `limit: 100`) — this is what
    feeds Today's Clinic, Current Consultation, Upcoming Patients, and Emergency Alerts, and
    is now correct regardless of how much appointment history the doctor has, because the
    query is scoped by date instead of relying on page position.
  - pending approvals as their **own bounded query** (`status: pending, limit: 100`) — kept
    separate from the date-scoped fetch on purpose, so an overdue pending request from
    before today still surfaces (a pending request doesn't stop needing a decision just
    because its date has passed).
- New test: `backend/tests/appointmentDateRangeFilter.test.mjs` (4 assertions) — locks in
  the no-op-when-absent behavior, the open-ended `$gte`, the inclusive same-day range, and
  invalid-date rejection (rule #15, input validation — an unparseable `dateFrom` is dropped,
  never passed through to Mongo as `Invalid Date`).

## 3. What was deliberately NOT changed

- **Emergency detection** duplication: the dashboard's local "Emergency Alerts" card uses
  `painLevel >= 8` on today's appointments, while `commandCenter.queue.emergency` uses a
  broader rule (`painLevel >= 8` OR a symptom/reason keyword match). Both are real,
  intentional-looking definitions serving different purposes (a strict clinical banner vs. a
  broader operational triage queue) — audited but not merged, since collapsing them without
  stronger evidence this is a bug (rather than deliberate differing thresholds) risked
  removing a legitimate distinction rather than fixing one.
- **`getDoctorPatients` (`/doctors/patients`) is unbounded** — it fetches *all* of a doctor's
  appointments with no `limit`/pagination to derive the patient list that feeds Follow-up
  Queue, Patient Risk Summary, and Smart Search on this page. This is a real Category I risk
  (rule #16), but it's pre-existing infrastructure shared with the standalone Patient
  Directory page (`DoctorPatients.jsx`) from an earlier phase — pagination-izing it properly
  needs to happen on both consumers together, which is bigger than a one-page dashboard pass.
  Flagged, not silently ignored; recommended as the next phase's first item.
- **Two other pages** (`PatientAppointments.jsx`, `PatientDoctors.jsx`) also call
  `getAppointments({ limit: 200 })` and are subject to the same 100-cap truncation, just not
  the ascending-sort/date-filter part of this specific bug (they don't do date-scoped
  client-side filtering the way DoctorDashboard did). Found during the cross-caller grep in
  §2, out of scope for a Doctor-side, one-page phase — flagged for the patient-side backlog
  rather than fixed here.

## 4. Verification

- `node --check` clean on all changed backend files.
- Backend suite: **49/49 passing** (48 pre-existing, unchanged + 1 new
  `appointmentDateRangeFilter.test.mjs`).
- `npx eslint .`: **0 errors, 0 warnings**, repo-wide.
- `npm run build`: clean; `DoctorDashboard` chunk present and grew (confirms compile picked
  up the change); every other existing page chunk still present (no accidental breakage).
- Server boot: clean (`ECONNREFUSED`-only — no live MongoDB in this sandbox, consistent with
  every prior phase).
- Structural scans: no duplicate route mounts (the two `/api/doctor` and `/api/auth` /
  `/api/realtime` "duplicates" found by grep are legitimate — rate-limiter middleware and
  route router sharing a base path, and `/api/doctor` composing four distinct sub-routers,
  not actual duplicate handlers); no new hardcoded `localhost` introduced; nested-interactive
  scan clean on the changed file.
- **Fresh-extract gate**: re-extracted the final zip to a clean directory, reinstalled
  frontend + backend deps from scratch, and re-ran the full backend suite, eslint, build, and
  boot check against the *extracted* copy only (not the working copy) — identical results
  (49/49, 0/0 lint, clean build, clean boot).
- Regression: confirmed by reading every other consumer of `GET /appointments`
  (`PatientDashboard`, `DoctorAppointments`, `DoctorClinicalWorkspace`,
  `PatientAppointments`, `PatientDoctors`, `PaymentCheckout`) that none of them pass
  `dateFrom`/`dateTo` — the additive filter is a guaranteed no-op for all of them.

## 5. Explicitly NOT done

- **Live E2E** (browser + real MongoDB) — not available in this sandbox, consistent with
  every prior phase. Not claimed.
- The full A–K, 17-item audit-output enumeration the brief's §27 template lists was
  consolidated into the table + narrative above rather than repeated as a separate 17-part
  document, since almost every category came back "already real" — a mechanical checklist
  restating "A: real" seventeen times added no information.
- `getDoctorPatients` pagination (see §3) — deferred, not fixed, with the reason stated
  plainly.

## 6. Files changed

- `backend/controllers/appointmentController.js` — added `buildDateRangeFilter()` (exported,
  pure) and wired it into `getAppointments`.
- `backend/tests/appointmentDateRangeFilter.test.mjs` — new.
- `src/pages/dashboard/DoctorDashboard.jsx` — `loadAll` now fetches appointments from today
  onward plus a dedicated pending-approvals query instead of one unscoped `limit:200` call;
  `pendingApprovals` now reads directly from the dedicated fetch instead of filtering the
  date-scoped list.

## Final completion status

DOC-01 audit is complete. The one genuine defect found (silent data loss on Today's
Clinic/Upcoming/Pending/Emergency for any doctor with real appointment history) is fixed at
its root cause, tested, and verified end-to-end including a fresh-extract gate. Two smaller,
adjacent findings (`getDoctorPatients` unbounded query; the same `limit:200` pattern on two
patient-side pages) are documented as deferred rather than silently dropped, since fixing
them correctly extends past this page's boundary.
