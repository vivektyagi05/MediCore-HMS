# MediCore HMS — Session Changelog & Honest Status (v3)

This replaces the previous SESSION_CHANGELOG.md with a full account of everything fixed since,
including the previous session's 6 fixes. As before: this documents exactly what was verified,
how, and what was not — not a claim that the entire product is now bug-free.

## Bugs found and fixed this session: 28

Each entry below has a corresponding test in `backend/tests/` and was verified via `node --check`
(syntax), a real backend boot test (`node server.js` — confirms the entire module graph loads
without error), and a real frontend production build (`vite build`) unless noted otherwise.

### Data integrity / business logic
1. **Time Slot Engine** — replaced free-typed slot strings (doctor schedule entry AND patient
   booking) with a real generation engine: working hours, duration, buffer, breaks, emergency-slot
   config. Backward compatible with legacy manually-typed slots.
2. **Payment post-processing stuck-forever bug** — `verifyPayment` marked payments CAPTURED before
   running 7 downstream steps; a failure partway left the payment permanently stuck (its own
   idempotency guard blocked retry). Extracted an idempotent, safely-retryable
   `completePaymentPostProcessing()`. Fixed 3 non-idempotent side effects (wallet debit, coupon
   usage, invoice creation) that would have double-fired on retry. Wired the previously report-only
   reconciliation cron to actually repair stuck payments.
3. **Review rating drift** — the same doctor-average-rating formula was independently implemented
   in 3 places; merged into one shared service.
4. **Payment/appointment-status race** — payment capture unconditionally forced appointment status
   to PAYMENT_COMPLETED, which could resurrect a cancelled appointment (and wrongly create a doctor
   payout) if cancellation raced against payment verification. Now checks `STATUS_TRANSITIONS` first.
5. **Approval-time recheck** — `PENDING → APPROVED` never re-validated the doctor's calendar; a
   doctor could approve an appointment that fell inside blocked dates/leave added after booking.
6. **Payment-window expiry (new)** — nothing ever released a slot when a patient never paid; an
   approved-but-unpaid appointment blocked that slot **permanently**. Added
   `expireStalePaymentWindows` + matching cron.
7. **Silently-dropped cancellation reason** — `cancelAppointment` set `appointment.cancelReason`,
   but that field was never declared on the schema. Mongoose strict mode silently dropped it on
   save — every cancellation reason ever submitted vanished. Caught via schema introspection
   (`Appointment.schema.path("cancelReason")` returned `undefined`).
8. **Double-booking lifecycle hole (critical, found in 2 places)** — the DB unique index AND the
   application-level conflict checks only covered `PENDING`/`APPROVED`. A slot became re-bookable
   the moment the first patient's appointment moved into payment or **even after they'd fully
   paid**. `ACTIVE_STATUSES` (a constant explicitly commented "for slot-blocking") existed but was
   never actually used anywhere. Fixed in `models/Appointment.js` and `appointmentController.js`.
   A follow-up grep found the identical bug pattern in `ai/aiScheduler.js` (a separate file not
   touched in the first pass) — the AI "suggest slots" feature could recommend an already-paid slot.
   A further sweep found 3 more real instances (`doctor/workflowController.js`'s `getSchedule`,
   `patient/patientWorkflowController.js`'s `getPatientNotifications`, and
   `automation/paymentReminder.js`) plus 2 false positives (different, unrelated status enums,
   correctly left alone).
9. **Financial summary destructuring bug (severe)** — `getFinancialSummary`'s
   `[summary, [walletSummary], [subscriptionSummary]]` left `summary` as the raw aggregation
   array instead of unwrapping it like the other two. `data.totalEarnings` read as `undefined`,
   and `JSON.stringify` silently dropped every field attached afterward (`walletBalances`,
   `recurringRevenue`, `activeSubscriptions`, `successRatio`) from the API response. Reproduced
   the exact failure in isolation before fixing it (see test file) — this one wasn't inferred from
   reading code, it was run.
