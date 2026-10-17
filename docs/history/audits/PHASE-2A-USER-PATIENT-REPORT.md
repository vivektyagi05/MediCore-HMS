# PHASE 2-A — Real Patient/User Product Implementation & Testing Report

**Scope:** Full patient/user journey E2E audit (register → login → profile →
password recovery → doctor discovery/availability → booking → dashboard →
notifications → reviews → frontend quality) against the real MediCore HMS
codebase, per the Phase 2-A brief. Method: trace UI → API client → HTTP →
middleware → route → controller → service → MongoDB → response → frontend
state → user-visible result for every part of the brief; fix any real defect
found; no live browser/MongoDB available in this sandbox (consistent with
every prior phase — see "Verification" below), so mutations were traced and
verified at the code/logic level rather than click-tested.

---

## Defects Found & Fixed

### 1. No real session restoration — stale cached session trusted forever (Part 2/3)

**Root cause.** There was no `/api/auth/me` endpoint anywhere in the
backend. The frontend's `AuthContext` initialized its `user` state by
reading whatever JSON was last written to `localStorage.hms_user` at the
previous login/register call, and never re-verified it against the backend.
`PrivateRoute` then read that same frozen `localStorage` snapshot directly
(bypassing React state entirely) to decide routing.

**Concrete, reproducible symptom.** A doctor's `doctorOnboardingStatus` is
only ever updated client-side by hand, in exactly one place
(`DoctorOnboarding.jsx`, right after the doctor submits their own
onboarding form, setting it to `"pending"`). There is no mechanism that
updates it when an **admin approves** the doctor server-side. Once a doctor
is approved, their existing browser session keeps the old cached value —
`PrivateRoute` unconditionally redirects any doctor whose cached
`doctorOnboardingStatus !== "approved"` to `/doctor/onboarding`, so an
approved doctor is permanently bounced back to the onboarding screen on
every page load, refresh, and browser restart until they manually log out
and log back in. This directly fails the brief's explicit test
requirement: "Test browser restart/session restoration" and "login → JWT →
/me → protected API → frontend authenticated state."

The backend's actual session-revocation logic (`protect` middleware) was
already correct and unused for this purpose — it validates token expiry,
`isActive`, and `securityVersion` (bumped on password reset) on every
request; the frontend simply never asked it to re-verify anything after
the initial login/register call.

**Fix implemented.**
- `backend/controllers/authController.js` — new `getMe` handler returning
  `req.user.toJSON()` (the user document `protect` already fetched and
  verified fresh from the database).
- `backend/routes/authRoutes.js` — `GET /api/auth/me`, mounted behind
  `protect`.
- `src/api/authApi.js` — `authApi.me()`.
- `src/context/AuthContext.jsx` — on mount, if a token is cached, calls
  `authApi.me()` to refresh the cached user (fixing the stale
  `doctorOnboardingStatus` and any other field that changed server-side
  since the last login); exposes a new `initializing` flag (true only
  while that first verification is in flight) and a `refreshUser()`
  function any screen can call after learning the account changed. A
  failed `/me` call (expired/invalid/revoked token) is already caught by
  the existing axios 401 interceptor, which fires `hms:unauthorized` →
  `logout()` — no new error path was needed there.
- `src/routes/PrivateRoute.jsx` — now reads `user`/`initializing` from
  `AuthContext` instead of re-parsing `localStorage` directly, and renders
  a loader while the real session is being verified instead of making a
  routing decision off a snapshot that might already be stale or revoked.

**Files changed:** `backend/controllers/authController.js`,
`backend/routes/authRoutes.js`, `src/api/authApi.js`,
`src/context/AuthContext.jsx`, `src/routes/PrivateRoute.jsx`.

**Test added:** `backend/tests/sessionRestoration.test.mjs` (6 assertions,
source-inspection style consistent with this repo's existing no-live-DB
test convention) — locks the route/middleware wiring and the frontend fix
so this cannot silently regress.

---

## Audited — No Defect Found (existing implementation already correct)

Each of the following was traced end-to-end (not merely inspected for
existence) against the specific brief requirement, with no defect found:

- **Registration (Part 1).** Server-side email/password/role/terms
  validation (`validateRegister`); `role` restricted server-side to
  `patient`/`doctor` regardless of client payload
  (`PUBLIC_REGISTER_ROLES`); password hashing via bcrypt pre-save hook;
  unique DB index on `email` + `errorMiddleware`'s `E11000 → 409`
  translation closes the concurrent-duplicate-registration race (two
  simultaneous registrations with the same email cannot both succeed);
  sensitive-field filtering via the schema's `toJSON` transform (password,
  `__v` stripped); `registrations_paused` feature-toggle gate.
- **Login / session (Part 2 core).** `protect` middleware re-verifies
  token expiry, `isActive`, and `securityVersion` on every request — a
  password reset genuinely invalidates every previously-issued token.
  Login rejects unknown email/wrong password with one generic message
  (no user-enumeration signal).
- **Profile (Part 3).** `PUT /api/patient/profile` operates only on
  `req.user._id` (the authenticated user) — there is no way to target a
  different user's profile from this endpoint, so the "prevent user A
  from modifying user B" requirement is structurally satisfied; only the
  `patientProfile` sub-object is writable (no mass-assignment of
  unrelated top-level fields).
