# Architecture

This document explains how MediCore HMS is actually structured today, and
why the boundaries are drawn where they are. For request/data flow, see
[`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md). For the financial subsystem
specifically, see [`FINANCIAL_ARCHITECTURE.md`](FINANCIAL_ARCHITECTURE.md).

## High-level shape

```
React + Vite (SPA)
      │
      ▼
Frontend: Pages / Components / Contexts / API clients
      │
      ▼
Central API layer (src/api/*.js, one module per backend domain)
      │
      ▼
Express HTTP API
      │
      ├── Auth (JWT) + Authorization (role/permission middleware)
      ├── Validation
      ├── Rate limiting (express-rate-limit)
      ├── Controllers
      ├── Domain / Services
      ├── Financial services (backend/payments/)
      ├── Realtime / Socket.IO layer
      ├── Notifications (email via Brevo)
      └── Integrations (Razorpay)
              │
              ▼
          MongoDB (via Mongoose)
```

This is not a generic three-layer CRUD app: the backend is organized
around real product domains (public discovery, clinical, finance,
realtime, admin operations), and the financial domain in particular has
its own state machines and reconciliation logic rather than being another
CRUD resource.

## Domain map

```
                         MediCore HMS
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
     Public               Clinical              Operations
   Experience             Experience              Platform
        │                     │                     │
        ├─ Doctor Search      ├─ Patients            ├─ Admin dashboard
        ├─ Doctor Profiles    ├─ Doctors             ├─ Leads
        ├─ Services           ├─ Appointments         ├─ Monitoring platform
        ├─ Articles/CMS       ├─ Clinical workspace   ├─ Process automation /
        └─ SEO                └─ Practice mgmt        │  governance / designer
                              │                     └─ Feature toggles
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
     Financial              Realtime                 AI
      Domain                 Domain                Domain
        │                     │                     │
        ├─ Payments            ├─ Socket.IO           ├─ AI assist controller
        ├─ Payment attempts    ├─ Presence            ├─ AI insights
        ├─ Wallet              ├─ Notifications       └─ Symptom sessions
        ├─ Wallet recharges    └─ Chat / messaging
        ├─ Refunds
        ├─ Doctor payouts
        ├─ Withdrawals
        ├─ Invoices
        └─ Transaction ledger / reconciliation
```

Each box above corresponds to real files in the repository (models,
controllers, routes, and/or `src/pages` directories of the same name) —
this is not an aspirational diagram. See `docs/FEATURES.md` for the
per-area implementation status.

## Frontend (`src/`)

- **Pages** (`src/pages/`) — route-level views, grouped by area:
  `admin/`, `doctor/`, `patient/`, `public/`, `auth/`, `ai/`, `finance/`,
  `invoice/`, `payment/`, `dashboard/`, `chat/`.
- **Components** (`src/components/`) — reusable UI, grouped by the same
  domains plus cross-cutting ones (`shared/`, `layout/`, `ui/`).
- **API clients** (`src/api/`) — one module per backend domain
  (`paymentApi.js`, `walletApi.js`, `refundApi.js`, `withdrawalApi.js`,
  `financeApi.js`, `appointmentApi.js`, `doctorApi.js`, `adminApi.js`,
  `processApi.js`/`processDesignerApi.js`/`processGovernanceApi.js`/
  `processAnalyticsApi.js`, `automationStudioApi.js`,
  `integrationHubApi.js`, `intelligenceApi.js`, `monitoringApi.js`,
  `leadApi.js`, `privacyApi.js`, `realtimeApi.js`, `publicApi.js`,
  `authApi.js`, `invoiceApi.js`, `commandCenterApi.js`) — this is the
  boundary between UI and backend; all HTTP calls go through `axios.js`.
- **Routing** — `src/App.jsx` plus `src/layout/MainLayout.jsx` (public
  site) and `src/layout/DashboardLayout.jsx` (authenticated
  patient/doctor/admin areas).
- **Realtime client** — `src/socket/socketClient.js` +
  `socketEvents.js`, mirroring the backend's Socket.IO event contract.
- **Shared feature modules** — `src/utils/` holds cross-cutting logic used
  by multiple pages (appointment status display, booking intent,
  consultation mode, payment/transaction status display, ICS calendar
  generation, doctor-patient preference helpers).

## Backend (`backend/`)

- **Routes** (`backend/routes/`, ~51 files) — thin route definitions,
  largely one file per resource, with an `admin/`, `doctor/`, and
  `patient/` subdirectory for role-scoped route groups.
- **Middleware** (`backend/middleware/`) — `authMiddleware.js` (JWT
  verification), `roleMiddleware.js` / `adminMiddleware.js`
  (authorization), `accountRateLimit.js`, `asyncHandler.js` (error
  propagation for async route handlers), `errorMiddleware.js` (central
  error formatting + 404 handling).
- **Controllers** (`backend/controllers/`, ~56 files) — request/response
  handling and orchestration; delegate business logic to services/models
  rather than embedding it inline. Grouped into `admin/`, `doctor/`,
  `patient/`, and root-level (shared/public-facing) controllers.
- **Services** (`backend/services/`, ~30 files) — domain logic that isn't
  tied to a single HTTP request: email sending (`emailService.js`),
  Razorpay integration (`razorpayService.js`), SEO
  infrastructure/validation, doctor profile intelligence, appointment
  lifecycle helpers (cancellation, expiry, history), review
  rating/filtering, and an `ai/` and `commandCenter/` sub-area.
- **Financial services** (`backend/payments/`) — see
  `FINANCIAL_ARCHITECTURE.md`. This is deliberately its own top-level
  directory, not nested under `services/`, because of how much
  correctness-critical logic (state machines, idempotency, gateway
  adapters) lives there.
- **Models** (`backend/models/`, ~50 files) — Mongoose schemas. Domain
  groupings include: identity (`User`, `Permission`), clinical
  (`Appointment`, `ConsultationHistory`, `MedicalNote`, `MedicalReport`,
  `Prescription`, `Certificate`, `SymptomSession`), financial (`Payment`,
  `PaymentAttempt`, `Wallet`, `WalletRecharge`, `RefundRequest`,
  `DoctorPayout`, `Withdrawal`, `TransactionLedger`, `Coupon`,
  `Subscription`, `Invoice`), operational (`Lead`, `CMSPage`, `Review`,
  `LeaveRequest`, `OperationAssignment`, `AutomationFlow`,
  `AutomationRunLog`, `ProcessDefinition`,
  `ProcessOptimizationRecommendation`, `FeatureToggle`,
  `HospitalSetting`), and platform/audit (`AdminActivityLog`,
  `NotificationDelivery`, `WebhookEvent`, `CronRunLog`, `ConsentRecord`,
  `PrivacyRequest`, `PrivacyPreference`).
- **Realtime** (`backend/socket/`) — `socketServer.js` (setup),
  `socketAuth.js` (JWT auth for socket connections), `presenceManager.js`
  / `presenceQuery.js` (online-status tracking, currently in-process
  memory — see `docs/REMAINING_RISKS.md` for the single-instance
  limitation), `roomManager.js`, `eventHandlers.js`,
  `asyncSocketHandler.js` (error-safe event handler wrapping).
- **Tests** (`backend/tests/`, ~96 files) — run via a custom runner
  (`backend/tests/run-all.mjs`) that spawns each `*.test.mjs` file with
  Node's built-in test primitives; most are dependency-free (no live
  MongoDB required). See `docs/DEPLOYMENT_GUIDE.md` §6 and
  `docs/REMAINING_RISKS.md` §9 for current pass/fail status.

## Cross-cutting concerns

- **Authentication** — JWT (`jsonwebtoken`), passwords hashed with
  `bcrypt`.
- **Authorization** — role middleware (admin/doctor/patient) plus a
  `Permission` model for finer-grained checks in admin areas.
- **Validation** — performed in controllers/services before any write;
  financial writes additionally validate amount, currency, and ownership
  against the payment gateway's own response (see
  `FINANCIAL_ARCHITECTURE.md`).
- **Rate limiting** — `express-rate-limit` at the app level, plus
  `accountRateLimit.js` for account-specific limits (e.g. login attempts,
  OTP requests).
- **Logging** — `backend/utils/logger.js` (`requestLogger`).
- **Audit** — `AdminActivityLog` records admin actions; financial state
  transitions are recorded in each entity's own `stateHistory`/timeline
  fields plus `TransactionLedger`.
- **Error handling** — `asyncHandler.js` wraps async route handlers so
  thrown errors reach `errorMiddleware.js` instead of crashing the
  process; `notFound` handles unmatched routes.
- **Notifications** — `emailService.js` sends transactional email/OTP via
  Brevo's HTTP API (requires `BREVO_API_KEY` etc. to actually send — see
  `docs/DEPLOYMENT_GUIDE.md`); `NotificationDelivery` tracks delivery
  status; realtime notifications go over Socket.IO.

## Why these boundaries exist

- **`backend/payments/` is separate from `backend/services/`** because
  financial logic (state machines, idempotency, gateway verification) has
  different correctness requirements than typical domain services — see
  `FINANCIAL_ARCHITECTURE.md` for the reasoning.
- **Routes are split into `admin/`, `doctor/`, `patient/` subfolders**
  because each role has a materially different set of endpoints and
  authorization requirements, not because of arbitrary organization.
- **`src/api/` mirrors backend domains 1:1** so a frontend engineer can
  find the client for any endpoint by matching domain names, without
  needing to read route files.
- **Wallet recharges are a separate model/state machine from `Payment`**
  (`WalletRecharge`, not reused `Payment` rows) because a wallet top-up
  has no `appointmentId`/`doctorId` and a different lifecycle than an
  appointment payment — forcing it onto the `Payment` schema would have
  meant nullable fields and conditional logic scattered through payment
  code that has nothing to do with wallets.
