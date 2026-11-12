> **Design plan — superseded for day-to-day use by [testing/load-testing.md](testing/load-testing.md).** Retained because `backend/scripts/seed-load-test.mjs` cites it. Audit corrections: the seed manifest directory is **not** git-ignored; the "221/221" figure counts top-level test *files* and was not re-run; §10 data volumes were not re-derived; `rng.mjs` exists but is not described here.

# MediCore HMS — Large-Scale Load-Test Dataset: Plan, Safety Model & Runbook

Status: written **before** implementation (repository analysis complete). Sections 9–11 were completed from real command output after implementation. Tooling lives in `backend/scripts/seed-load-test.mjs`
and `backend/scripts/loadtest/`. `backend/seed.js` (platform bootstrap seed) is **untouched**.

## 1. Model / collection inventory

Seeded (in dependency order): `users` → `doctors` → `appointments` → `payments` → `invoices` →
`doctorpayouts` → `transactionledgers` → `refundrequests` → `medicalnotes` → `prescriptions` →
`reviews` → `notificationdeliveries` → `reminderlogs` → `chatmessages` → `saveddoctors` →
`adminactivitylogs` → `cronrunlogs` → `automationrunlogs`.

Reused, read-only (never duplicated or modified): `Service`, `HospitalSetting`, `FeatureToggle`,
`CMSPage`, `Permission` (bootstrap seed) and `MasterData` (specialization lookup only).

| Model | References |
|---|---|
| User | — (role ∈ `ROLES`) |
| Doctor | `userId`→User (unique), `verifiedBy`→User, optional `specializationMasterId`→MasterData |
| Appointment | `patientId`→User, `doctorId`→**Doctor** (not User), `paymentId`→Payment, `invoiceId`→Invoice |
| Payment | `appointmentId`, `userId`(patient User), `doctorId`(Doctor), `invoiceId` |
| Invoice | `paymentId`, `appointmentId`, `userId`, `doctorId` |
| DoctorPayout | `doctorId`(Doctor), `paymentId` (unique), `appointmentId` |
| TransactionLedger | `userId`, `paymentId` |
| RefundRequest | `paymentId`, `requestedBy`(User), `processedBy`(User) |
| MedicalNote / Prescription | `doctorId`(Doctor), `patientId`(User), `appointmentId` |
| Review | `userId`(patient), `doctorId`(Doctor), `appointmentId` |
| NotificationDelivery / ReminderLog | `recipientId` / `userId`(User), `entityId`→Appointment |
| ChatMessage | `senderId`,`recipientId`(User), `appointmentId` |
| SavedDoctor | `userId`(User), `doctorId`(Doctor) |

## 2. Required fields and important enums (from the live schemas)

- **User**: name, email (unique, lowercase), password (bcrypt via the model's `env.bcryptSaltRounds`
  contract), role ∈ {super_admin, doctor, patient}, `doctorOnboardingStatus` ∈ {not_started, pending, approved, rejected}.
- **Doctor**: userId, specialization, experience (0–70), fees ≥ 0; `verificationStatus` ∈ {not_submitted, pending,
  approved, rejected}; `isVerified`, `isActive`; consultationMode values ∈ {online, offline, home_visit}.
  Public discovery filter (`doctorController`) = `isVerified:true, verificationStatus:"approved", isActive:true`.
  The Doctor `pre("validate")` hook requires an **active doctor** user — bulk writes bypass hooks, so the
  generator enforces this invariant itself and the verifier re-checks it.
- **Appointment**: patientId, doctorId, date, timeSlot; status ∈ `APPOINTMENT_STATUS`; paymentStatus ∈ `PAYMENT_STATUS`;
  `visit.state` ∈ `VISIT_STATE`; `consultationMode` ∈ {online, in_person, home_visit}.
- **Payment**: appointmentId, userId, doctorId, amount, totalAmount, razorpayOrderId; `status`/`paymentState` per
  `paymentStateMachine`; `refundStatus` ∈ {none, pending, partial, full, failed}.
- **Invoice**: invoiceNumber, userId, doctorId, subtotal, totalAmount. **DoctorPayout**: doctorId, paymentId,
  appointmentId, grossAmount, doctorAmount (split from `payments/money.js#allocatePayout`).
