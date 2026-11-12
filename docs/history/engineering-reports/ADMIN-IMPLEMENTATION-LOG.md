> **Historical record.** Preserved as written; it describes the repository at the time of writing and was not re-verified against the current code. For the current verified position see [PROJECT_STATUS](../../PROJECT_STATUS.md) and [REMAINING_RISKS](../../REMAINING_RISKS.md).

# MediCore HMS — Admin Implementation Log

Backlog source: `docs/audits/historical-audits/ADMIN-SYSTEM-AUDIT.md` (partial audit, kept unchanged). Slice ids (S1..S13) follow section 7 of that report.
Baseline: `MediCore-HMS-PHASE-03-COMPLETION-FRONTEND-HARDENED-2026-10-17.zip` (no git history; diffs were taken against a pristine extraction).

Rules followed: Admin scope only; no production access, deploy, or migration; no business metric changed; no timing numbers are claimed unless measured.

---

## S1 — Frontend request hygiene (A-02 client side, A-09a/b/c) — DONE

### Changes
New hooks (`src/hooks/`):
- `useRequestLifecycle` — latest-request-wins token (`begin()` → `{ isCurrent, finish }`) plus `isInFlight()`; unmount invalidates outstanding requests. The older `useLatestRequest` is untouched (still used by Payments/Refunds/Withdrawals).
- `useVisiblePolling(task, ms, { isBusy })` — interval polling that skips a tick while a request is in flight, is cleared while the tab is hidden, and on return refreshes once only if at least one interval elapsed.
- `useSyncRefresh(load, dashboardSyncTick)` — re-runs `load` on realtime ticks (not on mount); a tick received while the tab is hidden is deferred into one refresh when the tab is visible again.

Pages/components patched (API calls, response shapes, loading/error states, manual refresh and realtime sync preserved):
- `AdminMissionControl.jsx` (15 s poll), `AdminExecutiveActionCenter.jsx` (20 s poll): stale-response guard, no overlapping polls, hidden-tab pause, deferred ticks.
- `AdminOperationsCenter.jsx`: same, plus the A-09a fix. The separate "reset page to 1" effect was removed; the single fetch effect now resets the page and skips its own fetch when filters changed while past page 1, so a filter change causes exactly one request (previously two: `load(oldPage, newFilter)` then `load(1, newFilter)`).
- `components/widgets/WidgetShell.jsx`: stale guard (7d/30d/90d switching), ticks deferred while hidden. Each shell fetches independently, so this removes up to 14 hidden-tab refetches per realtime event.
- `AdminDoctors.jsx`: stale guard on `loadDoctors`. **Additional defect found and fixed while writing the test:** `sort` was a separate state mirrored into the URL, so one sort change ran the list effect twice (two identical requests). `sort` is now derived from the URL (`searchParams.get("sort") || "newest"`), the effect depends on `[searchParams]` only. Browser back/forward now also restores the sort order, which the old mirrored state did not.

### Tests added (all new)
- `src/hooks/useRequestLifecycle.test.jsx` (3), `useVisiblePolling.test.jsx` (6), `useSyncRefresh.test.jsx` (3)
- `src/pages/admin/AdminOperationsCenter.requests.test.jsx` (5): one request on mount; one request for a filter change from page 3 and from page 1; stale older response cannot overwrite newer; tick refresh keeps filters.
- `src/pages/admin/AdminPolling.requests.test.jsx` (5): Mission Control no-overlap, hidden pause + single resume refresh, deferred ticks, manual refresh with newest-wins; Executive Action Center no-overlap + hidden pause.
- `src/components/widgets/WidgetShell.requests.test.jsx` (4)
- `src/pages/admin/AdminDoctors.requests.test.jsx` (2): one request on mount; stale older sort response cannot replace newer, and no duplicate request.

Regression proof: the page-level test files were also run against the untouched baseline extraction. Operations Center: 2 of 5 fail there (double request, stale overwrite). Polling file: 5 of 5 fail. Doctors: the stale/duplicate test fails. WidgetShell tests were not run against the baseline.