- **Password recovery (Part 4 — audited, not redesigned per brief
  instruction).** OTP hashed at rest, single-use, expiring, atomic
  attempt-counting (`findOneAndUpdate` with `$inc`, never
  find-then-update), atomic OTP-verified→reset-token issuance (race-safe
  against the same OTP producing two live reset tokens), atomic
  reset-token consumption, `securityVersion` bump invalidates every old
  session the moment a reset completes, generic responses throughout (no
  account-existence oracle), real Brevo provider-failure taxonomy with
  the OTP explicitly invalidated if the email genuinely failed to send (no
  fake "success"). No defect found; left untouched per the brief's
  explicit instruction not to redesign an already-hardened flow.
- **Doctor discovery (Part 5).** `searchDoctors`/`getDoctorPublicProfile`/
  `getDoctorPublicReviews`/`getPublicDoctorAvailability` all bound their
  queries (pagination, capped ID lists), validate ObjectIds before
  querying (invalid ID → 400, stale/nonexistent ID → 404, never a 500 or
  empty-looking 200), and scope every public result to
  `isVerified && verificationStatus === "approved" && isActive` doctors
  only.
- **Availability (Part 6).** `ensureDoctorAvailable` is invoked
  server-side inside `createAppointment` — the backend independently
  re-derives whether the requested date/time-slot is one the doctor
  actually offers (from `Doctor.availability` + approved
  `LeaveRequest`s), rather than trusting whatever slot the client UI
  displayed; a stale/invalid slot picked by an out-of-date frontend is
  rejected server-side regardless of what the UI showed.
- **Booking (Part 7).** Past-date rejection, doctor-approval check,
  leave-conflict check, same-slot conflict check, same-patient duplicate
  check, and — for true concurrency — a real MongoDB partial unique index
  on `(doctorId, date, timeSlot)` restricted to active statuses; the
  pre-check `findOne` is explicitly documented as best-effort, with the
  DB index as the actual guarantee, and the resulting `E11000` is caught
  and translated into a friendly `409 SLOT_CONFLICT` rather than a raw
  Mongo error. `bookingRequestId` idempotency means a duplicate submission
  (double-click, retry after timeout) returns the existing appointment
  instead of creating a second one or emitting a duplicate notification.
- **Dashboard (Part 8).** `PatientDashboard.jsx` composes exclusively from
  real backend endpoints (appointments, family, insurance, reports,
  prescriptions, timeline, profile completion, invoices, payments, wallet,
  refunds, saved doctors) — no hardcoded counters, names, or placeholder
  values found.
- **Notifications (Part 9).** Appointment creation emits exactly once per
  real creation (`appointmentEmitter.created`, fire-and-forget but
  error-logged, never silently swallowed); idempotent booking-request
  handling prevents duplicate-event fan-out on retry.
- **Frontend quality (Part 11, spot-checked).** Representative patient
  pages (`PatientAppointments.jsx` and others reusing the shared
  `Loader`/`EmptyState`/`ErrorState` design-system primitives) consistently
  implement loading/empty/error states — no infinite-spinner or
  silently-disappearing-error pattern found in the pages inspected.

---

## Tests

- **Added:** `backend/tests/sessionRestoration.test.mjs` (6 assertions).
- **Backend suite:** 95/95 passing (94 pre-existing + 1 new).
- **ESLint:** 0 errors, 0 warnings, repo-wide.
- **Frontend build:** clean Vite production build.
- **Boot check:** clean `NODE_ENV=development` boot
  (`ECONNREFUSED`-only against 127.0.0.1:27017 — no live MongoDB available
  in this sandbox — followed by a clean `SIGTERM` shutdown with
  structured-log-only output); `NODE_ENV=production` boot correctly
  fails fast on missing Razorpay/Brevo credentials (expected — confirms
  the existing production env-validation gate, not a regression).
- **Fresh-extract gate:** the exact zip being delivered was independently
  re-extracted, dependencies reinstalled from scratch (backend + frontend),
  and the full backend suite / lint / build re-run against that clean
  extraction — all green.

---

## E2E Journey Coverage vs. Brief

`REGISTER → LOGIN → PROFILE → SEARCH DOCTOR → VIEW DOCTOR → CHECK REAL
AVAILABILITY → BOOK APPOINTMENT → VERIFY DATABASE → VIEW APPOINTMENT →
RECEIVE NOTIFICATION → CANCEL/RESCHEDULE → REVIEW → LOGOUT`

Every step was traced through real, connected code (no mocked/fabricated
link in the chain) with the one exception below. All mutation endpoints
touched during the trace go through real Mongoose writes with the
ownership/authorization/idempotency/concurrency guarantees described above
— nothing hardcodes a success response ahead of a database write.

## Remaining Blockers / Explicitly Deferred

- **Live browser/MongoDB E2E.** Not available in this sandbox (no MongoDB
  binary, no headless browser) — consistent with every prior phase of this
  project. All mutation paths were instead verified by tracing the actual
  Mongoose queries, schema constraints (unique indexes), and
  request/response contracts rather than by click-testing against a real
  database. This is the same disclosed limitation as every previous
  MediCore HMS phase, not something newly skipped in this pass.
- **Cancellation/rescheduling and Review flow (Parts 7/10) full
  re-audit.** These were previously built and hardened in dedicated
  earlier phases (Doctor Appointments Rebuild, P8 Reviews & Reputation,
  P10 Follow-up/Continuity) and were spot-checked here (idempotency,
  ownership, notification correctness) rather than re-audited from zero —
  no new defect surfaced in the parts inspected, and re-litigating
  already-verified-complete systems was explicitly out of scope per
  standing project instruction.
- **Full Part 11 sweep.** Loading/empty/error states were spot-checked on
  a representative sample of patient pages (all consistent with the
  shared design-system primitives) rather than exhaustively re-tested
  page-by-page; no inconsistency was found in the pages inspected.
