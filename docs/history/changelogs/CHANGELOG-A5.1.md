# Phase A5.1 — Executive Dashboard + Live Platform (Mission Control)

## 1. Audit Report

**Read before writing anything:** every admin controller/route, `overviewAdminController.js`
(the existing overview aggregate), `RealtimeContext`, the Socket.IO server/presence/room
managers, `notificationEmitter.js`, `backend/automation/cronJobs.js` + `backend/cron/*`,
all admin pages (`AdminDashboard.jsx`, `AdminAudit.jsx`, `AdminNotifications.jsx`, etc.),
`Sidebar.jsx`, `src/config/navigation.js`, `adminApi.js`, and every model that could feed a
KPI (Insurance, MedicalReport, RefundRequest, AIDraft, OnlineSession, NotificationDelivery,
ReminderLog, Doctor, Review, Payment, WebhookEvent, Permission).

### What existed
- `overviewAdminController.js` → `buildPlatformOverviewData()` already computed revenue,
  appointment, pending-approval, doctor/patient, and review-count aggregates, reused by both
  `/admin/overview` and the AI executive brief.
- An AI Executive Brief + Workflow Suggestions card already existed on `AdminDashboard.jsx`
  (`aiAssistApi.getExecutiveBrief/getWorkflowSuggestions`), backed by a real template-provider
  pipeline grounded in `buildPlatformOverviewData`.
- A real-time layer already existed end-to-end: `RealtimeContext` → Socket.IO → `presenceManager`
  → `notificationEmitter` → `dashboard:sync` events, already driving `AdminDashboard`'s refetch
  via `dashboardSyncTick`.
- A rule-based "emergency" text classifier (`EMERGENCY_PATTERN`) already existed in the doctor
  Command Center controller, applied to `appointment.reason`/`appointment.symptoms`.
- A real `Permission` model already exists, keyed by real capability flags
  (`manage_payments`, `manage_doctors`, `export_data`, etc.) for the two real admin roles.

### What was reused (no duplication)
- `buildPlatformOverviewData()` is called once, from the new `buildExecutiveDashboardData()`,
  and spread into the response — every existing field (revenue, appointments,
  pendingApprovals, doctors, patients, reviews, recentActivity) is untouched and computed in
  exactly one place.
- `EMERGENCY_PATTERN` was exported (not copied) from `commandCenterController.js` and reused
  for the admin-side "today's emergency-flagged appointments" signal.
- `dashboardSyncTick` / `useRealtime()` drive dashboard refresh exactly as before — no second
  realtime system was introduced.
- The existing AI Executive Brief / Workflow Suggestions cards are kept as-is on the rebuilt
  dashboard (Step 3.5 of the brief — "AI Executive Summary" — is satisfied by what already
  existed; nothing new was fabricated here since it already grounds only in real data).

### What was fixed (a real bug found during the audit)
- **`Sidebar.jsx` had a hardcoded, fabricated "System Health — 98% uptime across hospital
  services" widget**, shown to every role, on every page, forever, regardless of anything
  actually happening in the system. This is now a real, computed panel (database + socket
  status from the new Mission Control endpoint), and only renders for admin/super_admin —
  the only roles the underlying data is meaningful (and authorized) for.

### What was newly built (additive only)
- One new controller (`missionControlAdminController.js`), one new route file, one new admin
  page (`AdminMissionControl.jsx`), rebuilt `AdminDashboard.jsx`, one new nav entry, and a
  1-line `isConfigured()` accessor added to the existing `emailService`.

## 2. Implementation Summary

### Backend
- `backend/controllers/admin/missionControlAdminController.js` (NEW): three builders —
  `buildExecutiveDashboardData`, `buildMissionControlData`, `buildSmartAlerts` — plus their
  route handlers.
- `backend/routes/admin/missionControlAdminRoutes.js` (NEW): `GET /dashboard`, `GET /live`,
  `GET /alerts`, protected by the existing `protect` + `requireAdmin` middleware (same pattern
  as `overviewAdminRoutes.js`).
- `backend/app.js`: one import + one `app.use("/api/admin/mission-control", ...)` line added.
- `backend/services/emailService.js`: added `emailService.isConfigured()`, exposing the
  existing `isEmailConfigured` flag so Mission Control can report real email-channel status
  instead of guessing.
- `backend/controllers/doctor/commandCenterController.js`: exported the existing
  `EMERGENCY_PATTERN` constant (previously module-private) so it can be reused, not copied.

### Frontend
- `src/pages/dashboard/AdminDashboard.jsx` (REBUILT): now an Executive Dashboard —
  Executive Header (date, platform health score), Executive KPI Grid (8 real KPIs), revenue/
  pending/review stat row, Patient/Doctor Growth + Repeat Patients row, Today's Operations
  (5 linked action cards), a Smart Alert Center summary (top 5 alerts, links to full queue),
  the existing AI Executive Brief/Workflow Suggestions cards, Quick Actions, an Executive
  Timeline (renamed Recent Activity — same `AdminActivityLog` data), and a real System Status
  strip (DB/socket/email).