### Checks run (in `work/`, after `npm ci`)
| Command | Result |
|---|---|
| `npx eslint .` | exit 0, no output |
| `npx vitest run` (= `npm run test:frontend`) | exit 0 — 21 files, 95 tests passed |
| `npx vite build` (= `npm run build`) | exit 0, built in 2.09 s (existing chunk-size warning only) |

Not run: browser/network-panel verification (no browser tooling here); backend tests (S1 changes no backend code).

### Limitations
- Starting a newer load does not cancel the older HTTP request; it only drops the older response. Server-side cost of overlapping manual/tick loads is unchanged (S7 addresses duplicate computation).
- Operations Center SLA overview (`loadSlaOverview`, tick-triggered only, not polled) has no stale guard; risk is a briefly older SLA strip, so it was left as is.
- Other realtime-tick pages (~20 more under `pages/admin`, plus doctor pages) still refetch on every tick including when hidden; the hooks are ready to adopt there (audit M-E).
- Not measured: request counts in a real browser. Test-level counts only.

---

## S2 — `buildSmartAlerts` counts instead of full documents (A-03c) — DONE

### Change
`backend/controllers/admin/missionControlAdminController.js` `buildSmartAlerts`: the four `find().select().lean()` calls (Doctor pending > 2 d, RefundRequest pending > 7 d, Insurance expiring ≤ 14 d with open claim, MedicalReport critical unreviewed) became `countDocuments` with the **identical filters**. Only `.length` of those results was ever used, so alert keys, counts, priorities, links, thresholds and time windows are unchanged. The Payment and NotificationDelivery lookups were already `countDocuments`. Output-equivalence is by construction (same filter, count instead of array length); no data-dependent behavior differs.

Callers (unchanged contract): Mission Control `/alerts`, widgets loader, Executive Action Center (2 sites), Platform Health (2 sites), Command Center aggregates.

### Test added
`backend/tests/smartAlertsCountQueries.test.mjs` (auto-discovered by `tests/run-all.mjs`): stubs the six models; fails if `find()` is called on any; asserts counts/priorities/links, the payment-failure `> 5` threshold, the exact filters, and the 2-day / 7-day windows. Run against the untouched baseline controller it fails immediately (`Doctor.find must not be used…`).

### Checks run
| Command | Result |
|---|---|
| `cd backend && npm ci --no-audit --no-fund` | exit 0, 374 packages |
| `node tests/smartAlertsCountQueries.test.mjs` (with the dummy env vars `run-all.mjs` sets) | all 4 checks PASS |
| `cd backend && npm test` | exit 0 — **207 passed, 0 failed** (audit baseline was 206; +1 new) |

Not run: `npm run test:mongo` (needs a reachable MongoDB; none provisioned), `explain()` or any timing. **No before/after performance number is claimed** — the saving (documents no longer transferred per alert poll) was not measured.

---

## S1 follow-up — request lifecycle with an older request still in flight — DONE (2026-10-22)
- `src/hooks/useRequestLifecycle.js`: `isInFlight()` is now true while ANY begun request is unsettled (a Set of outstanding sequence numbers), not only the newest. `isCurrent()` is unchanged (latest response wins). `finish()` is idempotent; unmount clears the set. All 5 call sites already call `finish()` in `finally` (inspected).
- Tests (`useRequestLifecycle.test.jsx`): A starts, B starts and finishes first -> still in flight until A settles; idempotent/duplicate finish cannot clear a later request; error path in `finally`; unmount. The A/B test was not run against the old hook (reasoned only).
- Frontend: 98 tests pass, eslint exit 0, `vite build` OK.

