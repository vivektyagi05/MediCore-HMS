# Production Financial Verification

Status of every item: **NOT VERIFIED** unless stated. This slice was built in a sandbox with no MongoDB, no Razorpay sandbox credentials and no deployed environment, so no runtime evidence exists. No secret values appear here.

| Item | Status | How to verify |
|---|---|---|
| NODE_ENV=production on the host | NOT VERIFIED | check platform env; `config/env.js` already refuses `PAYMENT_GATEWAY_MODE=test` in production (read in code, not run) |
| PAYMENT_GATEWAY_MODE=razorpay | NOT VERIFIED | `GET` any order creation response `gateway` field |
| Mongo transaction/replica-set support | NOT VERIFIED | `db.hello()` shows `setName`; design does not depend on it |
| Real-Mongo concurrency suite | NOT RUN | `MONGODB_TEST_URI=... npm run test:mongo` in `backend/` |
| Migration 009 (invoice uniqueness) | NOT RUN | `npm run migrate:invoice-uniqueness`; exits 2 and builds nothing if duplicates exist |
| Migration 010 report (unpaid active subscriptions) | NOT RUN | `npm run report:unpaid-subscriptions` (read-only) |
| Razorpay webhook endpoint + signature | NOT VERIFIED | Razorpay dashboard test delivery; HMAC check exists in `webhookHandler.js` |
| Scheduler registration and execution | NOT VERIFIED | set `ENABLE_IN_PROCESS_SCHEDULER=true` on exactly one instance (or run each `cron/*.js` from external cron); confirm rows in `CronRunLog` |
| Email outbox actually sending | NOT VERIFIED | needs Brevo key; check `EmailDelivery` rows reach `sent` |
| Invoice/document storage persistence | NOT VERIFIED | production must use `STORAGE_DRIVER=s3`; local disk is not durable on ephemeral hosts. Generate, download, restart, download again |
| CORS / frontend API URL / security headers | NOT VERIFIED | inspect deployed config |
| Withdrawal gate drift | NOT RUN | `GET /api/admin/withdrawals/reconcile/:doctorId` per doctor |
| Wallet vs ledger drift | NOT RUN | `POST /api/admin/finance/reconciliation/wallets` (cursor: `?afterId=`) |
| Real-Mongo suite incl. withdrawal concurrency | NOT RUN | `MONGODB_TEST_URI=... npm run test:mongo` |
