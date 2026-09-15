# System Design

How requests and data actually move through MediCore HMS. For the static
structure (what lives where), see [`ARCHITECTURE.md`](ARCHITECTURE.md).
For the financial flows in full depth, see
[`FINANCIAL_ARCHITECTURE.md`](FINANCIAL_ARCHITECTURE.md) — the summaries
below are intentionally short.

## Generic request flow

```
User action
    ↓
React page (src/pages/...)
    ↓
API client (src/api/...Api.js)
    ↓
Express route (backend/routes/...)
    ↓
Middleware (auth → role/permission → rate limit)
    ↓
Controller (backend/controllers/...)
    ↓
Domain service (backend/services/... or backend/payments/...)
    ↓
Mongoose model (backend/models/...)
    ↓
MongoDB
    ↓
Response (JSON)
    ↓
UI state update
```

Every write that changes money, appointment status, or account state goes
through this same shape — the difference for financial writes is what
happens between "Controller" and "Mongoose model": an explicit state-machine
check and (for anything gateway-related) a provider-status call, described
below and in full in `FINANCIAL_ARCHITECTURE.md`.

## Payment flow (appointment payment)

```
Patient
   ↓
Appointment (created, awaiting payment)
   ↓
Payment (created)
   ↓
PaymentAttempt (created per attempt — an appointment payment can have
   more than one attempt if earlier ones failed)
   ↓
Razorpay checkout (or test gateway, depending on PAYMENT_GATEWAY_MODE)
   ↓
Verification: signature check + authoritative fetch of the payment's
   status from the gateway (not signature alone)
   ↓
Financial state update (Payment/PaymentAttempt marked success only on a
   gateway-confirmed captured state; otherwise failed/pending, never
   silently assumed)
   ↓
TransactionLedger entry
   ↓
Doctor payout eligibility updated
```

## Refund flow

```
Patient (or admin) initiates refund
   ↓
Refund eligibility check (policy: cancellation window, appointment state)
   ↓
Refund request created — reason derived server-side from a validated
   reasonCode (the client never supplies the canonical reason text
   directly; see FINANCIAL_ARCHITECTURE.md)
   ↓
Policy evaluation (refund policy engine)
   ↓
Approval / rejection (admin action, or auto-approval where policy allows)
   ↓
Funding allocation: gateway-funded, wallet-funded, or mixed
   ↓
Gateway refund call / wallet credit
   ↓
TransactionLedger entry
   ↓
Doctor liability adjustment (if the doctor had already been paid out)
   ↓
Reconciliation
```

Every transition above is checked against `refundStateMachine.js` — admin
actions cannot skip a state or record a fabricated predecessor state (this
was a real bug found and fixed in the P23 phase; see
`CHANGELOG-P23-FAKE-SUCCESS-ELIMINATION.md` at the repo root).

## Wallet recharge flow

```
Patient initiates recharge
   ↓
WalletRecharge (state: created)
   ↓
Gateway order created (state: order_created)
   ↓
Checkout started (state: checkout_started)
   ↓
   ├─ Dismissed by user → cancelled (order preserved, never credited)
   ├─ Provider reports failure → failed
   └─ Checkout completes → pending → verification_pending
                                          ↓
                          Authoritative provider-status check
                          (fetch the payment from the gateway — a valid
                          signature alone is NOT treated as proof of
                          capture)
                                          ↓
                              ┌───────────┴───────────┐
                          Not captured              Captured
                              ↓                          ↓
                      failed / still pending /   Atomic, idempotent
                      reconciliation_required     posting (findOneAndUpdate
                                                   mutex + unique ledger
                                                   idempotency key)
                                                        ↓
                                                  Wallet credited
                                                        ↓
                                                  TransactionLedger entry
                                                        ↓
                                                     posted
```

This lifecycle exists specifically because an earlier version of this flow
credited the wallet on signature verification alone — a real "fake
success" bug. See `FINANCIAL_ARCHITECTURE.md` for why signature ≠ capture,
and the P23 changelog for the fix.

## Realtime flow (chat / notifications / presence)

```
Client connects (Socket.IO) → socketAuth.js verifies JWT
    ↓
roomManager.js joins the client to relevant rooms (per-user, per-role)
    ↓
Client emits event → eventHandlers.js (wrapped by asyncSocketHandler.js
    so a handler error can't crash the socket server)
    ↓
presenceManager.js tracks online/offline state (in-process — see
    docs/REMAINING_RISKS.md for the single-instance limitation)
    ↓
Server emits back to relevant room(s) / persists a NotificationDelivery
    record for offline recipients
```

## Deployment-time flow

```
Browser
 ↓
Nginx (static frontend build, from Dockerfile) or Vite dev server locally
 ↓
Express API (backend, its own container/process)
 ↓
MongoDB
```

See `docs/DEPLOYMENT_GUIDE.md` for the full Docker Compose topology,
environment variables, and health-check endpoints.