10. **Subscription renewal never resolved** — `markCharged` (the Razorpay webhook success handler)
    never advanced `nextBillingAt`, so even a successfully-charged subscription kept matching the
    renewal cron's due-query and got incorrectly re-marked `past_due` on the next run. The cron also
    only queried `status:"active"`, so a `past_due` subscription was never re-evaluated —
    `failedRenewalCount` froze at 1 forever with no resolution. Fixed period-advancement math and
    added a 3-strikes auto-cancel so a failing subscription eventually resolves instead of being
    stuck.

### Security
11. **Admin privilege escalation** — a plain `ADMIN` could deactivate, delete, or edit a
    `SUPER_ADMIN` account (and lock themselves out of their own), completely bypassing the dedicated
    hierarchy-permission system (`requirePermission("manage_admins")`) built for exactly this. Added
    `assertCanActOnTarget()`.
12. **Dead audit-log feature** — `AdminActivityLog` model + its read endpoint existed, but nothing
    anywhere ever wrote to it. Wired real writes into the three user-management actions above (not
    every admin action — see "what remains" below).
13. **File-upload mimetype spoofing** — every upload endpoint (patient reports, insurance docs,
    doctor verification documents) trusted only the client-supplied `mimetype` header, which is
    fully attacker-controlled. Added real magic-number (file signature) validation. Tested against
    real files on disk, including the actual attack scenario: a file with a `#!/bin/sh` payload
    labeled `application/pdf` — confirmed rejected.
14. **Error middleware never registered (the single highest-blast-radius backend bug)** —
    `errorMiddleware` and `notFound` were imported in `app.js` but never actually passed to
    `app.use()`. Every `AppError` thrown by every controller in the entire product fell through to
    Express's own default error handler instead of the app's `{success:false, message}` JSON
    contract every frontend error toast depends on. Proved this empirically: reverted the fix,
    confirmed the test fails against the broken code with a live HTTP request via `supertest`,
    restored the fix, confirmed it passes.
15. **Doctor self-approval via mass assignment (critical)** — `submitOnboarding` and
    `updateOnboarding` used `Object.assign(doctor, req.body)` with zero field whitelisting. Since
    `verificationStatus`, `rating`, and `isVerified` are real schema fields, a doctor could submit
    `{verificationStatus:"approved", rating:5}` in their own onboarding request and self-approve
    their account — bypassing the entire admin doctor-verification workflow. Added an explicit
    whitelist of only the credential fields onboarding legitimately collects.
16. Swept the rest of the codebase for the same `Object.assign`/`...req.body` mass-assignment
    pattern: two more spreads found (`FamilyMember`, `Insurance` creation), both checked and
    confirmed safe — `userId` is correctly overridden after the spread in both, and `Insurance`'s
    one borderline field (`claimStatus`) is confirmed to have no downstream trust consequence
    anywhere in the codebase (only ever echoed back to the patient's own notification feed).

### Frontend runtime crashes (found via a systematic sweep, not incrementally)
17. **10 components called `t()` without ever calling `useI18n()`** — a bare reference to an
    undeclared variable, a guaranteed `ReferenceError`. Two of the ten (`Sidebar.jsx`, `About.jsx`)
    called it at module scope, before any component even rendered. `Sidebar.jsx` is imported by
    `DashboardLayout.jsx`, which wraps every `/admin`, `/doctor`, and `/patient` route — this would
    have crashed the entire authenticated application on load, for every user, always.
    Proved this is not theoretical: bundled `Sidebar.jsx` standalone and imported the compiled
    output directly in Node — it threw `ReferenceError: t is not defined` immediately. Fixed it,
    re-ran the identical import, confirmed success. Did the same live-import proof for `About.jsx`
    and `Contact.jsx`. The remaining 7 fixes are byte-identical to the working pattern already used
    correctly in 15+ other files in this codebase.
    This directly means "frontend build passes," which I stated as evidence throughout this
    session, was real but insufficient evidence — `vite build` never executes component code, so
    it cannot catch a bare undeclared-variable reference. Flagging this plainly rather than letting
    earlier "build clean" claims imply more than they proved.
18. Swept the same pattern against `useAuth()` and `useToast()` — zero real hits (one `user.role`
    match was a false positive, a local `.filter()` callback parameter, not the auth context).

### Minor
19. Removed a leftover `console.log("ONBOARDING ROUTES LOADED")` that fired on every server boot.

## What was NOT audited this session

Medical notes UI end-to-end, CMS admin wiring, subscriptions frontend, doctor withdrawal UI,
public SEO pages, a full IDOR sweep beyond invoices/prescriptions, JWT revocation/refresh (there is
none — a 7-day token can't be invalidated early short of the `isActive` check that already runs on
every request), rate-limit tuning, and the AI module beyond the two `aiScheduler.js` fixes above.
"Everything now works end-to-end" is still not a claim being made here.

## Environment notes (unchanged)

`mongodb-memory-server` cannot download its MongoDB binary in this sandbox (no route to
`fastdl.mongodb.org`), and there's no local `mongod` available via `apt` either (Ubuntu dropped the
package). All backend verification here is real `node --check`, a real backend boot
(`node server.js` — confirms the whole module graph loads, fails only on the expected
`ECONNREFUSED` since no live MongoDB exists here), dependency-free/mocked unit tests, and — for a
few of the highest-stakes claims — actually bundling and importing/executing the compiled code in
Node directly. The frontend build is real (`vite build`, not just `esbuild` sanity checks). Neither
replaces running the real test suite against a real MongoDB in your own environment before
deploying — recommended before going further.