- **TransactionLedger**: type, direction, amount. **RefundRequest**: paymentId, requestedBy, amount, reason.
- **Prescription**: doctorId, patientId, appointmentId, diagnosis, ≥1 medicine. **MedicalNote**: doctorId, patientId, appointmentId, notes.
- **Review**: userId, doctorId, appointmentId, rating. **NotificationDelivery**: recipientId, type, title, message.
- **ReminderLog**: userId, entityType, entityId, reminderType, scheduledFor. **ChatMessage**: conversationKey, senderId, recipientId.
- **CronRunLog**: jobName, startedAt. **AutomationRunLog**: triggerType, status, startedAt. **AdminActivityLog**: action, resourceType.

## 3. Unique / partial-index constraints that shape generation

| Index | Generation rule |
|---|---|
| `User.email` unique | deterministic reserved-domain emails `doctor-000001@loadtest.medicore.test` |
| `Doctor.userId` unique | exactly one profile per doctor user |
| `Appointment {doctorId,date,timeSlot}` unique, partial on `ACTIVE_STATUSES` | deterministic slot allocator: one (doctor, day, slot) per appointment, verified before any write; cancelled rows get their own distinct slot too |
| `Appointment.bookingRequestId` unique partial | set to `lt:<ns>:appt:<n>` (also an ownership marker) |
| `Payment.razorpayOrderId` unique | `lt_order_<ns>_<n>` — a plain string, **no gateway order exists** |
| `Payment {appointmentId,activeAppointmentSlot}` unique partial (`true`) | at most one payment per appointment; flag only set for non-terminal payments |
| `Invoice.invoiceNumber`, `Invoice.paymentId` unique | `LT-<NS>-<n>`; one invoice per captured payment |
| `DoctorPayout.paymentId` unique | one payout per captured payment |
| `Prescription.appointmentId` unique partial (`status:"active"`) | at most one active prescription per appointment |
| `Review {userId,appointmentId}` unique | one review per completed appointment |
| `SavedDoctor {userId,doctorId}` unique | deduplicated deterministic pairs |
| `RefundRequest.paymentId` unique partial (pending/approved) | at most one open refund per payment |
| `NotificationDelivery {eventKey,recipientId}`, `ReminderLog.eventKey` unique partial | namespaced `lt:<ns>:…` event keys |
| `ChatMessage {senderId,clientMessageId}` unique partial | namespaced client message IDs |
| `TransactionLedger.idempotencyKey` unique partial | `lt:<ns>:ledger:<n>` |
| `CronRunLog {jobName}` unique partial `status:"running"` | seeded cron logs are never `running` |

## 4. Admin / automation / public queries the data should exercise

Doctor discovery & search (specialization + rating index, verification/active compound index, 2dsphere location);
Admin doctor list/approval queues (pending/rejected/approved mixes); Admin patient lists and activity aggregations;
appointment lists by status/date (`{status,date}` index), doctor day views (`{doctorId,date,visit.state}`), attention queues
(missed/unresolved visits), capacity aggregates; finance aggregates (payment status, refund queue, payout pending/paid,
ledger); notification inbox (`{recipientId,readAt,createdAt}`); reminder scheduler (`scheduledFor`, `status`);
chat conversation paging (`{conversationKey,_id}`); review aggregation per doctor; admin audit-log and cron/automation
run-log listings.

## 5. Volume model

Role counts are **fixed by default** for every profile (10,000 doctor users + 10,000 doctor profiles, 10,000 patient
users, 50 super_admins) and overridable via `--doctors/--patients/--admins`. A profile only changes the related-record
multipliers: appointments per approved-active doctor (`smoke` 2, `standard` 6, `large` 20) and the `--scale` factor.
Doctor state mix (per 100 doctors): 65 approved+active, 5 approved+inactive, 15 pending, 8 rejected, 7 not_submitted
(→ 6,500 approved+active, 500, 1,500, 800, 700). The exact per-collection estimate is printed by `--dry-run` (§10).

## 6. Safety model (enforced in `loadtest/safety.mjs`, unit-tested without a DB)

All of the following must hold before any connection is opened; any failure exits non-zero:

1. `SEED_LOAD_TEST=1`.
2. `NODE_ENV` is not `production`.
3. `MONGO_URI_TEST` set explicitly. The app's `MONGO_URI` is **never** used by the tool.
4. Parsed database name present, not on the denylist (admin, local, config, test, production, prod, staging, stage, live, default,
   hms, medicore, db, database), not production-like (contains a prod/production/live/staging segment), and matching
   `^[a-z0-9][a-z0-9_-]*[_-](loadtest|test)$` — i.e. a real prefix plus `_loadtest`/`_test` (e.g. `medicore_loadtest`, `hms_test`).
