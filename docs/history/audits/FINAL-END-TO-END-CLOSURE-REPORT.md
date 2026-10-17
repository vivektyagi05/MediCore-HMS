# MediCore HMS — Final End-to-End Closure Report

**STATUS: PARTIALLY COMPLETED.** Every claim below carries one of the labels
`PASS`, `SOURCE VERIFIED`, `DATABASE VERIFIED`, `RUNTIME VERIFIED`, `BLOCKED`, `FAILED`.
Section 19 lists exactly what is not verified and why.

## 0. Environment used for verification (read this first)

* The build sandbox has **no MongoDB** (download host blocked). All database/runtime
  verification ran against **FerretDB 1.24 (SQLite backend)**, a MongoDB-wire-compatible
  server — *not MongoDB*. FerretDB lacks `$lookup`, `$year`, `$group.$avg` and
  `findAndModify` projections. Two sandbox-only shims (never shipped) rewrote `$avg` and
  dropped the projection so the public search / approval endpoints could be exercised.
  Endpoints depending on `$lookup`/`$year` (admin doctor list, admin doctor detail,
  practice overview/analytics) could not run and are `SOURCE VERIFIED` only.
* UI verification ran in **jsdom** (real React components, real API client, live backend),
  **not a real browser**. No real-browser E2E was possible.
* `lgdirectory.gov.in` / `data.gov.in` are unreachable from the sandbox (HTTP 403).

## 1. Original problems

1. State dropdown showed only "Select state / Other".
2. Pending doctors got `403 "Your doctor account is not yet approved."` on onboarding.
3. Doctor location did not persist / could not be re-saved from the profile page.
4. Public doctor discovery had leak paths (email exposure, AI suggestions, related doctors).
5. Services/articles: verify a single persisted source of truth and publication security.

## 2. Root causes (all proven, not assumed)

| # | Root cause | Evidence |
|---|---|---|
| 1 | `backend/master-data/source/lgd/` contained only a README — no dataset; the importer could never run | `RUNTIME VERIFIED`: `GET /api/master-data/states` → `{"success":true,"data":[]}` |
| 2 | Importer only split on `;`; LGD exports are comma-separated | `SOURCE VERIFIED` |
| 3 | **Mongoose 9** (pinned 9.8.1) removed the `next` callback: `pre("validate", function (next){…next();})` throws on every `create/save/insertMany`; `insertMany({ordered:false})` swallowed it and inserted 0 rows. Affected `MasterData`, `Invoice`, `AutomationRunLog` | `RUNTIME VERIFIED` (reproduced, then fixed; regression test) |
| 4 | `routes/doctor/commandCenterRoutes.js` used a path-less `router.use(…, requireApprovedDoctor)` and is mounted at `/api/doctor` **before** `onboardingRoutes` → every `/api/doctor/onboarding` request from a pending doctor got 403 | `RUNTIME VERIFIED`: `GET`/`PUT /doctor/onboarding` = 403 before, 200 after |
| 5 | `GET /doctor/practice/professional-profile` never returned the state/district/city/specialization ids+types; `DoctorOnboarding` dropped them on load; schema defaults every `*Type` to `OTHER` (preselecting "Other"); dirty baseline was a reduced object (always "unsaved") | `RUNTIME VERIFIED` (jsdom page test before/after) |

## 3. Files changed (vs the uploaded zip)

Backend: `controllers/{aiController,appointmentController,doctorController,publicController}.js`,
`controllers/doctor/practiceController.js`, `routes/doctor/{commandCenterRoutes,practiceRoutes}.js`,
`models/{MasterData,Invoice,AutomationRunLog}.js`, `services/{masterDataService,
servicePublicSerializer,articlePublicSerializer,emailVerificationService}.js`,
`migrations/005_import_lgd_master_data.js` (rewritten), `package.json`.
New backend: `master-data/lgdSource.js`, `master-data/source/lgd/*` (3 CSVs, `MANIFEST.json`,
`README.md`), `scripts/updateLgdManifest.mjs`, `scripts/runtime-verification/*`,
`scripts/ui-verification/*`.
Frontend: `src/api/{masterDataApi,publicApi}.js`, `src/main.jsx`,
`src/pages/doctor/{DoctorOnboarding,DoctorProfessionalProfile}.jsx`,
new `src/components/doctor/DoctorLocationFields.jsx`, `src/hooks/useLocationOptions.js`,
`src/utils/doctorLocation.js`; `eslint.config.js`, `vite.config.js`.
Tests: 8 new files + 4 updated stale contract tests (Section 16). `docs/` this report.

