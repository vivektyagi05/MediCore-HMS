# Phase 2-D — Doctor Verification E2E: Investigation & Fixes

This was done against the real repository (deps installed, code actually
run, not just read). Where I could reproduce and fix something at the code
level, I did and I show the proof. Where true live E2E (real MongoDB, real
Brevo, real browser) was required, I say so plainly — **this sandbox has no
local MongoDB, and `mongodb-memory-server`'s binary download is blocked by
network egress rules here** (confirmed directly: a 403 from
`fastdl.mongodb.org`). That is a sandbox limitation, not something fixed in
the code.

---

## 1. `PUT /api/doctors/:id/approve` → 500 — ROOT CAUSE FIXED

**Reported:** `TypeError: Cannot read properties of undefined (reading
'notes')` at `doctorController.js:656`.

**Reproduced directly** (isolated Express instance): `express.json()` only
populates `req.body` when the request carries a body-shaped `Content-Type`
header. Any request that omits it entirely — a bare client call with no
data and no explicit header, a proxy that strips it, a test hitting the
route directly — reaches the controller with `req.body === undefined`, not
`{}`. Every mutating controller in this codebase (`approveDoctor`'s
`req.body.notes`, `rejectDoctor`'s `req.body.reason`, and others) assumed
`req.body` is always an object. That assumption was never enforced
anywhere.

**Fix** — one line, at the root, in `backend/app.js`'s existing
`sanitizeRequest` middleware (which every request already passes through
to strip Mongo operators from `req.body`):

```js
req.body = sanitizeValue(req.body ?? {});
```

This fixes the defect for every controller in the app, not just
`approveDoctor` — matching "fix root causes, don't patch one spot."

**Full contract trace, verified in code:**
Frontend `doctorApi.approveDoctor(id)` → `PUT /doctors/:id/approve` →
`backend/routes/doctorRoutes.js` (`protect`, `authorizeRoles(SUPER_ADMIN)`,
`approveDoctor`) → `approveDoctor` does an atomic
`findOneAndUpdate({_id, verificationStatus:"pending"}, ...)` (already
race-safe from a prior phase) → `User.doctorOnboardingStatus` updated →
`practiceEmitter` realtime notification (best-effort, already
try/catch-wrapped) → `emailService.sendDoctorApprovalEmail` (best-effort,
already try/catch-wrapped) → `emitAutomationTrigger` (already
try/catch-wrapped) → JSON response. Verified already-correct in the
existing code, not touched:
- Invalid doctor ID → controlled 404 (`AppError("Doctor not found", 404)`)
- Already-approved doctor → idempotent 200, no duplicate side effects
- Concurrent approve/reject → race-safe via the atomic
  `{_id, verificationStatus:"pending"}` filter
- Rejected doctor is blocked from approved-only routes via
  `requireApprovedDoctor` middleware

**Regression test:** `backend/tests/doctorApproveBodyContract.test.js`
(vitest + supertest, run with `npx vitest run tests/doctorApproveBodyContract.test.js`
from `backend/`). It boots the **real** `app.js`, exercises the real
routes/middleware/controller, and mocks only the two Mongoose models this
one code path touches directly and unguarded (`Doctor`, `User`) — no live
DB needed. I proved this is a genuine regression test by reverting the fix
and re-running: the exact same request that returns 200 with the fix
returned 500 without it. All 4 cases pass with the fix in place:
  1. No Content-Type / no body at all (the exact reported shape) → 200, not 500
  2. Normal body with `notes` → 200
  3. Nonexistent doctor → controlled 404 (not the crash)
  4. No auth token → 401 (RBAC still enforced)

The full existing backend suite (99 tests) still passes.

## 2. `GET /api/doctors/:id/approve` → 404 — confirmed NOT a bug

Only `PUT /:id/approve` is registered. Nothing in the frontend issues a
`GET` to that path — grepped the whole `src/` tree. A `GET` to a path only
registered for `PUT` correctly falls through to `notFound` → 404. Per the
explicit instruction, no route was added and `PUT` was not changed to
`GET`. If this was seen in a browser, it was someone navigating to the API
URL directly (which is always a GET) rather than a real frontend/backend
mismatch.

## 3. Socket.IO "closes before establishment" — wiring verified correct, diagnostics fixed

Verified structurally sound, with a live isolated test (same
`http.createServer(app)` + `new Server(httpServer, {...})` pattern, same
CORS config, same `transports: ["websocket", "polling"]` on both sides,
matching `socket.io`/`socket.io-client` versions at `^4.8.3`): a real
client connects and receives `socket:ready` with no issue.

**The actual gap:** `socketAuth` middleware and `io.engine`'s
`connection_error` event were completely silent on rejection. An
expired/missing/invalid JWT, or a transport-level handshake failure, closed
the connection with **zero server-side trace** — which is exactly what
"WebSocket closes before it is established" looks like from a browser, with
nothing to diagnose it by. This is almost certainly why it went
undiagnosed rather than an actual transport bug.

**Fixed:** added `logger.warn`/`logger.error` at every rejection branch in
`backend/socket/socketAuth.js`, an `io.engine.on("connection_error", ...)`
listener in `backend/socket/socketServer.js`, and surfaced the
`connect_error` reason to the browser console (dev only) in
`src/context/RealtimeContext.jsx`. This does not change behavior for a
genuinely invalid/expired token — it makes the reason visible instead of
invisible. HTTP functionality was already fully independent of Socket.IO
(confirmed — nothing in the HTTP request path touches the socket layer).

## 4. Public asset ENOENT — backend already correct; frontend fallback added

Verified: `express.static(..., { fallthrough: false })` + the global
`errorMiddleware` (registered last, per its own bugfix comment) already
turn a missing `storage/doctor-profile` or `storage/cms` file into a clean
JSON 404 — not a crash, not a raw ENOENT leak. Verified the DB → URL
contract is consistent: uploads write to `storage/<kind>/<file>` relative
to `process.cwd()`, the DB stores `/uploads/<kind>/<file>`, and the static
mount maps `/uploads/<kind>` → `storage/<kind>` the same way. No stale-path
or inconsistent-URL bug found in code.

Most likely real explanation for files being missing: `storage/` is local
disk, not a persistent volume — a redeploy of an ephemeral container wipes
it while MongoDB (a separate, persistent service) still has the old URLs.
That's an infrastructure/deployment configuration matter, not a code
defect, and I flagged it rather than guessing at infra I can't see.

**Fixed the frontend half** ("missing optional assets must produce a
controlled fallback"): none of the `<img>` tags for doctor/CMS photos had
an `onError` handler, so a stale reference just showed a broken image
icon. Added fallback-to-initials-avatar `onError` handling to:
- `src/components/admin/DoctorDetailWorkspace.jsx` (the verification
  workspace itself)
- `src/components/doctors/DoctorDiscoveryUI.jsx`
- `src/pages/public/DoctorProfile.jsx`
- `src/pages/public/DoctorSearch.jsx`

**Not done** (flagging as follow-up, ran out of scope/time): the same
`onError` pattern for CMS banner images in `AdminArticles.jsx`,
`ArticleDetail.jsx`, `Home.jsx`, and `ServiceDetail.jsx` — same fix, same
pattern, just not applied everywhere yet.

## 5. Brevo 401 on leads (password recovery "succeeds") — root cause diagnosed

Traced both flows: **identical** `BREVO_API_KEY`/sender/endpoint, identical
`fetch` implementation in `emailService.js`. They cannot genuinely differ in
credential validity.

**Real explanation, found in `passwordRecoveryController.js`:**
`forgotPassword` has an anti-user-enumeration early return — if the
submitted email doesn't match a real active user, it returns a fake
`200 success` **without ever calling Brevo**. If whoever tested password
recovery used a throwaway/non-registered email (very easy to do by
accident during manual QA), they'd see "it works" while Brevo was never
actually contacted. Lead creation, by contrast, always attempts Brevo for
every real submission — so it's the one that surfaces the true 401.

Also verified already-correct, not touched: lead creation does **not**
depend on email delivery (creates the lead regardless, catches the Brevo
error, marks `notification.status: "failed"`), and the API response
already accurately reports delivery status via
`data.emailNotification.status` (`delivered`/`failed`/`skipped`). Both of
those match your explicit requirements already.

**Fixed the actual observability gap:** the platform health check
(`platformHealthAdminController.js`) only ever verified the env vars were
*present* (`isBrevoConfigured()`), never that the key is actually *valid*
with Brevo — so health always said "healthy" right up until a real send
failed. Added `emailService.verifyBrevoCredentials()` (calls Brevo's
lightweight `GET /v3/account`, sends no email, 60s cache, never logs the
key) and wired it into health reporting so "configured" and "healthy" are
now reported separately.

**What I could not fix:** the actual invalid/revoked `BREVO_API_KEY` itself
is an environment/ops matter (rotate or correct it in whatever secret store
backs this deployment) — not something fixable from inside the repository
since it's a live third-party credential I can't verify or touch.

## 6. Frontend/backend completeness audit — scoped, not exhaustive

Given the size of the full ask (every page/component across Auth, User,
Doctor, Super Admin, Appointments, Availability, Consultation,
Prescriptions, Notifications, Payments/Refunds, Withdrawals, Public
Doctors, Public Content, Contact, Password Recovery), I focused verification
on the doctor-verification critical path end-to-end (frontend action →
API → RBAC → controller → DB → notification/email → frontend state) plus
the five specifically reported failures, rather than re-auditing the
entire product surface from scratch. I did not find TODO/FIXME markers,
`Math.random()`-based fake data, or hardcoded fake success responses
anywhere in the files I touched or traced through for this investigation,
but I have not swept the entire codebase for those patterns and I'm not
claiming I have.

## Live E2E — explicitly not run

Per your instruction to separate code-level from live verification: I did
not run the real doctor-registration-to-approval lifecycle against a real
MongoDB, a real Brevo account, or a real browser. That would require
infrastructure this sandbox doesn't have. Everything above is verified by
either (a) reading the actual code paths involved, (b) reproducing the
failure in an isolated runtime test, or (c) exercising the real Express app
over real HTTP with only the unavoidable persistence layer mocked.