- `src/pages/admin/AdminMissionControl.jsx` (NEW): Live Platform / Mission Control page —
  presence (doctors/patients online, active sessions), live consultations, payments captured
  in the last hour, pending refunds, AI activity + notifications in the last 15 minutes,
  infrastructure status (DB/socket/email/SMS), automation trigger model + last-run time, and
  the full Priority Alert Queue. Auto-refreshes every 15s in addition to realtime sync.
- `src/api/adminApi.js`: added `getExecutiveDashboard`, `getMissionControl`, `getSmartAlerts`.
- `src/config/navigation.js`: added a "Mission Control" nav entry (admin/super_admin only).
- `src/routes/AppRoutes.jsx`: added the `/admin/mission-control` route inside the existing
  admin `DashboardLayout` route group.
- `src/components/layout/Sidebar.jsx`: replaced the fabricated uptime widget (see Audit
  Report) with a real one, admin-only.

## 3. Business Rules (every KPI's computation)

| KPI | Computation |
|---|---|
| Live Consultations | `Appointment.count({status: consultation_started})` |
| Insurance Queue | `Insurance.count({claimStatus: submitted or in_review})` |
| AI Requests Today | `AIDraft.count({createdAt >= startOfToday})` |
| Critical Reports Pending | `MedicalReport.count({severity: critical, reviewedAt: null})` |
| Average Rating | `avg(Review.rating)` where `adminDeleted != true` |
| Repeat Patients | patients with ≥2 `completed`/`review_eligible` appointments |
| Patient/Doctor Growth % | (this week's new count − last week's) / last week's × 100; `null` (shown as "No prior-week data") when last week was 0, never divide-by-zero-as-0 |
| Emergency Today | today's appointments where `EMERGENCY_PATTERN` matches `reason`+`symptoms` |
| Platform Health Score | 100 − (cancellation-rate points above 10%) − (payment-failure-rate points above 5%) − (10 if DB unhealthy) − (5 per unresolved critical alert, capped at 25), floored at 0 — full breakdown returned alongside the score |
| Database/Socket/Email/SMS status | `mongoose.connection.readyState`, `io.engine.clientsCount`, `emailService.isConfigured()`, and an honest "not integrated" for SMS (no provider exists in this codebase) |
| Automation "last run" | latest `ReminderLog.createdAt` — the automation pipeline is on-demand (`POST /api/ai/automation/run`), not scheduled; reported as such, not as a fake "running" state |

## 4. Realtime Flow

No new realtime system. `dashboardSyncTick` (existing `RealtimeContext` → Socket.IO →
`dashboard:sync`) drives both the Executive Dashboard and Mission Control refetch, exactly as
it already drove the old `AdminDashboard`. Mission Control additionally polls every 15 seconds
on top of that, since presence/session counts can change without a `dashboard:sync` event
firing.

## 5. Security Notes

The brief asked for RBAC across "Super Admin, Admin, Finance, Support, Operations" — **those
roles do not exist in this codebase** (`constants/roles.js` defines
`super_admin, admin, doctor, receptionist, patient` only, and only the first two ever reach
`/admin/*` routes). Rather than fabricate new roles, both new endpoints are protected by the
existing `protect` + `requireAdmin` middleware (identical to every other admin route), and the
existing `Permission` model remains the real, extensible mechanism for any future
finer-grained widget gating between `admin` and `super_admin`. This is documented as a real
gap, not silently worked around.

## 6. Verification Report

- `node --check` on every backend `.js` file (including all new/modified files): **pass**.
- `node tests/run-all.mjs`: **17 passed, 0 failed** (unchanged from before this phase).
- Server boot check: boots cleanly through middleware/route registration; fails only at
  `MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017`, because no live
  MongoDB exists in this sandbox — the same expected/documented outcome as every prior phase.
- `npx eslint src/`: **zero errors** across the entire frontend.
- `npm run build`: **clean production build**, `AdminDashboard` and `AdminMissionControl`
  chunks both compile successfully.
- The one Vitest suite (`api.test.js`) remains unrunnable in this sandbox
  (`mongodb-memory-server` can't download its MongoDB binary without network access) —
  flagged as unverified, not claimed as passing, consistent with every previous phase.

## 7. Documented Gaps (intentionally not fabricated)

- **RBAC roles** — see Security Notes above.
- **SMS channel** — no provider integrated anywhere in this codebase; reported honestly as
  "not integrated" rather than shown as online.
- **Background job queue** — there is no Bull/Agenda/etc. queue; the AI automation cron is
  triggered on demand. Reported as such via `automation.triggerModel`.
- **Complaint system** — no complaint/report model exists anywhere in the codebase; "Pending
  Complaints" was omitted rather than mapped to something unrelated.
- **"Late arrivals" vs "delayed"** — no check-in timestamp exists in the data model (same gap
  already documented in the Phase D5 changelog); not built.