## S3 — Reviews (A-15, A-03a, A-03d, A-16) — DONE
- A-15 `combineRatingFilter` (`reviewAdminAggregates.js`): explicit rating AND sentiment bound must both hold; contradictions match nothing.
- A-03a: `getReviewSummaryAdmin` and `buildReputationSnapshot` use `Review.aggregate` (`buildReviewSummaryPipeline`, `buildReviewSummaryFromTotals`, `buildDoctorAttentionPipeline`). Same rounding/null rules as the in-memory functions.
- A-03d: attention queue = three bounded queries (critical / warning / info, 26 rows each, `createdAt,_id` desc) instead of newest-500; response gains additive `hasMore`.
- A-16: `deleteReview` is one atomic `findOneAndUpdate` claim (404 unknown, 409 already deleted, 400 bad id); audit entry written right after the claim; if the rating recalculation then fails the response is 200 with `ratingRecalculated:false` (a retry could only 409).
- List sort has `_id` tiebreaker; list params read through `queryString` (repeated keys -> 400).
- Tests: `reviewAdminDbSide.test.mjs` (+ `tests/helpers/miniMongo.mjs`: tiny filter matcher / fake query, not a MongoDB emulator).
- Emulator check (mingo, outside repo, NOT real MongoDB): summary, bucket partition and doctor-attention pipeline equal the in-memory functions on 800 generated reviews.
- `groupReviewAttentionByDoctor` is no longer used by production code (kept; its test still passes).

## S4 — Doctor list (A-05, A-08, A-04) — DONE
- New `services/adminDoctorListPipeline.js`. Joined user is an allowlist `{name,email,isActive,createdAt}` inside the `$lookup` (verification hashes/securityVersion/password never leave the DB); `documents[].storageKey` stripped. `_id` tiebreaker on all sorts. Appointment count runs after `$skip/$limit` except for `sort=activity`. Join on users and search still precede paging, so result set and `total` are unchanged.
- A-05 other sites: `overviewAdminController.js:211`, `paymentController.js:1326`, `financeAggregates.js:255` all end in an explicit `$project` of name/specialization -> not affected (no change).
- Doctor params via `queryString/queryNumber` (`utils/queryParams.js`); minRating must be 0-5.
- Found+fixed (N-01): Services/Articles doctor pickers showed raw ids because they read `d.userId?.name`; now `d.user?.name` first. Covered by lint/build only (no test).
- Tests: `adminDoctorListContract.test.mjs`. Contract tests that grepped the old controller text were updated (`phase3CanonicalFiltering`, `phase3MasterDataContract`, `phase4PerformanceContract`).
- Emulator check: same doctor set and row contents as the old pipeline for all 5 sorts, with and without search, no duplicates across pages, no secrets in output.
- Unchanged existing quirk: with no search, `total` counts doctors whose user is missing while the list hides them.

## S5 / S8 (stats part) — Patients and Activity (A-08, A-14, A-06 partial) — DONE
- Patients: `_id` tiebreakers, `normalizePatientQuery` (400 on repeated keys / bad ageMin,ageMax), registry list skips the doctor->user populate (`buildPatientAggregates(ids,{includeDoctorNames:false})`; Patient 360 unchanged).
- Stats: distinct-patient counts via `$group/$count` and `$unionWith` (`services/patientAdminStatsPipelines.js`) instead of `.distinct()` id lists. **Requires MongoDB >= 4.4** (docker-compose pins 7; production version unconfirmed).
- Activity log: strict params, severity enum, valid dates, `_id` tiebreaker.
- Tests: `adminPatientActivityLists.test.mjs`. Emulator check: counts equal `.distinct()` semantics on generated data.
- NOT done (A-06 remainder): `resolveAdvancedIdFilters` still uses `.distinct()` for list filters; `buildPatientAggregates` still loads per-page histories (<=100 patients).

## S6 — PHI access audit (A-11) — DONE
- `patient.phi_view`, `patient.report_download`, `patient.prescription_download` via new `writeAdminLogSafe` (never throws). Ids only: no names, titles, file names. 404s are not logged. Logged when the request is accepted (before streaming), so a later file-read failure still leaves an access record.
- Test: `adminPhiAccessAudit.test.mjs`.
- Inspected, unchanged: `utils/fileDownload.js` serves a DB-stored path; the request carries only an id, so no request-driven traversal. No uploads-root containment check was added (defence in depth only).