5. Host/cluster not production-like (`prod`, `production`, `live`, `staging` segments) and not identical (host + db) to the configured `MONGO_URI`.
6. Host and database name are printed (credentials are never printed) before any write.
7. Writes need `--confirm-load-test-seed`; the **default is `--dry-run`**, which opens no connection at all.
8. `LOAD_TEST_PASSWORD` (≥ 12 chars) required for writes; never printed.
9. Cleanup needs `--run-id <exact id> --confirm-load-test-cleanup`, plus all the gates above.

No `dropDatabase`, `drop`, or `deleteMany({})`. No Razorpay/SMTP/S3/AI imports; the seeder imports only models and the pure `payments/money.js`.

## 7. Ownership model, idempotency and cleanup

Business schemas are not modified. Every seeded document gets a **deterministic ObjectId**:
`4c54` (ASCII "LT") + 4 bytes of `sha1(namespace)` + 2-byte kind code + 4-byte index. The leading timestamp
(`0x4c54xxxx`, 2010) predates the product, so a real document cannot fall in a namespace's `_id` range. Ownership is
therefore provable by `_id` range per collection; users additionally must match `…@<namespace>.medicore.test`.
Writes are `updateOne({_id}, {$set}, {upsert:true})` batches, so reruns repair, never duplicate. Cleanup deletes
`_id ∈ namespace range` (and the email domain for users) per collection — nothing else. Models with no reliable ownership are never cleaned automatically.

## 8. Financial & automation scenarios — what is safe, what is not

Constructed (internally consistent, no provider call): captured/completed Payment (+Invoice +DoctorPayout using
`allocatePayout` + ledger `payment` row whose amount equals `totalAmount`); pending/created Payment with active slot;
failed Payment (slot released); cancelled-after-payment with RefundRequest pending or processed (Payment
`refundStatus` + `refundedAmount` agree); DoctorPayout pending/paid; read/unread notifications; reminder rows
pending/sent/failed/skipped; cron and automation run logs (never `running`, never referencing a real flow).

**Out of scope (documented, not faked):** Wallet balances/holds, WalletRecharge, WalletReservation, Withdrawal and
withdrawal gates, Subscription, ReconciliationRecord (need reservation/gate invariants best produced by the real services),
MedicalReport (requires stored file objects), Doctor `documents` (no files exist; seeded *pending* doctors therefore
cannot pass the real approval document guard — intentional), real PDF invoices/prescription PDFs, emails/outbox rows,
AutomationFlow/ProcessDefinition authoring, any gateway webhook or payout.

## 9. Runbook

Environment (never the application `MONGO_URI`):

```bash
export SEED_LOAD_TEST=1
export MONGO_URI_TEST='mongodb://<host>/medicore_loadtest'   # disposable DB only; name must end _loadtest/_test
export LOAD_TEST_PASSWORD='<>=12 chars, test-only>'          # required for writes; never printed
cd backend
```

| Purpose | Command (from `backend/`) |
|---|---|
| Plan only (default, no connection, no writes) | `npm run seed:loadtest -- --dry-run` |
| Smaller related volume | `npm run seed:loadtest -- --dry-run --profile smoke` |
| **Write** (all gates must pass) | `npm run seed:loadtest -- --confirm-load-test-seed --anchor-date 2026-10-23` |
| Write + explicitly build schema indexes in the test DB | `npm run seed:loadtest -- --confirm-load-test-seed --ensure-indexes` |
| Read-only verification + index report + explain samples | `npm run seed:loadtest:verify` (`--skip-timings`, `--json`) |
| Report what cleanup would remove | `npm run seed:loadtest:cleanup -- --run-id loadtest` |
| Scoped cleanup | `npm run seed:loadtest:cleanup -- --run-id loadtest --confirm-load-test-cleanup` |

Notes: pass the **same** `--profile/--scale/--seed/--anchor-date/--doctors/--patients/--admins` to `verify` as to the write,
because expected counts are recomputed deterministically (a manifest in `scripts/loadtest/.manifests/`, git-ignored, also records
non-namespace document counts right after seeding). Reruns with the same anchor are no-ops ("unchanged"); a different anchor
re-dates appointments, and slot conflicts that arise mid-batch are retried (and abort loudly, deleting nothing, if a foreign
document owns a unique key). Indexes are **never** created implicitly (`autoIndex`/`autoCreate` are off); use `--ensure-indexes`
on the test DB only, or `npm run migrate:indexes` against it deliberately.

