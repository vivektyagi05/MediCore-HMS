# MediCore HMS — Product Hardening Pass (Process Governance ZIP)

Scope: fix the 4 confirmed bugs + 2 observations from live manual testing.
No new features, no architecture changes, no mock data introduced. Every
fix below is either a genuine bug fix or an explicitly-scoped completion of
an already-broken contract (Product Truth Principle).

## 1. Confirmed bugs fixed

### Bug #1 — AdminSettings crash (`ReferenceError: Cannot access 't' before initialization`)
**Root cause:** `useState(t("common.saved"))` referenced `t` a line before
`const { t } = useI18n()` ran.
**Fix:** moved `useToast()`/`useI18n()` to the top of the component, made the
initial `saveState` a lazy initializer (`useState(() => t("common.saved"))`),
added `t` to the save-effect's dependency array (it was stale — the effect
never picked up a locale change), and swapped two hardcoded English strings
("Saving...", "Save failed") for `t("common.saving")` / `t("common.error")`
so the whole status line is actually translated.
**File:** `src/pages/admin/AdminSettings.jsx`
**Status:** REAL + VERIFIED (lint + build clean; behavior verified by reading
render order, no live browser available in this sandbox — see Remaining
below).

### Bug #2 — invalid nested `<button>` in AdminPatients.jsx
**Root cause:** a `Button` (renders `<button>`) wrapped another `Button`,
producing `<button><button>Delete</button>View Details</button>` — invalid
HTML, hydration risk.
**Fix:** split into four independent sibling actions (View Details / Edit /
Activate-Deactivate / Delete) in a `flex flex-wrap gap-2` row, matching the
button-row pattern already used elsewhere in the same file.
**Follow-up audit:** wrote a small stack-based scanner across every `.jsx`/
`.js` file for `Button`/`Link`/`button`/`a` opened while another of the same
set was still open. Found one more real instance: `PatientDoctors.jsx` had
`<Link><Button>...</Button></Link>` — a `<button>` nested inside an `<a>`,
which is invalid HTML the same way (interactive content cannot nest inside
an anchor). Fixed by using `Button`'s own `to` prop instead of double-
wrapping, and removed the now-unused `Link` import. Re-ran the scanner after
both fixes — zero remaining matches anywhere in `src/`.
**Files:** `src/pages/admin/AdminPatients.jsx`, `src/pages/patient/PatientDoctors.jsx`
**Status:** REAL + VERIFIED (build clean, scanner confirms zero remaining
nested-interactive instances repo-wide).

### Bug #3 — NotificationDelivery enum mismatch, and its full blast radius
**Root cause:** `workflowEvents.js` has sent `type: "workflow_assigned"` /
`"workflow_escalated"` since Phase A6.2.1, but `NotificationDelivery`'s enum
never included them — every one of those `.create()` calls threw a
`ValidationError`.
**Decision (per the "audit before changing anything" instruction):** neither
value fits an existing category (appointment/payment/refund/prescription/
admin_announcement/chat/dashboard_sync/report/insurance) — an internal
operations hand-off notice to an admin isn't any of those — so these are
legitimate new types, added the same additive way Phase D5 added
report/insurance.

**Wider audit finding:** grepped every `notificationEmitter.emitToUser/
emitToUsers/emitToRole/emitToAdmins` call site in the backend for the exact
same pattern (a literal `type:` string not present in the enum) and found
**eight more** real instances, spanning three separate phases:
| Type | Source | Fits an existing category? |
|---|---|---|
| `automation` | Automation Studio's notify_user/notify_role/notify_admins actions | No — admin-configured content, could be anything |
| `reminder` | Automation Studio's "send reminder now" action | No — same reason |
| `schedule` | Doctor leave-request status change (`clinicalEmitter.js`) | No — not an appointment |
| `document` | Doctor verification-document status (`clinicalEmitter.js`) | No — distinct from patient `report` |
| `doctor_verification` | Doctor verification approved/rejected/pending (`practiceEmitter.js`) | No |
| `subscription_update` | Doctor subscription status change (`practiceEmitter.js`) | No |
| `invoice_generated` | New practice-management invoice (`practiceEmitter.js`) | No |
| `subscription_renewal_reminder` | Upcoming subscription renewal (`practiceEmitter.js`) | No |

Every one of these has been silently failing validation since the phase
that introduced it. All eight are additive new enum values, same reasoning
as workflow_assigned/escalated.

