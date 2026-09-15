# MediCore HMS

Full-stack healthcare management platform.

React + Vite · Node.js + Express · MongoDB + Mongoose · Socket.IO ·
Razorpay integration

MediCore HMS is built around three connected workflows: patients
discovering and booking care, doctors and admins running clinical and
operational work, and a financial layer (payments, wallet, refunds,
payouts) that tracks money movement as its own domain rather than a
success/failure flag on an appointment. It is under active development —
see [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) for exactly what's
implemented, partially implemented, or still planned, and
[`docs/REMAINING_RISKS.md`](docs/REMAINING_RISKS.md) for known gaps. This
is not a description of a deployed production service — it's the current
state of the codebase.

## What is MediCore HMS?

A full-stack healthcare management platform connecting patients, doctors,
and administrative/financial operations through one codebase:

- **Patients** discover doctors, book appointments, pay, manage a wallet,
  request refunds, and view invoices/records.
- **Doctors** manage their profile, schedule, appointments, a clinical
  workspace, reviews, earnings, and payouts.
- **Admins** manage doctors/patients/appointments, finance operations
  (payments, refunds, payouts), leads, CMS content, and platform
  monitoring.
- **Financial operations** — payments, payment attempts, wallet,
  wallet recharges, refunds, doctor payouts, withdrawals, and a
  transaction ledger — are modeled as their own domain with explicit
  state machines. See
  [`docs/FINANCIAL_ARCHITECTURE.md`](docs/FINANCIAL_ARCHITECTURE.md).

## Why this project is architected the way it is

1. **Domain-oriented backend, not one giant CRUD layer.** Routes,
   controllers, and services are organized by real workflow area (public
   discovery, clinical, finance, realtime, admin operations) rather than
   one flat `/api` surface.
2. **Role-aware experience.** Patient, doctor, and admin flows are
   separated by both UI routing and backend authorization middleware
   (`backend/middleware/authMiddleware.js`, `roleMiddleware.js`,
   `adminMiddleware.js`) — not just hidden menu items.
3. **Financial correctness over a simple success flag.** A payment or
   wallet recharge is only ever marked successful after a server-side
   check against the payment gateway's own authoritative state — not on
   a client callback or a signature check alone. Pending, failed, and
   cancelled are distinct, real states with recovery paths. See
   `docs/FINANCIAL_ARCHITECTURE.md`.
4. **Recovery-aware financial workflows.** A dismissed checkout, a
   declined payment, or a dropped network call has an explicit state and
   a recovery action (e.g. "check status") rather than silently becoming
   a false success or a stuck limbo record.
5. **Server-side financial authority.** Amount, currency, ownership, and
   provider-reference validation happen in the backend, with idempotency
   and duplicate-webhook protection — the client proposes, the server
   decides.
6. **Shared infrastructure across modules.** API clients (`src/api/`),
   layout, auth context, and backend cross-cutting middleware are reused
   across the patient/doctor/admin surfaces rather than duplicated per
   role.

These are architectural properties actually reflected in the current
code, not aspirational claims — see `docs/FINANCIAL_ARCHITECTURE.md` and
the P23-phase changelogs (root `CHANGELOG-P23-*.md` files) for the
specific bugs this caught and fixed.

## User journeys

**Patient**
```
Discover Doctor → View Profile → Select Slot → Book Appointment
    → Payment → Consultation → History / Invoice / Refund
```

**Doctor**
```
Onboarding → Verification → Professional Profile → Practice
    → Appointments → Clinical Workflow → Earnings → Payout → Withdrawal
```

**Admin**
```
Operations → Patients / Doctors / Appointments → Finance
    → Payments / Refunds / Payouts → Reconciliation / Monitoring
```

## Technology stack

Confirmed against `package.json` / `backend/package.json`:

**Frontend:** React, Vite, Tailwind CSS (via `@tailwindcss/vite`), React
Router, Axios, Framer Motion, Leaflet / React Leaflet (used by the doctor
coverage-area map), Socket.IO Client.

