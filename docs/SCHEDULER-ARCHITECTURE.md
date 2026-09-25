# Scheduler Architecture

## Design

MediCore HMS uses **externally-triggered, standalone Node processes** as its
scheduler architecture — not an in-process timer (`setInterval`/`setTimeout`),
not node-cron, not a queue worker. Each job is a short-lived script that:

1. connects to MongoDB,
2. does its work through `utils/cronRunTracker.js#trackRun(jobName, fn)`,
3. exits with code `0` on success (including a *skipped* run — see Locking
   below) or `1` on failure.

Something outside the Node process — Render's own Cron Job feature, a
Kubernetes CronJob, or plain OS `crontab` — is responsible for actually
invoking these scripts on a schedule. This repository does not commit a
`render.yaml` (or equivalent) defining those schedules; the table below is
what each Cron Job / crontab entry should be configured to run.

## Job inventory

| Job | Command | Suggested schedule | What it does |
|---|---|---|---|
| Expire stale payment windows | `node cron/expirePaymentWindows.js` | every 5 minutes | Cancels appointments left in `payment_pending` past their payment window. |
| Payment/refund/payout reconciliation | `node cron/reconciliationCron.js` | every 15 minutes | Cross-checks payment state against Razorpay, repairs incomplete payments where safe. |
| Retry failed payments | `node cron/retryFailedPayments.js` | every 15 minutes | Retries payments eligible for a retry attempt. |
| Subscription renewals | `node cron/subscriptionRenewals.js` | daily, once (e.g. 02:00 UTC) | Renews doctor subscriptions whose `nextBillingAt` has passed. |
| Reminders, AI insights, assignment sweep | `node automation/cronJobs.js` | every 10–15 minutes | Runs all 8 automation sub-jobs (appointment/payment/follow-up/insurance-expiry/prescription-renewal/missed-follow-up reminders, AI insights, smart assignment sweep) independently — one failing does not block the others. |

Before this fix, `automation/cronJobs.js` had **no standalone entrypoint at
all** — it could only be invoked through the admin "run now" API
(`triggeredBy: "on-demand-api"`). Every reminder and the assignment sweep
therefore never ran unless an admin manually clicked a button. It now has
the same `if (process.argv[1]?.endsWith(...))` CLI entrypoint as the other
four scripts, so it can be scheduled the same way.

The admin on-demand API (`POST /api/admin/automation/run/:key`) remains
available for an admin to force an immediate run of any single sub-job; it
goes through the exact same `trackRun()` call and is therefore subject to
the same locking as a scheduled run.

## Locking (preventing duplicate execution)

Render Cron Jobs (and most schedulers) can, in principle, overlap — a slow
run that hasn't finished by the time the next scheduled invocation fires, or
a manual on-demand run overlapping a scheduled one. Before this fix there
was **no locking at all**: two overlapping invocations of the same job would
both run in full (e.g. two overlapping subscription-renewal runs could both
try to renew the same subscription).

`models/CronRunLog.js` now has a **partial unique index**:

```js
cronRunLogSchema.index(
  { jobName: 1 },
  { unique: true, partialFilterExpression: { status: "running" } },
);
```

MongoDB itself enforces that at most one `"running"` row can exist per
`jobName` at any time. `utils/cronRunTracker.js#trackRun()`:

1. Tries to insert a `"running"` row for the job.
2. If that insert fails with a duplicate-key error, another process holds
   the lock. `trackRun()` checks that holder's age:
   - **fresh** (younger than 30 minutes) → this run is skipped; it resolves
     with `{ skipped: true, reason: "already-running", jobName }` rather
     than throwing, so a standalone script's `.then(() => process.exit(0))`
     exits cleanly with no error.
   - **stale** (older than 30 minutes with no `finishedAt`) → almost
     certainly a process that crashed mid-run. The stale row is marked
     `"timed_out"` and the lock is reclaimed so a crashed process can never
     block the job forever.
3. On completion (success or failure) the row is updated and the lock is
   released immediately — a genuine failure never leaves a stale lock
   sitting around for 30 minutes.

This is a real database-level lock, not a check-then-act race in application
code: the uniqueness guarantee comes from the MongoDB index, so it holds
even across multiple backend instances.

## Idempotency

Each job's own business logic is expected to be idempotent independent of
the lock (the lock prevents *concurrent* duplicate runs; idempotency is what
makes a *sequential* rerun after a crash safe):

- `expirePaymentWindows` / `reconciliationCron` / `retryFailedPayments` only
  ever act on payments/appointments still in the specific state they target
  (e.g. `payment_pending` past its window); once moved out of that state, a
  rerun finds nothing to do.
- `subscriptionRenewals` only processes subscriptions whose `nextBillingAt`
  is still due; a renewed subscription's `nextBillingAt` moves forward
  before the job considers it again.
- Reminder jobs (`automation/cronJobs.js`) each write a `ReminderLog` /
  equivalent marker before sending, and check for that marker first, so a
  rerun does not re-send a reminder that already went out.

## Observability

`utils/cronRunTracker.js#getLatestRunPerJob()` returns the most recent run
(status, timing, summary, error) for every distinct `jobName` that has ever
run, including `"skipped"`-style runs surfaced via `{ skipped: true }`
results and `"timed_out"` reclaimed locks. This backs the Platform Health
Center's job-status view — an admin can see, per job, whether the last run
succeeded, failed, or is stuck.

## Not implemented / explicitly out of scope

- **No in-process fallback.** If nothing external ever invokes these
  scripts, nothing runs. This architecture depends entirely on the hosting
  platform's own Cron Job / crontab feature being configured per the table
  above; that platform-side configuration is not part of this repository
  and is **not verified in this environment** (no Render account access
  here).
- **No cross-job dependency ordering.** Each job is independent; none of
  them wait for another to finish first.
- **No queue/worker system.** Retries within a job are the job's own
  business logic (e.g. `paymentRetryService`), not a generic job-queue
  retry mechanism.