**A ninth candidate that was NOT added — because it was a different bug:**
`assignment_auto_assigned` (`assignmentEvents.js`). Tracing its call site
(`assignmentScheduler.js`) showed the auto-assign path already runs through
`executeWorkflowTransition()`, whose own `WORKFLOW_EVENTS.ASSIGNED` listener
sends a "you've been assigned" notification carrying the exact same `reason`
string via its `note` field. The `assignment_auto_assigned` listener was
sending a **second, fully redundant notification for the same single
assignment** — a real duplicate-side-effect bug, not a missing type. Fixed
by removing the redundant `notificationEmitter.emitToUser()` call from that
listener (kept the dashboard-sync ping, which nothing else triggers for
auto-assign), and removed the now-unused `getWorkflowDefinition` import.

**Frontend layers updated** (per the brief's checklist — model enum,
creation, frontend rendering, filtering, notification center):
- `AdminNotifications.jsx` (admin notification center): added labels for
  `workflow_assigned`, `workflow_escalated`, `automation`, `reminder` — the
  only new types an admin can actually receive.
- `DoctorSmartInbox.jsx` (doctor notification hub): added labels for
  `automation`, `reminder`, `schedule`, `document`, `doctor_verification`,
  `subscription_update`, `invoice_generated`, `subscription_renewal_reminder`
  — all of these target `doctorUserId`, never an admin, so they belong in
  the doctor hub's map, not the admin one.
- `PatientHomeWidgets.jsx`: no change — patients never receive any of the
  newly-fixed types, confirmed by checking every emitter's recipient.
- No dedicated realtime event-handling changes needed: `RealtimeContext.jsx`
  handles `notification:new` generically (title/message/severity), it
  doesn't switch on `type`.