---

## Session: AI Healthcare Intelligence Layer (Phase D)

Built the AI layer across Patient, Doctor, and Admin workflows on top of the existing platform.
No prior phase was redesigned; no new auth, no new appointment/records models, no fabricated data.

### AI Components Added

**Backend (all additive, new files unless noted):**
- `backend/ai/promptLibrary.js` — centralized prompt/disclaimer definitions for every generative
  feature (consultation summary, clinical note draft, prescription explain, document summary,
  appointment prep, communication draft, executive brief, workflow suggestions, review sentiment).
  One place per feature — no controller duplicates prompt text.
- `backend/ai/providers/textGenerationProvider.js` + `providers/templateProvider.js` — swappable
  generation layer. Today's implementation is a deterministic template engine that only ever
  renders fields it was handed (never invents data); to swap in a real LLM later, implement
  `generate({ promptKey, context })` and register it — no calling code changes, just set
  `AI_TEXT_PROVIDER`.
- `backend/models/AIDraft.js` — every generated draft that could become part of a record is
  persisted with a `draft -> approved` lifecycle (edited flag, approvedBy/approvedAt).
- `backend/ai/generativeAssistant.js` — the core service. Every function pulls real data first
  (Appointment/Prescription/MedicalReport/MedicalNote/Review), then calls the provider, then saves
  an AIDraft record where relevant.
