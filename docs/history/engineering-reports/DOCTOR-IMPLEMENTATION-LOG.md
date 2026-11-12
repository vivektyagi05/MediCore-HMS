> **Historical record.** Preserved as written; it describes the repository at the time of writing and was not re-verified against the current code. For the current verified position see [PROJECT_STATUS](../../PROJECT_STATUS.md) and [REMAINING_RISKS](../../REMAINING_RISKS.md).

# MediCore HMS — Doctor-side implementation log

Phase started 2026-10-22 on the tree from `MediCore-HMS-ADMIN-FINAL-2026-10-22.zip` (+ Admin Round 3 changes).
**Admin is treated as frozen by user decision. It is NOT independently proven complete** (see `docs/history/engineering-reports/ADMIN-IMPLEMENTATION-LOG.md`, Round 3 "gate NOT SATISFIED").

Evidence levels used below: **Source** = read the code only · **Unit** = automated test without a database · **Integration** = against real MongoDB · **Browser** = real UI. Only Source and Unit evidence exists so far; Integration and Browser are NOT RUN (see "Environment").

## Status: IN PROGRESS — Doctor side is NOT complete. Slice D1 done; most workflows not yet reviewed.

## Environment limits (checked, not assumed)
- No MongoDB: `mongodb-memory-server` is installed but its `mongod` download (`fastdl.mongodb.org`) is blocked by the sandbox network allowlist (attempted 2026-10-22, failed). No `MONGO_URI_TEST` is configured. => `npm run test:mongo` NOT RUN; no controller was executed end to end.
- No browser / E2E tooling run. No production data touched. Nothing committed or pushed.

## Coverage map (backend → guard → controller). "Reviewed" = Source level unless stated
| Workflow | Endpoint(s) | Guard (verified in route file) | Review |
|---|---|---|---|
| Prescriptions CRUD/PDF | `GET/POST /api/doctor/prescriptions`, `PUT /:id`, `GET /:id/download`, `POST /check` | `authorizeRoles(DOCTOR)` + `requireApprovedDoctor` | create/update **fixed (D-02..D-04)**; list/download Source-reviewed (doctorId-scoped) |
| Medical notes / history | `GET/POST /notes`, `GET /history` | approved doctor | NOT YET reviewed |
| Schedule / templates | `GET/PUT /schedule`, `/schedule/day`, `/schedule/range`, `/schedule/templates*` | approved doctor | NOT YET reviewed |
| Follow-up scheduling | `POST /patients/:patientId/schedule-follow-up` | approved doctor | NOT YET reviewed (high priority: client-supplied patientId) |
| Leaves | `GET /leaves` (doctor, super_admin), `POST /leaves` (doctor), `PUT /leaves/:id/status` (super_admin only) | role only | NOT YET reviewed |
| Credential documents | `/documents*` | `authorizeRoles(DOCTOR)` only (no approval requirement; plausibly intended for onboarding — to confirm) | NOT YET reviewed |
| Patient clinical profile / reports | `GET /patients/:patientId/clinical-profile`, `/reports`, `/reports/:id/download`, `PATCH .../review` | approved doctor + `services/clinicalAccessService` | policy module Source-reviewed (see below); each handler NOT YET read |
| Certificates | `/certificates*` | approved doctor | NOT YET reviewed |
| Medicine templates / favourites | `/medicine-templates*`, `/favourite-medicines*` | approved doctor | NOT YET reviewed |
| Analytics / exports | `GET /analytics`, `GET /exports` | approved doctor | NOT YET reviewed |
| Practice, profile, subscription | `/api/doctor/practice/*` | `protect` + `authorizeRoles(DOCTOR)` | NOT YET reviewed |
| Command center | `GET /command-center`, `PATCH /reports/:id/reviewed` | `approvedDoctorOnly` | NOT YET reviewed |
| Onboarding | `/api/doctor/onboarding` | `protect` + DOCTOR | NOT YET reviewed |
| Appointments (shared router) | `GET /`, `GET /:id`, `PUT /:id/status`, `PATCH /:id/cancel`, `/:id/reschedule`, `POST /:id/call`, `/no-show`, `/resolve`, `GET /doctor/today-clinic`, `/summary`, `/:id/actions` | `protect` + role lists (verified in route file) | **state transitions & per-doctor scoping NOT YET reviewed (high priority)**; list query hardened (D-01) |
| Doctor earnings/withdrawals/reviews | `/api/doctors/withdrawals|payouts|earnings|refund-reviews|reviews|patients` | under the public `/api/doctors` router | NOT YET reviewed |
| Realtime / chat | `socket/*`, `services/chat/*` | — | policy header of `clinicalAccessService` read only |
| Frontend doctor pages/route guards | `src/routes`, `src/pages/doctor/*` | — | only API-call shapes scanned (for D-01); guards NOT YET reviewed |

Central policy `services/clinicalAccessService.js` (first 200 lines read): record access requires an approved+active doctor, an active patient, an appointment in a paid clinical status, and the specific record shared with that doctor; chat uses one `resolveChatAccess` policy. Only one non-central doctor↔patient check remains in doctor controllers (`workflowController.js:1091`, `Appointment.exists({_id, doctorId, patientId})`) — NOT YET reviewed.