- i18n: not applicable — none of the existing notification-type labels in
  this codebase are i18n-translated strings; adding these matches that
  existing (non-i18n'd) precedent exactly.

**Files:** `backend/models/NotificationDelivery.js`,
`backend/workflow/assignment/assignmentEvents.js`,
`src/pages/admin/AdminNotifications.jsx`, `src/pages/doctor/DoctorSmartInbox.jsx`
**Tests:** `backend/tests/workflowNotifications.test.mjs` — new file, 11
schema-validation assertions (one per new enum value + one confirming the
enum still rejects an unrecognized type) plus a regression assertion that
`ASSIGNMENT_EVENTS.AUTO_ASSIGNED` has exactly one listener left and it
doesn't throw on a payload with no notification fields.
**Status:** REAL + VERIFIED (all 11 new schema assertions pass; duplicate-
notification regression test passes; full 27/27 suite green).

### Bug #4 — false success / partial failure (Product Truth Principle)
**Root cause:** `workflowEngine.js` called `workflowEventBus.emit(event,
...)` and immediately returned. `EventEmitter.emit()` invokes listeners
synchronously but never awaits an async listener or surfaces its rejection
— so while bug #3 was live, every one of those listener calls rejected
with an unhandled promise rejection nobody could observe, while the HTTP
response still reported a plain `200` success.

**Fix — explicit partial-success result model** (as instructed, without
either rolling back the successful core transition or fabricating success):
- Added `emitWorkflowEvent(event, payload)` to `workflowEvents.js`: awaits
  every listener via `Promise.allSettled`, logs any rejection, and returns
  `{ delivered: boolean, error: string|null }` instead of throwing or
  silently swallowing it.
- `workflowEngine.js`'s `executeWorkflowTransition()` now awaits this and
  returns the result on `notification: { delivered, error }`.
- `assignOperation`/`escalateOperation` controllers now read
  `result.notification.delivered` and return an honest message: "Operation
  assigned successfully, but the assignee could not be notified..." instead
  of a blanket "Operation assigned" that hides the failure. `data.notification`
  is included on the response so the frontend can act on it.
- Frontend: `OperationsWorkspaceDrawer.jsx`'s shared `runAction()` helper
  (used by all three assign/escalate call sites — manual assign, the Smart
  Recommendation card, and the Reassignment Suggested card) now checks
  `response.data.notification.delivered` and shows a distinct **warning**
  toast instead of a green success toast when the side effect failed. Added
  a `warning` variant to `ToastContext.jsx` (amber, `AlertTriangle` icon) —
  previously only success/error existed, so a partial success had no way to
  render as anything but a full success.

**Files:** `backend/workflow/workflowEvents.js`, `backend/workflow/workflowEngine.js`,
`backend/controllers/admin/operationsAdminController.js`,
`src/context/ToastContext.jsx`, `src/components/admin/OperationsWorkspaceDrawer.jsx`
**Tests:** `workflowNotifications.test.mjs` — `emitWorkflowEvent` resolves
`delivered:true` when every listener succeeds, and `delivered:false` (never
throws) when a listener rejects.
**Status:** REAL + VERIFIED (unit-level: the awaitable emit + result
plumbing is tested end-to-end from the event bus's perspective; the full
HTTP round-trip through a live assign/escalate call needs a running Mongo +
browser — see Remaining below).

## 2. Observations investigated

### Observation #5 — HTTP 429 on `/api/admin/monitoring/overview`
**Finding: expected, not a bug in this endpoint.** That route isn't
specially rate-limited — it shares the global `apiLimiter`
(100 requests / 15 min per IP, `backend/app.js`) with every other
`/api/admin/*` call an admin session makes across every dashboard, tab, and
AI-explain click in the app. A busy admin session can exhaust that budget
without any single endpoint misbehaving. Per the brief's explicit
instruction ("do not simply increase/remove rate limits"), the rate limiter
itself was left untouched.

**Gap that WAS real and got fixed:** the dashboard tab rendered a 429 with
the exact same plain rose error text as a genuine server failure — no way
to tell "you're rate limited, wait a bit" from "the server is broken," and
no retry affordance at all.
**Fix:** `AdminMonitoringPlatform.jsx`'s `DashboardTab` now detects
`err.response?.status === 429` specifically and renders a distinct
amber rate-limit state with a manual "Try again" button (`retryToken` state
bumps to re-trigger the fetch). No automatic retry loop — the admin decides
when to try again, so there's no risk of the classic "429 triggers instant
retry triggers another 429" loop.
**File:** `src/pages/admin/AdminMonitoringPlatform.jsx`
**Status:** REAL + VERIFIED (build clean; 429-specific branch logic
reviewed against express-rate-limit's actual response shape).

### Observation #6 — multiple Socket.IO connections for the same user
**Root cause confirmed, with evidence:**
1. `socketClient.js`'s `connectSocket(token)` only checked `socket?.connected`
   before deciding whether to reuse or create a socket. A socket that has
   been asked to connect but hasn't finished its handshake yet is neither
   `null` nor `.connected` — so a second call in that window (React 18
   StrictMode's dev-only mount→cleanup→mount double-invoke is the textbook
   trigger, but any fast remount works) silently created a **second** live
   `io()` connection while orphaning the first, which was never disconnected.
2. `RealtimeContext.jsx`'s effect cleanup removed socket listeners and
   cleared the heartbeat interval, but never called `disconnectSocket()` —
   so even a genuine component unmount left the underlying connection open
   rather than closing it.
3. Checked the server side (`backend/socket/socketServer.js`) to rule out a
   server-side dedup mechanism masking this — there is none; each new
   connection is accepted independently, so the leak is real and
   client-side only.

**Fix:**
- `connectSocket()` now reuses any in-flight socket for the same token
  (not just a fully-`.connected` one), and only disconnects-and-recreates
  when the token actually changes (e.g. a different user logs in).
- `RealtimeContext.jsx`'s cleanup now also calls `disconnectSocket()`. This
  is safe precisely because of the fix above: a StrictMode remount now
  disconnects cleanly then reconnects once, with no leaked duplicate.
**Files:** `src/socket/socketClient.js`, `src/context/RealtimeContext.jsx`
**Status:** REAL + VERIFIED (logic reviewed against Socket.IO client
semantics and the exact StrictMode double-invoke lifecycle described in the
brief; no live browser/WebSocket session available in this sandbox to
capture a literal "before: 2 connections, after: 1" network trace — see
Remaining below).

## 3. Files changed

Backend:
- `backend/models/NotificationDelivery.js` — enum additions (9 new types)
- `backend/workflow/workflowEvents.js` — `emitWorkflowEvent()` added
- `backend/workflow/workflowEngine.js` — awaits emit, returns `notification` result
- `backend/workflow/assignment/assignmentEvents.js` — removed duplicate notification
- `backend/controllers/admin/operationsAdminController.js` — honest partial-success responses
- `backend/tests/workflowNotifications.test.mjs` — new, 15 assertions

Frontend:
- `src/pages/admin/AdminSettings.jsx` — init-order fix + i18n staleness fix
- `src/pages/admin/AdminPatients.jsx` — nested-button fix
- `src/pages/patient/PatientDoctors.jsx` — nested Link/Button fix
- `src/pages/admin/AdminNotifications.jsx` — new type labels (admin-relevant subset)
- `src/pages/doctor/DoctorSmartInbox.jsx` — new type labels (doctor-relevant subset)
- `src/context/ToastContext.jsx` — `warning` toast variant
- `src/components/admin/OperationsWorkspaceDrawer.jsx` — partial-success handling
- `src/pages/admin/AdminMonitoringPlatform.jsx` — 429-specific UI state + manual retry
- `src/socket/socketClient.js` — fixed duplicate-connection leak
- `src/context/RealtimeContext.jsx` — cleanup now disconnects the socket

## 4. End-to-end scenarios tested (this sandbox)

- `node --check` on every changed backend file — clean.
- Full existing backend test suite (`node tests/run-all.mjs`) — **27/27
  passing** (26 pre-existing unchanged + 1 new file with 15 assertions).
- `node server.js` boot — clean (`ECONNREFUSED` only, the same and only
  expected error every prior phase's verification has produced — no live
  MongoDB in this sandbox).
- `npx eslint .` (whole repo) — **0 errors, 0 warnings**.
- `npm run build` — clean production build, all changed pages' chunks
  present (`AdminSettings`, `AdminPatients`, `PatientDoctors`,
  `AdminNotifications`, `AdminMonitoringPlatform` all compile).
- Custom nested-interactive-element scanner across the entire `src/` tree —
  zero remaining matches after the fix.
- Custom grep sweep of every `notificationEmitter.*` call site against
  `NotificationDelivery`'s enum — zero remaining mismatches after the fix.

## 5. Before/after behavior

| Scenario | Before | After |
|---|---|---|
| Open Admin Settings | Immediate crash (`ReferenceError`) | Loads; save status shows translated "Saving…"/"Saved"/error text |
| Admin Patients page renders | React hydration warning, invalid DOM | Four independent, clickable action buttons per patient |
| Admin assigns/escalates an operation | 200 "success" even when the notification silently failed validation | Notification actually delivers; if it somehow still fails, the response and a warning toast say so honestly |
| Auto-assign fires | Assignee got two notifications for one assignment | Assignee gets exactly one |
| Admin/doctor views their notification center | 8 real notification types never showed up there at all (always failed to save) | All types save and filter correctly |
| Admin monitoring dashboard hits the shared rate limit | Generic red error text, no guidance | Amber "you're refreshing too fast" state with a manual retry button |
| Two React renders/remounts of the realtime provider | Two live sockets for the same user, one leaked forever | Exactly one live socket, old one cleanly closed first |

## 6. Remaining real defects / needs live verification

- **No live browser or MongoDB in this sandbox** — every fix above is
  verified at the syntax/lint/build/unit-test level and by close reading
  against the actual library semantics (React effect lifecycle, Socket.IO
  client behavior, Mongoose enum validation, express-rate-limit's response
  shape), but none of it has been exercised against a real running
  frontend + backend + database. Per the brief: this is flagged as
  **UNKNOWN — NEEDS LIVE VERIFICATION**, not claimed as fully proven.
- The pre-existing `api.test.js` Vitest suite remains unrunnable in this
  sandbox (`mongodb-memory-server` can't download its MongoDB binary,
  network-restricted) — same as every prior phase, not a regression.
- Global audit items 1–10 (the explicit checklist) are covered by the four
  bugs + two observations above. Items 11–20 (hardcoded UI data, mock data
  in production paths, "coming soon" placeholders, missing audit logs,
  frontend-only permission/business-rule checks, un-reverted optimistic
  updates, stale cache after mutations) were **not** exhaustively audited
  across this ~20-phase, multi-hundred-file codebase in this pass — doing
  so honestly would require its own dedicated session per area rather than
  a surface pass that risks missing real issues or fabricating a false
  "all clean." Flagged as **UNKNOWN — NEEDS LIVE VERIFICATION** rather than
  guessed at.

## 7. Intentionally deferred functionality

- None newly deferred in this pass — no new capability was discovered that
  warranted a build-vs-defer decision; every fix here closes an existing,
  already-specified contract (a crash, an invalid DOM structure, a
  validation failure, a false-success response, a missing retry
  affordance, a connection leak).

## 8. Fake/mock/hardcoded functionality discovered

- None found in the course of this pass. Every code path touched already
  reads from real backend calls, real Mongoose models, or real Socket.IO
  events — no placeholder/demo data was introduced or encountered in the
  files this pass touched.

## 9. Partial-success/error-handling gaps discovered

- The core finding of this pass: **8 more notification call sites** had the
  exact same enum-mismatch failure mode as the 2 confirmed in the original
  bug report — see Bug #3 above. All fixed the same way.
- **1 genuine duplicate-notification bug** found by tracing bug #3's fix
  to its full call graph (auto-assign sending two notifications for one
  event) — not something the original bug report flagged, found purely by
  following the "audit before changing anything" instruction through to
  every caller.

## 10. Production-readiness assessment

The four confirmed bugs and both observations are now fixed at the code
level, covered by tests where the sandbox allows (unit/schema level), and
verified clean through lint, build, and the full existing test suite. The
honest gap is real end-to-end verification against a live database and
browser session, which this sandbox cannot provide — that step is
explicitly called out above rather than skipped or asserted away.