**Backend:** Node.js, Express, Mongoose/MongoDB, Socket.IO, JWT
(`jsonwebtoken`) + `bcrypt` for auth, `helmet` + `express-rate-limit` for
hardening, Razorpay SDK (behind a gateway adapter — see below), Brevo's
HTTP API for transactional email/OTP delivery, `pdfkit` for invoice/PDF
generation, `multer` for file uploads.

**Payment gateway note:** the backend selects between a real Razorpay
adapter and an in-repo `testGateway` based on `PAYMENT_GATEWAY_MODE`
(`backend/payments/paymentGateway.js`). Local development and this
project's automated tests run against the test gateway; verifying the
real Razorpay path requires a live Razorpay sandbox account, which was not
available in this environment (see `docs/REMAINING_RISKS.md`).

## Repository structure

```
.
├── backend/
│   ├── controllers/    # ~56 files, grouped by domain (admin/, doctor/, patient/, root)
│   ├── models/          # ~50 Mongoose models
│   ├── routes/          # ~51 route files
│   ├── services/        # ~30 domain/service modules
│   ├── payments/        # financial state machines, gateway adapter, reconciliation
│   ├── socket/           # Socket.IO server, auth, presence, event handlers
│   ├── middleware/
│   └── tests/            # ~96 test files (node's built-in test runner via a custom runner)
│
├── src/
│   ├── pages/            # ~97 files, grouped by admin/doctor/patient/public/auth/...
│   ├── components/       # ~107 files, grouped by domain
│   ├── api/              # ~30 API client modules, one per backend domain
│   ├── context/
│   ├── layout/
│   ├── socket/
│   └── utils/
│
├── shared/                # code shared between frontend build and backend (e.g. legal text)
├── docs/                  # see docs/README.md for the index
├── scripts/
├── Dockerfile              # frontend production image (build + nginx)
├── backend/Dockerfile      # backend production image
├── docker-compose.yml
├── nginx.conf
└── package.json
```

Directory counts above were verified against the live repository at the
time of writing; re-check with `find backend/<dir> -type f | wc -l` etc.
if it's been a while, since they will drift as the codebase grows.

## Local development

Requirements: Node.js 20+, a local or remote MongoDB instance.

```bash
# Frontend
npm install
cp .env.example .env          # set VITE-facing values as needed
npm run dev                    # http://localhost:5173

# Backend (separate terminal)
cd backend
npm install
cp .env.example .env           # set MONGO_URI, JWT_SECRET, etc.
npm run dev                     # http://localhost:5000
```

Key environment variables (see `.env.example` / `backend/.env.example`
for the full, current list — do not copy example values into a real
deployment):

- `MONGO_URI` — MongoDB connection string.
- `JWT_SECRET` — signing secret for auth tokens.
- `PAYMENT_GATEWAY_MODE` — `test` uses the in-repo test gateway;
  production Razorpay credentials are required for the real path.
- `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` — required
  for transactional email/OTP delivery to actually send.
- `CORS_ORIGIN`, `FRONTEND_URL` — required for the frontend/backend to
  talk to each other correctly outside of matched local defaults.

Full deployment instructions (Docker Compose, backups, CI) are in
[`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md).

## Documentation

Start with [`docs/README.md`](docs/README.md) — the documentation index.
Directly useful entry points:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture
- [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) — request/data flow
- [`docs/FINANCIAL_ARCHITECTURE.md`](docs/FINANCIAL_ARCHITECTURE.md) —
  payments/wallet/refunds/payouts in depth
- [`docs/FEATURES.md`](docs/FEATURES.md) — current feature map
- [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) — current status
- [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) — running it
- [`docs/REMAINING_RISKS.md`](docs/REMAINING_RISKS.md) — known gaps
- [`SECURITY.md`](SECURITY.md) — reporting a vulnerability
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to contribute

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Changes touching payments,
wallet, refunds, or payouts get extra review — see that file's financial
review checklist.

## License

MIT — see [`license`](license).