## S11 (partial) — Exports and query strictness (A-12, A-14)
- `exportAdminController.js`: filters validated (dates, amounts, repeated keys, resource/format -> 400), field projection (`EXPORT_FIELDS`, doctor populate limited to `userId`), CSV formula guard and 5000-row ceiling preserved. Unchanged: `doctors`/`patients` exports ignore date/status filters.
- Services list and review list: strict params, tiebreakers. Test: `adminExportValidation.test.mjs`.
- NOT done: ~25 other admin controllers still read `req.query` raw (appointment, payment, refund, finance, withdrawal, user, cms, process*, monitoring, integration, intelligence, executive, widgets, automation, operations). A-14 is therefore only partly closed.

## Round 2 (2026-10-22, later) — remaining phases

### S9 / S10 — operations queue and assignment (PARTIAL by design)
- DONE: `getRecommendations` / `getReassignmentRecommendation` rebuilt the full queue twice per request (item lookup + candidate ranking). They now load ONE snapshot (`_internal.loadAttachedOperations`) and pass it to `findOperationItem(key,{withAssignments})` and `rankCandidatesForItem(item,{withAssignments})` / `buildUnifiedQueue(filters,{withAssignments})`. Output is identical; unknown key still 404. Test: `assignmentSnapshotSharing.test.mjs`.
- NOT changed on purpose: the scheduler sweep (`autoAssignUnassigned`, `autoEscalateOverdue`) re-reads the queue per item (N+1). That is NOT a safe dedupe: each assignment changes workload and the next ranking must see it. A test pins this. Real fix = incrementally updated in-memory snapshot (design + product sign-off, needs measurements).
- NOT changed: source `.find()` calls in `fetchRawOperations` are unbounded. Any ceiling changes counts/SLA numbers unless a drop rule is decided -> needs product input and data volumes.
- `buildAssignmentAnalytics` loads all `OperationAssignment` rows (`.select`ed). Bounding it changes analytics definitions -> not changed. Open.

### A-14 central guard — DONE
- `middleware/rejectRepeatedQuery.js` mounted once on `/api/admin` (before every admin router, asserted by test). Any array/object query value (`?a=1&a=2`, `a[]=`) is 400. Verified no frontend call sends multi-value params. Test: `adminQueryGuard.test.mjs`.
- `processAnalyticsController`: `rangeDays` was an unbounded `Number()` (NaN -> Invalid Date -> 500; huge -> near-unbounded scan). Now clamped (non-numeric/<=0 -> fallback, max 90, same as monitoring); `version/versionA/versionB` must be positive integers (400 otherwise). Test: `processAnalyticsQueryParams.test.mjs`.
- Remaining numeric-parse sites are harmless (`Math.min(Number(x)||7, 90)` etc.); per-controller `queryString` migration is not needed for the repeated-key class any more.