## 4. MasterData architecture

Single model `MasterData` (`kind`: specialization | state | district | city), unique index
`(kind, parentId, normalizedName)`. Pipeline (each hop verified):

```
committed LGD CSVs (+MANIFEST sha256)  →  lgdSource.js (verify, parse, resolve hierarchy)
→ migrations/005 (read-diff-insertMany; idempotent)  →  MongoDB masterdatas
→ masterDataService.listMasterData (parent REQUIRED for district/city; wrong-kind → 422)
→ GET /api/master-data/{states,districts?parent=,cities?parent=,specializations}
→ masterDataApi.* (always returns an Array)  →  useLocationOptions  →  DoctorLocationFields
```

`RUNTIME VERIFIED` end to end. No geography is hardcoded in `src/` (`SOURCE VERIFIED`, grep +
test `doctorLocationForm`).

## 5. Actual LGD source

* Dataset: LGD *States*, *Districts*, *Statewise Urban Local Bodies coverage*; snapshot **2026-09-19**;
  licence GODL-India; retrieved 2026-09-19T20:41:38Z.
* Retrieved from the ramSeraph/opendata mirror of LGD's own Download Directory exports
  (release `lgd-latest-extra1`), because the official host is blocked from the sandbox.
  Independent cross-check vs. a direct LGD export (planemad, Dec 2022): 36/36 state codes
  identical; 760/763 district codes map to the same state. **Not byte-verified against
  lgdirectory.gov.in.**
* Committed under `backend/master-data/source/lgd/` with SHA-256 in `MANIFEST.json`; the
  importer refuses missing/altered/empty files or unresolvable rows (`PASS`, tests).
* Mapping, transformation and limitations: `backend/master-data/source/lgd/README.md`
  (cities = urban local bodies; 13 ULBs have no district mapping and are not imported).

## 6. Actual database counts — `DATABASE VERIFIED` (FerretDB)

```
masterData: states=36 districts=784 cities=5112 specializations=27
services=6 articles=6 doctors=7 (all DEV TEST fixtures) users=9 (super admin, 1 patient, 7 dev doctors)
```
Rajasthan (41 districts) → Jaipur (19 cities incl. Jaipur); Uttar Pradesh (75) → Mathura
(16 incl. Mathura); Maharashtra 36 districts; Delhi 13. Re-running the import wrote 0 records;
no duplicate `(kind,parent,name)`; no orphan districts/cities.

## 7. Doctor location flow — `RUNTIME VERIFIED`

State select → district select → city text (Other state ⇒ free-text district). Typed city is
resolved server-side against canonical cities **of the selected district only**: exact match ⇒
`MASTER` + `cityMasterId`; otherwise `OTHER` + `cityOther`. Cross-district ids/districts ⇒ 422.
Changing state clears district+city; changing district clears city (explicit blank levels are
accepted server-side so stale values are never merged back). Latest selection wins over slow
responses. 20/20 live API checks; 17/17 jsdom page checks (real pages, save, remount =
"refresh", persistence, reset).

## 8. Pending doctor access — `RUNTIME VERIFIED`

Pending doctors can read/write onboarding, professional profile, verification details and
documents. `command-center`, `prescriptions`, `practice/analytics` and other clinical routes
remain 403. `requireApprovedDoctor` was **not** removed globally (test `doctorAccessRouting`).

## 9. Public visibility rules

`verificationStatus=approved ∧ isVerified ∧ isActive ∧ User.role=doctor ∧ User.isActive`.
`RUNTIME VERIFIED` (70 checks) for pending/rejected/inactive/unverified/inactive-user doctors on:
public search, direct profile, reviews, similar, availability map, `GET /api/doctors`, featured,
`/ai/search`, available-slots, next-available; approved doctor visible on all.
Defects fixed: unauthenticated `/api/doctors` exposed doctor emails; `/ai/search` had no filter;
`next-available` had no eligibility check; related doctors on service/article detail did not check
`isVerified`/`isActive` (fields never selected). Booking: pending/rejected/inactive/unverified ⇒ 403;
approved dev doctor ⇒ 201 (`RUNTIME VERIFIED`).