Performance analysis: after seeding, run `npm run seed:loadtest:verify`. It prints `explain("executionStats")` samples (public
doctor search/discovery, admin pending-doctor queue, appointment status+date list, doctor day view, payments by status, refund
queue, pending payouts, notification inbox, reminder scheduler) with keys/docs examined and COLLSCAN detection. These are
**local test observations, not production guarantees.** Point the Admin UI / API at the test DB (set the app's own `MONGO_URI`
to the same disposable DB in a separate shell) and log in with e.g. `admin-000001@loadtest.medicore.test` + `LOAD_TEST_PASSWORD`.

## 10. Planned volumes (real `--dry-run` output, standard profile, anchor 2026-10-23)

users 20,050 (50 super_admin + 10,000 doctor + 10,000 patient) · doctors 10,000 · appointments 39,000 · payments 33,715 ·
invoices 30,305 · doctorpayouts 30,305 · transactionledgers 31,792 · refundrequests 2,273 · medicalnotes 15,223 ·
prescriptions 11,084 · reviews 3,835 · notificationdeliveries 124,939 · reminderlogs 28,913 · chatmessages 33,862 ·
saveddoctors 19,883 · adminactivitylogs 2,000 · cronrunlogs 400 · automationrunlogs 1,000 — **≈ 438,579 documents**, 0 slot collisions.
Doctor mix 6,500 / 500 / 1,500 / 800 / 700 (approved+active / approved+inactive / pending / rejected / not_submitted). Appointment
dates span −150…+28 days (13,169 in 91–150d past, 12,914 in 31–90d, 6,585 in the last 30d, 252 today, 1,519 in the next 7d, 4,561 in 8–28d).
Login-capable accounts: 50 super_admin, 9,500 doctors (500 deactivated), 9,809 patients (191 deactivated). The `large` profile (20 appointments per approved doctor) is ≈ 1.4 M documents.

## 11. Verification status and limitations (honest)

- **DB-free tests (pass):** `tests/loadTestSeederSafety.test.mjs`, `tests/loadTestSeederGeneration.test.mjs` — production/unsafe-target refusal,
  dry-run opens no connection, cleanup scoping, determinism, exact default counts, reserved-domain emails, schema validity of every generated
  document type (`validateSync`), relationship/financial/slot invariants, deterministic idempotent upsert logic via fake models, whole-`runSeed`
  orchestration via fake models, no provider import reachable, `seed.js` untouched. Full backend suite: 221/221 pass; root `eslint .` clean; `vite build` OK.
- **NOT verified — no live MongoDB:** no `mongod` exists in the sandbox and `mongodb-memory-server` cannot download its binary (`fastdl.mongodb.org`
  unreachable). The write path, `$lookup` verifier aggregations, index report, `explain` timings and cleanup deletes have therefore **never been executed
  against a real server**. Treat the first run against a disposable DB as the integration test (`--profile smoke --doctors 200 --patients 120 --admins 3` first).
- Bulk writes bypass Mongoose `pre`-hooks (e.g. Doctor's active-user check); the generator enforces and the verifier re-checks those invariants.
- One bcrypt hash is shared by all synthetic users (same password); reused on rerun if the password is unchanged.
- Seeded *pending* doctors have no uploaded documents and cannot pass the real approval document guard; wallet/withdrawal/subscription/reconciliation/medical-report
  scenarios and PDFs are not seeded (§8). `doctor_earning`/`platform_fee` ledger rows are not created because the app's capture path does not create them either.
- Dates are relative to `--anchor-date` (default: today UTC); statuses for "today" are assigned independently of wall-clock time.
- The tool refuses bare `MONGO_URI` and same-as-app detection only compares host(s)+database; it cannot know that an arbitrary hostname is production.

## 12. Quick start for local testing
1. `cp backend/.env.loadtest.example` values into your shell (`export ...`) and point `MONGO_URI_TEST` at a disposable local MongoDB.
2. `cd backend && npm run seed:loadtest -- --dry-run` (review counts), then
   `npm run seed:loadtest -- --confirm-load-test-seed --ensure-indexes --anchor-date <today>`.
3. `npm run seed:loadtest:verify` for integrity checks, distributions, index report and query plans.
4. To browse the data in the app, start the backend in a separate shell with `MONGO_URI` set to the same disposable DB; log in as
   `admin-000001@loadtest.medicore.test`, `doctor-000001@loadtest.medicore.test` (approved/active) or `patient-000001@loadtest.medicore.test`
   with `LOAD_TEST_PASSWORD`.
5. `npm run seed:loadtest:cleanup -- --run-id loadtest --confirm-load-test-cleanup` removes only this run's records.