### A-17 (new) CMS server sanitizer — DONE
- `sanitizePlainContent` judged URL schemes before entity decoding: `<a href="java&#x73;cript:...">` and `java\tscript:` were stored as-is (the SPA's DOMPurify blocks them on render, so this was defence-in-depth, but any non-SPA consumer of the API would be exposed). Now the URL is decoded/stripped like a browser and only http/https/mailto/tel or scheme-less URLs are kept. Test: `cmsSanitizerUrlSchemes.test.mjs`.

### Module inspection results (this round)
| Module | Depth | Result |
|---|---|---|
| Admin route authorization (31 files) | mechanical grep + read of low-count files | every router has `protect` + `requireAdmin`/`authorizeRoles`. Only `super_admin` is an admin role, so permission keys are effectively moot today. **Latent gap (A-13 input):** `PATCH /appointments/:id/cancel`, patient PHI GETs/downloads, overview/widgets/mission-control have no `requirePermission`; would matter only if a lower admin role is introduced. No key invented. |
| Finance / refunds / payments / withdrawals (routes + admin controllers) | route + controller mutation surface | mutations require reason, ObjectId validation, `requirePermission("manage_payments")`, and `writeAdminLog`; reconcile POST is read-only (writes no balance) and not audited (info). Money-path services NOT re-verified this round: no financial code changed. |
| Settings / feature toggles / permissions | route + audit grep | audited, `manage_settings` gated; deep validation (`settingsValidation`) not re-read. |
| CMS | sanitizer + render path | see A-17; client DOMPurify allowlist confirmed. |
| Realtime / sockets | `socketAuth`, `roomManager.canJoinRoom` | signature/expiry/active/securityVersion enforced; admin room only for admin roles; no client-controlled arbitrary joins. No change. |
| Background jobs / process engines | route/auth level only | NOT deeply inspected (scheduler locking was handled in an earlier phase per project history; not re-verified here). |

### S12 — index evidence (no index added)
Existing: Review `{userId,appointmentId}` unique, `{doctorId,createdAt:-1}`; Doctor 4 indexes (no `createdAt`); Appointment `{status,date}`, `{doctorId,date,visit.state}`; User `{role,isActive}`; AdminActivityLog `{createdAt:-1}` + text. Candidates to evaluate WITH `explain()` and real volumes: Review `{adminDeleted:1,createdAt:-1,_id:-1}` (attention buckets / admin list), Doctor `{createdAt:-1,_id:-1}` (default list sort). Appointment `$count` per doctor is already served by the `doctorId` prefix. Nothing added: no explain plans or volumes available.

## Verification (final run, `work/`)
| Command | Result |
|---|---|
| `cd backend && npm test` | **216 passed, 0 failed** (207 baseline + 9 new files) |
| `npx vitest run` | 21 files, **98 passed** |
| frontend `npx eslint .` | exit 0 |
| `npx vite build` | OK |
| `npm run test:mongo`, browser, load, explain | NOT RUN (no MongoDB, no browser, no data) |

## Module classification (honest)
Inspected and changed: Reviews, Doctors list, Patients list/stats/workspace/downloads, Activity log, Exports, Services list. Inspected, no change needed: three `$lookup users` sites. NOT inspected in this round: Finance, payments, refunds, wallet/ledger, permissions, settings, CMS, background jobs/process engines, realtime/notifications, and remaining Admin pages. The Admin system is NOT complete.

---

## Current state and next action

Working tree is coherent: every command in the Verification table passes.

**Genuinely open (cannot be finished without input/environment):**
1. A-07 `emergencyToday` meaning; A-13 permission model (latent gaps listed above).
2. S7 caching/coalescing: replica count and acceptable staleness.
3. S9 operations-queue bounds + sweep N+1: drop rule, volumes, measurements.
4. S12 indexes: `explain()` plans and collection sizes.
5. `npm run test:mongo`, browser and load checks: need a safe MongoDB URI / browser.
6. Production MongoDB version (patient stats need >= 4.4).
7. Deep review of money-path services, background job engines, settings validation (not re-verified this round).

---

## Round 3 (2026-10-22, from ADMIN-FINAL zip) — money-path deep review, first slice

Baseline reproduced on the uploaded tree before any change: backend `npm test` 216 passed / 0 failed; `npx vitest run` 98 passed; `npx eslint .` exit 0; `npx vite build` OK.

### F-R3-01 (HIGH, fixed) — withdrawal admin actions were never audit-logged
- Evidence: `controllers/admin/withdrawalAdminController.js` called `writeAdminLog({ actorId, action, entityType, entityId, details })` with **no `req`**. `writeAdminLog` reads `req.user`, so it throws `TypeError: Cannot read properties of undefined (reading 'user')` (reproduced by executing it). `AdminActivityLog.resourceType` is also `required`. The call was followed by `.catch(() => {})`, so the failure was invisible. Every admin withdrawal transition (manual_pending, manual_completed, failed, retry_required, cancelled) therefore wrote **no** audit row.
- Fix: call now uses the real contract `{ req, action: "withdrawal.<to>", resourceType: "Withdrawal", resourceId, severity, metadata: { from, to, reason, settlementReference, doctorId } }`; audit failure is logged via `logger.warn` instead of swallowed silently. Action string changed from `withdrawal:<to>` to `withdrawal.<to>` to match `payment.*` / `finance.*`; no backend or frontend source reads the old string (grepped). Historical rows do not exist, so nothing to migrate; past withdrawal actions cannot be reconstructed from the audit log (the `Withdrawal.stateHistory` array, which records actor/source/reason, is the surviving record).
- F-R3-02 (LOW, fixed, same file): after the committed transition, two `Doctor` lookups ran before the audit write; a DB error there would 500 a transition that had already committed (inviting an admin retry that then 409s) and drop the audit row. Audit now runs first; the doctor lookup, realtime invalidate and e-mail enqueue are inside a try/catch that logs. Behaviour otherwise unchanged (invalidate on every transition, e-mail only for complete/fail). `enqueueEmail` itself never throws (verified).
- Tests: `adminAuditCallContract.test.mjs` scans all 70 `writeAdminLog` call sites for `req` / `resourceType` / non-contract field names and checks the three service producers behind forwarded `audit(entry)` callbacks. Mutation-checked: re-introducing the old call shape fails it. `withdrawalAdminPostCommitOrder.test.mjs` pins the order commit -> accounting -> audit -> best-effort notifications. **Both are static/structural tests, not behavioural**: the controller itself was not executed end to end (no MongoDB here).
- Other call sites flagged by the scan (`refundReviewController`, `paymentAdminController`, `financeAdminController`) were false positives: they forward `...entry` and their producers set `resourceType`.

### Reviewed this round, no change needed (evidence = code read, not executed)
- `payments/webhookHandler.js` (first 140 of 436 lines read): HMAC-SHA256 over the raw body, `timingSafeEqual` with length check, fail-closed on missing secret/non-Buffer/empty signature; payload minimised before persistence; strict shape validation; unique event id as dedupe gate. The remaining ~300 lines (event handlers, lease/claim logic) NOT yet read.
- `withdrawalAdminController.applyTransition`: transition `from` status and `reservationHeld` are part of the atomic `findOneAndUpdate` filter; amounts are taken from the stored row, never from the body; a lost race releases any re-claimed balance and returns 409. Known, documented design: post-commit balance release / ledger posting are separate writes (idempotent ledger keys, drift detectable via `reconcileWithdrawalGate`); a crash between them leaves drift, not double-spend. Not changed.
- `refundAdminController` is read-only (list/summary/detail); refund mutations live in `refundReviewController` -> `services/finance/refundReviewService.js` (audit entry verified; service internals not read).

### Verification after this slice
| Command | Result |
|---|---|
| `cd backend && npm test` | 218 passed, 0 failed (216 + 2 new) |
| `npx eslint` on the 3 touched/new files | exit 0 |
| full `npx eslint .`, `npx vitest run`, `npx vite build` after the change | NOT RE-RUN (no frontend file changed; baseline above was green) |
| `npm run test:mongo`, browser, explain, load | NOT RUN (no MongoDB, browser or data) |

### Admin completion gate — status: NOT SATISFIED. Phase B (Doctor side) NOT STARTED.
Still open for the gate, in order of risk:
1. Money-path services not yet read: `webhookHandler.js` lines 140-436, `paymentCapture.js`, `paymentTransitions.js`, `refundReviewService.js`, `refundEarningAdjustment.js`, `services/finance/withdrawalService.js` (claimBalance/releaseBalance/postWithdrawalLedger), `walletReservationService.js`, `reconciliationRepair.js`, `captureResolution.js`.
2. Uninspected modules from the audit: settings validation, features, process/workflow engines, automation studio, monitoring, integrations, intelligence, cron/background jobs, remaining Admin pages.
3. Product/environment blockers unchanged from Round 2 (A-07, A-13, S7, S9 bounds, S12 indexes, MongoDB-backed checks).