## Findings
| ID | Sev | Status | Summary |
|---|---|---|---|
| D-01 | Medium | **Fixed** (Unit) | `sanitizeRequest` cleaned only `req.body`/`req.params`; `req.query` reached doctor filters raw (`?patientId[$ne]=x`, `?search[]=a` → operator in a Mongo filter or `.trim is not a function` 500, e.g. `appointmentController.js` search). Scoping by `doctorId` kept this from being a cross-doctor leak in the cases read. Fix: mount the existing `rejectRepeatedQuery` on `/api/doctor` and `/api/appointments` (400 on any array/object value). Frontend check: the shared appointment list and doctor clients send comma-joined strings (`status=a,b,c`), never repeated/bracketed keys — **static scan, not browser-verified**. Behaviour change: such requests now get 400 instead of 500/odd results, including for patient callers of `/api/appointments`. |
| D-02 | Medium | **Fixed in code; index NOT built anywhere** | Duplicate prescription race: "already exists" was find-then-create with no unique index, so a double-submit could create two active prescriptions for one appointment. Fix: partial unique index `uniq_prescription_active_appointment` (`status:"active"`) on the schema + migration `013_prescription_active_uniqueness.js` (`npm run migrate:prescription-uniqueness`; reports duplicates and exits 2 without touching data, same pattern as 009). A violation maps to 409 via the existing error middleware. **`autoIndex` is off in production, so the index does not exist until the migration is run; it fails (exit 2) if production already has duplicates.** Run state unknown. The race itself was not reproduced (no MongoDB). |
| D-03 | Medium | **Fixed** (structural test only) | `createPrescription` created the row, then rendered the PDF; a PDF/storage failure left an orphan active prescription, returned 500, and every retry got 409. Fix: on failure the never-issued row (no history link, no notification yet) is deleted and the original error is rethrown. |
| D-04 | High (clinical integrity) | **Fixed** (validation Unit-tested; ordering structural) | `updatePrescription` edited diagnosis/medicines/notes but never regenerated the PDF, so the document the patient and admin download disagreed with the record. Fix: load → set whitelisted fields → `validate()` → render PDF from the merged values → `save()` with the new `pdfStorageKey`. A render failure now leaves record and PDF unchanged. Empty edit set still returns the record unchanged (previous behaviour). |
| D-05 | Medium | **Open — product decision needed** | An edit overwrites an issued prescription in place; the previous diagnosis/medicines are not kept. The brief asks to preserve medical-record history; whether to version, or void-and-reissue, is a clinical/product call. Not implemented. |
| D-06 | Low | Open, unverified | Re-rendering writes a new stored PDF; whether the old object is removed depends on `storePdf` naming/retention, which was not read. |
| D-07 | Info | Open | Doctor-role endpoints under `/api/doctors/*` (withdrawals, payouts, earnings, patients, …) are outside the new guard because that router also serves public discovery; e.g. `doctorWithdrawalController` passes `req.query.status` straight into its filter (own-doctor scoped). Needs per-route handling, not yet done. |
| D-08 | Low | Open | `listPrescriptions` and `listMedicalNotes` use `limit(100)` with no pagination (bounded, so not an unbounded query, but no paging). |

## Changed files (this slice)
`backend/app.js` · `backend/models/Prescription.js` · `backend/controllers/doctor/workflowController.js` · `backend/migrations/013_prescription_active_uniqueness.js` (new) · `backend/package.json` (script) · `backend/tests/doctorSliceD1.test.mjs` (new)

## Test evidence (2026-10-22)
| Command | Result |
|---|---|
| `node tests/doctorSliceD1.test.mjs` | PASS — 6 behavioural groups (real guard vs real `qs`-parsed queries; real schema index; offline document validation) + 3 structural groups |
| mutation checks on the 4 fixes (guard unmounted, index widened, create rollback removed, update validation removed) | each made the test fail; files restored byte-identical |
| `cd backend && npm test` | 219 passed, 0 failed |
| `npx vitest run` | 21 files, 98 tests passed |
| `npx eslint .` | exit 0 |
| `npx vite build` | built OK (existing chunk-size warning only) |
| `npm run test:mongo`, browser/E2E, explain plans | **NOT RUN** (no MongoDB / tooling) |
| Migration 013 | **NOT RUN** against any database |

## Next action (in order)
1. Appointment lifecycle: read `updateAppointmentStatus`, `/resolve`, `/no-show`, cancel/reschedule, `getAppointmentActions`, `getAppointmentById` for per-doctor ownership and transition validity.
2. `/patients/:patientId/*` handlers (clinical profile, reports, follow-up scheduling, `workflowController.js:1091`) against `clinicalAccessService`.
3. Notes/history, schedule/leave/documents, certificates, then `/api/doctors/*` doctor endpoints, practice/profile, realtime/chat rooms.
4. Frontend doctor route guards and role redirects; add cross-role denial tests where logic is testable without a DB.
5. Decide D-05; run migration 013 (or its dry check) against a safe copy once a database is available.
