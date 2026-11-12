# Scheduled Jobs and Background Processing

> **Status: rewritten from code during the documentation audit.** The platform-side scheduler configuration (Render Cron Jobs, a worker service, or any external cron) is **not verified in this environment** — this repository ships only an *example* (`render.yaml.example`) and nothing was deployed or run here. Pinned by `backend/tests/automationCronEntrypoint.test.mjs`, which reads this file: keep the command list and the phrases "partial unique index" and "not verified in this environment" when editing.

## 1. Two execution paths

| Path | Where | Jobs |
|---|---|---|
| **In-process financial scheduler** | `backend/cron/financialScheduler.js`, started by `backend/worker.js` (`SERVICE_ROLE=worker`) or by `backend/server.js` when allowed | 7 financial/appointment jobs on fixed intervals (table below) |
| **Standalone command line** | Each job file ends with a `process.argv[1]?.endsWith("<file>.js")` entrypoint | Any job can be launched by an external scheduler, plus `automation/cronJobs.js` (reminders/insights) |

`automation/cronJobs.js` is **not** part of `FINANCIAL_JOBS`; the reminder and automation sub-jobs need an external scheduler (or manual run).

### Who runs the scheduler (`shouldRunScheduler`, `backend/config/productionGuards.js`)
- `SERVICE_ROLE=web` → never. `SERVICE_ROLE=worker` → always.
- `SERVICE_ROLE=all` → governed by `ENABLE_IN_PROCESS_SCHEDULER` (`0/false/no` off; any other value on). Unset: on in development/test, but production validation demands it be set explicitly.
- Deploy exactly one worker next to any number of web replicas. See [deployment guide](deployment/deployment-guide.md).

## 2. In-process jobs (`FINANCIAL_JOBS`)

| Job | Interval |
|---|---|
| `processEmailOutbox` | 1 min |
| `expirePaymentWindows` | 1 min |
| `recoverPaymentEvents` | 1 min |
| `retryFailedPayments` | 5 min |
| `appointmentLifecycleSweep` | 5 min |
| `reconciliation` | 15 min |
| `subscriptionRenewals` | 60 min |

## 3. Standalone commands (external scheduling)
Run from `backend/`. The schedules are this document's *suggestions for an external scheduler*; they differ from the in-process intervals above and are not enforced by code.

| Job | Command | Suggested cadence | Purpose |
|---|---|---|---|
| Expire stale payment windows | `node cron/expirePaymentWindows.js` | every 5 minutes | Cancels appointments left in `payment_pending` past their payment window |
| Process durable email outbox | `node cron/processEmailOutbox.js` | every 1–2 minutes | Claims queued/retrying `EmailDelivery` rows and sends them |
| Payment/refund/payout reconciliation | `node cron/reconciliationCron.js` | every 15 minutes | Cross-checks payment state against the gateway |
| Retry failed payments | `node cron/retryFailedPayments.js` | every 15 minutes | Retries payments eligible for retry |
| Subscription renewals | `node cron/subscriptionRenewals.js` | daily | Renews doctor subscriptions that are due |
| Reminders, AI insights, assignment sweep | `node automation/cronJobs.js` | every 10–15 minutes | Runs the automation sub-jobs (`automation/*Reminder.js`, etc.) |

Also with CLI entrypoints: `cron/appointmentLifecycleSweep.js`, `cron/recoverPaymentEvents.js`.

## 4. Locking and overlap protection
`backend/utils/cronRunTracker.js` (`trackRun`) records each run in `CronRunLog` using a **lease with fencing**: every running row carries `ownerToken` and `leaseExpiresAt`; the holder heartbeats; heartbeat/complete/release are conditioned on `{_id, ownerToken, status: "running"}`, so a stale holder cannot overwrite a newer one. MongoDB enforces "one running row per job" with a **partial unique index** (`uniq_cronrun_running_per_job`, `partialFilterExpression: { status: "running" }`) on `CronRunLog`. Rows written before leases existed fall back to legacy handling (see the file's header comment). On startup the scheduler verifies this index exists (`verifyLockIndex`) and graceful shutdown waits for running jobs, fencing any that remain.

## 5. Not verified
- Behaviour under real multi-instance load, and whether any deployed environment runs the worker, are **not verified in this environment**.
- No job was executed during this audit.