## 10. Approval workflow — `RUNTIME VERIFIED` (with caveat)

Pending → SUPER_ADMIN approve (200; DB approved/verified/active; appears publicly) → reject other
(200; hidden) → resubmit (pending; hidden). Notifications/e-mail side effects were **not**
verified. Admin doctor list/detail could not run on FerretDB (`SOURCE VERIFIED`: no status filter);
pending queue and stats endpoints were exercised.

## 11–13. Services, Articles, Admin workflow — `RUNTIME VERIFIED` (35/35)

One `Service` model, one `CMSPage` model. Six seeded services and six seeded articles exist in
MongoDB with references; public and admin APIs return the same records. Draft, review,
private(+published) and archived are hidden in list **and** direct slug (404); publish, edit
(public content updates) and archive work; admin still opens archived records. Seed is a
`$setOnInsert` upsert (idempotent, never overwrites edited content). Service stats total/published
match the DB. Article/doctor dashboard counts beyond service stats were not exercised (FerretDB).

## 14. API contracts — `PASS`

`masterDataApi.*` always resolve to arrays for envelope/undefined/null/object/HTML responses;
`getSearchMeta` is normalized at the API boundary; `getDistricts/getCities` return `[]` without a
parent id. Test `frontendApiContract`.

## 15. Security

Fixed: email exposure, unfiltered AI suggestions, availability probing of unpublished doctors,
related-doctor leakage. Approval gate kept on clinical routes. No new roles introduced.
Sandbox caveat: no live authorization matrix beyond the checks above.

## 16. Tests — `PASS` (sandbox)

`npm test` (backend): **125 passed, 0 failed** (also 125/125 on a fresh extract + reinstall of the delivered zip; lint 0 problems; build success). New: `lgdSourceLoader`, `doctorLocationForm`,
`masterDataResolution`, `mongooseHookCompatibility`, `doctorAccessRouting`,
`publicDoctorVisibilityGuards`, `frontendApiContract`, `cmsSeedCatalog`. Updated stale tests:
`finalDataFlowContract`, `masterDataLgdImportContract`, `phase4PerformanceContract` (cwd-relative
paths), `publicSurfaceDiscoverability` (missing `User` stub). The original `cmsSeedContract`
test is unchanged. Vitest `api.test.js` is **BLOCKED** (needs a mongod download).
Live harnesses (not in `npm test`): `scripts/runtime-verification/*` (needs a running backend +
DB; **creates and approves dev accounts — never run against production**) and
`scripts/ui-verification/*` (jsdom; `npm i --no-save jsdom esbuild`).

## 17. Build — `PASS`

`npx eslint .` (frontend + backend): 0 problems. `npm run build`: success; build identifier
`window.__MEDICORE_BUILD__` / `<meta name="medicore-build">` embedded.

## 18. Runtime / deployment

Deployed frontend vs local: `BLOCKED` — no access to your Vercel/Render settings. Note
`VITE_API_BASE_URL` defaults to `http://localhost:5000/api` when unset at build time; a deployed
build without it cannot reach your API, and a deployed API needs the import run against its
database. The build now exposes its version and API host for diagnosis. To populate a real database:

```
cd backend && npm run migrate:master-data:lgd && npm run seed
```
(The importer builds the `MasterData` indexes itself because production runs with autoIndex off.)

## 19. Remaining blockers / not verified

* No real MongoDB run; no real-browser E2E; deployed-site check not possible.
* Admin doctor list/detail, practice overview/analytics, dashboards: FerretDB `$lookup`/`$year`.
* Approval/rejection e-mail and notification side effects not exercised.
* Vitest `api.test.js` not runnable.
* Duplicate "Pulmonology"/"Pulmonary Medicine" specializations left untouched (doctors may
  reference either id).
* City layer = urban local bodies only; rural places are entered as text (`OTHER`).
* Phase 1–4 regressions covered only by the existing suite (all passing), not by new live checks.
