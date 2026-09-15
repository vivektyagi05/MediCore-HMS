# Integration Report

## Scope

The HMS project has been integrated as one React and Node.js application without rebuilding completed modules. The pass focused on connecting existing enterprise systems, removing role and route conflicts, preserving the strongest implementations, and validating the application as a runnable package.

## Connected Systems

- Frontend routing is centralized in `src/routes/AppRoutes.jsx` with lazy-loaded public, admin, doctor, patient, finance, invoice, chat, and AI routes.
- API access is centralized in `src/api/axios.js` with JWT attachment, request timeout handling, friendly error normalization, and 401-triggered logout.
- Auth state is centralized in `src/context/AuthContext.jsx` with persisted sessions and role-based dashboard redirects.
- Realtime state is provided through the existing realtime context and Socket.IO client modules.
- Backend routes are centralized in `backend/app.js` and mounted under stable `/api/*` namespaces.
- Socket.IO is initialized in `backend/server.js` against the Express HTTP server.
- Payment webhooks are mounted before JSON parsing so Razorpay signature verification receives the raw request body.
- Seed setup is available through `backend/seed.js` for super admin, permissions, services, settings, and feature flags.

## Backend Route Map

- `/api/auth`
- `/api/ai`
- `/api/doctors`
- `/api/doctor`
- `/api/appointments`
- `/api/patient`
- `/api/payments`
- `/api/finance`
- `/api/invoices`
- `/api/wallet`
- `/api/refunds`
- `/api/realtime`
- `/api/admin/services`
- `/api/admin/settings`
- `/api/admin/permissions`
- `/api/admin/cms`
- `/api/admin/features`
- `/api/admin/activity`
- `/api/admin/exports`

## Frontend Route Map

- Public: `/`, `/about`, `/contact`, `/login`, `/register`
- Admin: `/admin/dashboard`, `/admin/finance`, `/admin/finance/ops`, `/admin/invoices`, `/admin/ai`, `/admin/services`, `/admin/settings`
- Doctor: `/doctor/dashboard`, `/doctor/clinical`, `/doctor/schedule`, `/doctor/documents`, `/doctor/analytics`, `/doctor/billing`
- Patient: `/patient/dashboard`, `/patient/wallet`, `/patient/invoices`, `/patient/records`, `/patient/family`, `/patient/insurance`, `/patient/doctors`, `/patient/profile`, `/patient/payments/:appointmentId`, `/patient/ai`
- Shared protected: `/invoices/:invoiceId`, `/chat/:userId`

## Workflow Coverage

- Patient flow: register, login, doctor discovery, appointment booking, payment, wallet, invoice, notifications, reports, insurance, family, saved doctors, AI assistant.
- Doctor flow: login, dashboard appointments, clinical workspace, prescriptions, notes, schedule, leave/document workflows, analytics, billing.
- Admin flow: dashboards, services, settings, permissions, CMS, feature toggles, activity logs, exports, finance analytics.
- Finance flow: order creation, verification, webhook handling, invoices, wallet ledger, refunds, subscriptions, reconciliation scaffolding.
- Realtime flow: socket authentication, rooms, notifications, presence, chat foundation, missed-event recovery API.
- AI flow: recommendations, symptom suggestion, scheduling, insights, reminders, predictive analytics scaffolding.

## Security Coverage

- JWT authentication and RBAC are enforced through shared backend middleware.
- Admin-only modules use admin middleware and dynamic permission checks.
- Public registration is restricted to patient and doctor roles.
- Super admin and admin hierarchy is supported in protected admin routes.
- Helmet, CORS, rate limiting, request sanitization, and centralized error handling are active.
- Upload destinations are created server-side and constrained by upload workflow routes.
- Razorpay webhooks use raw body handling and signature verification architecture.

## Validation Summary

- Backend source import audit passed across 123 source modules, excluding dependency, storage, test, and boot files.
- Frontend lint passed.
- Frontend production build passed.
- Backend API tests passed.
- Frontend and backend dependency audits reported 0 vulnerabilities at the configured audit threshold.

See `docs/bug-fixes-report.md` and `docs/missing-connections-report.md` for details.