- `backend/ai/nlSearchParser.js` — Smart Search: recognizes a handful of natural-language intents
  ("my appointments this month", "patients waiting for approval", "refunds pending today", "doctors
  with the highest ratings") and maps them onto existing Appointment/RefundRequest/Doctor queries.
  Falls back cleanly (`matched: false`) for anything unrecognized — never guesses.
- `backend/controllers/aiAssistController.js` + `backend/routes/aiAssistRoutes.js` — new endpoints,
  mounted at `/api/ai/assist` (existing `/api/ai` routes untouched).
- Minor additive refactor of `overviewAdminController.js`: extracted `buildPlatformOverviewData()`
  so the Executive Brief reuses the exact same real aggregates as the admin dashboard stat
  cards — no second, possibly-drifting copy of that query logic.

**Frontend (new reusable components + contextual panels, no new dedicated pages):**
- `src/components/ai/AIDraftPanel.jsx` — reusable generate/regenerate/edit/approve widget used
  everywhere below. Every instance shows the AI disclaimer inline.
- `src/components/ai/SmartSearchBar.jsx` — natural-language search box.
- `src/api/aiAssistApi.js` — frontend wrapper for the new endpoints.
- Embedded contextually into:
  - **Doctor Clinical Workspace** — "Draft Clinical Note" and "Draft Consultation Summary" panels
    next to the Medical Note form, with an "Insert into note" action. Nothing is saved to the
    record until the doctor clicks the existing **Save Note** button — that Save action *is* the
    required explicit approval step.
  - **Patient Records** — "Summarize this document" in the report preview modal; "Explain this
    prescription" on every prescription card.
  - **Patient Dashboard** — "Prepare for your visit" panel under the upcoming appointment card.
  - **Patient AI Assistant page** (existing dedicated page, extended, not duplicated) — follow-up
    workflow suggestions panel.
  - **Admin Dashboard** — Executive Daily Brief, Workflow Suggestions, and Smart Search.
  - **Admin AI Insights page** (existing dedicated page, extended) — Executive Brief and Review
    Sentiment panels alongside the existing insight/forecast/schedule cards.
  - **Admin Reviews** — Review Sentiment Overview at the top, "Draft a reply" panel per review
    (draft only — nothing is sent; there's no reply-send mechanism in the review model, so this is
    a copyable draft, not a fabricated auto-reply feature).
  - **Doctor Dashboard** — "What needs my attention?" workflow suggestions panel.

### Existing Components Reused (no duplication)
Auth/`protect`/`authorizeRoles` middleware, `asyncHandler`/`AppError` conventions, `Doctor.findOne({
userId })` resolution pattern, Appointment/Prescription/MedicalReport/MedicalNote/RefundRequest/
Review models as-is, the existing `/patient/profile-completion` endpoint (referenced conceptually
for future workflow-suggestion expansion, not duplicated), and the platform-overview aggregation
now shared between the admin dashboard and the executive brief.

### AI Service Architecture
```
Controller (aiAssistController.js)
  -> generativeAssistant.js        [fetches real data from existing models]
       -> promptLibrary.js         [what to generate + safety disclaimer]
       -> textGenerationProvider   [swappable: template today, LLM later]
            -> templateProvider.js [deterministic, zero-network default]
       -> AIDraft model            [draft/approved lifecycle for record-bound content]
```

### Prompt Library Overview
| promptKey | scope | used by |
|---|---|---|
| consultationSummary | doctor | Doctor Clinical Workspace |
| clinicalNoteDraft | doctor | Doctor Clinical Workspace |
| prescriptionExplain | patient | Patient Records |
| documentSummary | patient | Patient Records (report preview) |
| appointmentPrep | patient | Patient Dashboard |
| communicationDraft | shared | Admin Reviews (reply draft), extensible to reminders/announcements |
| executiveBrief | admin | Admin Dashboard, Admin AI Insights |
| workflowSuggestions | shared (role-aware) | Admin/Doctor Dashboard, Patient AI Assistant |
| reviewSentiment | admin | Admin Reviews, Admin AI Insights |

### Build Verification
- `npm run build` (frontend): clean, no errors.
- `npx eslint` on every new/modified file: zero errors, zero warnings.
- Full-project `npx eslint` sweep: the only errors are pre-existing, in files untouched this
  session (`AppointmentStatusTracker.jsx`, `DoctorProfileStrength.jsx`, `PatientAppointments.jsx`,
  `DoctorCompare.jsx`, `DoctorProfile.jsx`, `DoctorSearch.jsx`) — flagged in earlier sessions as
  out of scope, unchanged by this phase.

### Runtime Verification
- `node --check` on every new/modified backend file: passes.
- `node server.js` boot check: full module graph (including the new `aiAssistRoutes`) loads and
  mounts cleanly; only fails on `ECONNREFUSED` connecting to MongoDB, since no live DB exists in
  this sandbox — flagged as such, not claimed as a live end-to-end verification.
- All 15 pre-existing backend test scripts re-run and still pass unchanged.
- Not verified: an actual generate -> approve -> save round trip against a live MongoDB, and a
  real LLM provider swap (none is wired in; the template provider is the only one exercised here).

### Deliberately deferred (not fabricated)
- Appointment-reminder and admin-announcement communication drafts reuse the same
  `communicationDraft` prompt/endpoint as the review-reply draft but have no UI trigger wired up
  yet — no existing screen made an obvious, low-risk home for them this session.
- A dedicated global Smart Search bar in the top nav (only added to the Admin Dashboard) — there
  was no existing global search bar/topbar component to extend without introducing new nav
  structure.
- Symptom Checker / AI Chatbot triage on the Patient AI Assistant page were left untouched — they
  predate this phase and already carry their own non-diagnostic safety framing.

---

## Production Hardening & Stability Phase

Full scope, findings, and evidence are in `docs/` (`PRODUCTION_READINESS_REPORT.md`,
`SECURITY_AUDIT_SUMMARY.md`, `PERFORMANCE_AUDIT_SUMMARY.md`, `ARCHITECTURE_REVIEW.md`,
`DEPLOYMENT_GUIDE.md`, `REMAINING_RISKS.md`, `VERIFICATION_REPORT.md`,
`ENTERPRISE_READINESS_SCORE.md`). Summary here for changelog continuity.

### The explicit production bug: backend instability, fixed at the root cause
Every Socket.IO handler (`socket/socketServer.js`, `socket/eventHandlers.js`) was an
unguarded `async` function with zero error handling; Socket.IO doesn't catch rejections
from its own listeners, so any edge-case error became a process-level `unhandledRejection`.
`server.js`'s handler for that did `server.close(() => process.exit(1))`, which hangs
forever if open WebSocket connections never drain -- exactly "stops responding until
manually restarted." Fixed with a safe wrapper for every socket handler
(`socket/asyncSocketHandler.js`, new) and a bounded process-shutdown module
(`utils/processResilience.js`, new) that force-exits on a timeout instead of ever hanging
again. Proven with two new regression tests, not just claimed.

### Also found and fixed (real bugs, surfaced by extending audit coverage)
- Backend was never linted at all (`eslint.config.js` blanket-excluded it) -- turning that
  on found a duplicate `$ne` object key in `publicController.js`'s specialty-browse query
  (silently included doctors with no specialization set) and ~8 silently-swallowed `catch`
  blocks with zero logging, including one on the auto-refund-request path.
- `npm test` in the backend was completely broken -- it ran `vitest run` against
  dependency-free plain-assert scripts, failing all 18 files unconditionally with "No test
  suite found" regardless of actual correctness. Replaced with a real runner
  (`tests/run-all.mjs`); deliberately broke a test to confirm it's now actually enforced,
  then restored it.
- Two frontend crash bugs from earlier in this same engagement: `DoctorProfileStrength.jsx`
  (corrupted hook block, threw on every render) and `DoctorSearch.jsx` (referenced an
  undefined `MODE_STYLES` map).
- `npm audit`: backend had 9 vulnerabilities (nodemailer CRLF-injection/SSRF advisories, a
  `ws` memory-exhaustion DoS via socket.io's own transitive dependency) -- all resolved,
  verified nodemailer's API still compatible. Frontend: `ws` DoS resolved safely; a Vite and
  a react-router-dom advisory both need major-version bumps and were deliberately deferred
  rather than force-applied without a dedicated regression pass.

### Security
- Added `TRUST_PROXY` config (was missing entirely -- silently breaks per-client rate
  limiting and IP audit logs behind any real load balancer).
- Production boot now fails fast if `CORS_ORIGIN`/Razorpay secrets are missing or
  `JWT_SECRET` is under 32 characters (previously silent).
- Explicit API-appropriate CSP via helmet (`default-src 'none'`) instead of browser-page
  defaults, since this is a pure JSON API.
- Every socket handler now validates its payload before use (was: raw destructuring with no
  validation).

### Performance / DevOps
- Added `compression` middleware (none existed on this JSON API before).
- Reviewed indexing/query patterns on the highest-traffic models -- already solid from
  prior phases, no changes needed.
- Added backend + frontend Dockerfiles, `docker-compose.yml`, `.dockerignore`s, and a
  GitHub Actions CI workflow (lint, tests, live-Mongo boot check, frontend build) -- none of
  this existed before.

### Verification
- `npm run lint` (repo-wide, now including backend): 0 errors, 0 warnings.
- `npm test` (backend): 17/17 passed (15 pre-existing + 2 new stability regression tests).
- `node --check` on every backend `.js` file: all pass.
- `npm run build` (frontend): clean.
- Full detail, including what could NOT be verified in this environment (no Docker daemon,
  no live MongoDB, no deployed instance -- see `docs/VERIFICATION_REPORT.md`).
