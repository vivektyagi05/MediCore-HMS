# MediCore HMS — Full Data / Content / End-to-End Repair

**Status: PARTIALLY COMPLETED**

## 1. Root causes

### Public doctor visibility
The public doctor controller previously enforced `verificationStatus=approved`, `isVerified=true`, and `isActive=true` only at the Doctor-document level. It did not make the linked User record part of the publication rule for every public discovery surface.

The repair now centralizes the public publication contract and requires:

- Doctor `verificationStatus === "approved"`
- Doctor `isVerified === true`
- Doctor `isActive === true`
- linked User exists
- linked User `role === "doctor"`
- linked User `isActive === true`

The same contract is applied to discovery, profile, reviews, comparison, similar-doctor, availability, coverage, and testimonials paths.

### Appointment safety
Appointment creation and slot lookup now reject doctors that are not approved, verified, active, and linked to an active DOCTOR user.

### MasterData completeness
The existing canonical seed intentionally contained only a small clinical specialization vocabulary and no geography. The repair expands the specialization vocabulary and adds an LGD import pipeline for State → District → City/Town data rather than hardcoding geography in React.

### CMS content
The repository had CMS models and public/admin workflows, but the seed surface did not provide the requested useful production-style service/article catalog. The seed now contains six meaningful services and six educational healthcare articles, persisted through the existing Service/CMSPage models and upserted by deterministic slug.

## 2. Doctor public visibility rule

Public APIs use a shared backend publication filter. Frontend hiding is not used as the security boundary.

Direct public doctor profile lookup and related/recommendation surfaces independently enforce the same publication rule.

Public appointment creation also verifies doctor publication state at the backend.

## 3. MasterData architecture

The existing MasterData model remains authoritative:

- `specialization`
- `state`
- `district`
- `city`

Each geographic child retains `parentId`:

- State → `parentId = null`
- District → `parentId = State._id`
- City/Town → `parentId = District._id`

The existing unique `(kind, parentId, normalizedName)` index remains in place.

The `source` enum now additionally supports `lgd` so authoritative imported records can coexist with repository-controlled clinical seed values and legacy records.

## 4. Geographic data source

The importer is designed for the Government of India's **Local Government Directory (LGD)** source.

Primary authority:

- Local Government Directory: https://lgdirectory.gov.in/
- Government Open Data Platform LGD resources: https://www.data.gov.in/

Required LGD export files:

- `states.csv`
- `districts.csv`
- `statewise_ulbs_coverage.csv`

The City/Town layer uses LGD urban-local-body coverage because it provides a real State/District/urban-local-body relationship instead of a hand-written city list.

A data collection project documents that its LGD archives are collected from `lgdirectory.gov.in` and that some LGD data is also published through data.gov.in. It is used only as a distribution/reference mechanism; LGD remains the source authority.

### Dataset version/date
**Not claimed as executed.** The uploaded repository did not contain an LGD data snapshot, and the available environment did not provide a MongoDB connection or the external LGD export files. Therefore this repair does not falsely claim that a particular LGD snapshot was loaded into a real database.

## 5. Migration / seed command

New command:

```bash
cd backend
LGD_MASTER_DATA_DIR=./master-data/source/lgd npm run migrate:master-data:lgd
```

The importer is:

`backend/migrations/005_import_lgd_master_data.js`

It is designed to be:

- idempotent
- deterministic
- safe to rerun
- upsert-based
- preserving existing `_id` values for matching `(kind,parentId,normalizedName)` rows
- non-destructive to existing valid records
- free of frontend hardcoded geography

The old `004_master_data_backfill.js` remains available for legacy compatibility. Its service logic was adjusted so authoritative `lgd` records are not deactivated by the old legacy cleanup.

## 6. Specialization vocabulary

The canonical clinical vocabulary was expanded to include meaningful specialties such as:

- General Medicine
- Cardiology
- Dermatology
- Neurology
- Orthopedics
- Pediatrics
- Gynecology & Obstetrics
- ENT
- Ophthalmology
- Psychiatry
- Pulmonology
- Gastroenterology
- Nephrology
- Urology
- Oncology
- Endocrinology
- Emergency Medicine
- Radiology
- Anesthesiology
- Dentistry
- General Surgery
- Rheumatology
- Hematology
- Pathology
- Physiotherapy
- Family Medicine

`OTHER` behavior remains unchanged.

## 7. Admin/Public MasterData flow

Admin Doctors retains the previously repaired canonical lifecycle.

Doctor onboarding and professional profile retain canonical IDs and dependent geography behavior.

Public Doctor Search now consumes MasterData for specialization/state/district/city selection and converts display selections to canonical IDs before requesting doctor results when the corresponding canonical record exists.

State change clears District and City.

District change clears City.

Dependent requests use stale-response protection.

No Indian geography is hardcoded in frontend source.

## 8. Services seed data

Six meaningful services are now seeded through the existing `Service` model:

1. General Physician Consultation
2. Cardiology Consultation
3. Dermatology Consultation
4. Pediatric Consultation
5. Preventive Health Checkup
6. Diagnostic Report Review

Each contains structured content including description, benefits, eligibility, preparation, procedure information, duration, consultation modes, category, related specialties, SEO metadata, publication state, and display order.

Seed prices are **configurable MediCore platform/demo prices**, not claims about real hospital tariffs.

Seed writes use deterministic `slug` upserts and `$setOnInsert`, so rerunning the seed does not overwrite manually edited records.

## 9. Article seed data

Six educational articles are now seeded through `CMSPage`:

1. When Should You See a General Physician?
2. Understanding Blood Pressure and When to Seek Care
3. How to Prepare for a Doctor Consultation
4. Warning Signs That Require Urgent Medical Attention
5. Preventive Health Checkups: What They Usually Include
6. Understanding Your Basic Blood Test Report

The content is educational, not individualized medical advice. Source/reference metadata is persisted where the CMS model now supports it.

References used include WHO, NHS, and MedlinePlus materials.

Seeded article authors are the existing authenticated SUPER_ADMIN seed actor; no fictional doctor/medical author identity is introduced.

## 10. Publication rules

Public services now require:

```text
status = published
visibility = public
isActive = true
```

Public articles now require:

```text
contentType = article
status = published
visibility = public
isPublished = true
```

Draft, review, archived, or private resources are excluded from public list/detail endpoints.

Direct public slug endpoints use the same publication filters.

## 11. Admin publication lifecycle

Existing Admin Services and Admin Articles controllers were preserved rather than replaced.

The existing actions remain the source of truth:

- create
- edit
- publish
- archive
- preview where supported

Public pages consume persisted MongoDB records through the existing public APIs.

## 12. Admin dashboard data

The existing Executive Command Center now includes a MongoDB-backed content/doctor workflow snapshot containing:

### Doctors

- total
- pending
- approved
- rejected
- active
- inactive

### Services

- total
- draft
- review
- published
- archived

### Articles

- total
- draft
- review
- published
- archived

The dashboard renders these values from the command-center API rather than hardcoded numbers.

## 13. Relation privacy

Public service/article serialization now filters related doctors so an unpublished/inactive doctor is not accidentally exposed through a published service/article.

Published related services are also filtered before public serialization.

## 14. Phase-4 preservation

The Phase-4 realtime and database-query optimizations remain intact.

The Phase-4 performance contract continues to pass in direct targeted execution.

No Phase-5 work was introduced.

## 15. Tests added/updated

Added:

- `backend/tests/publicVisibilityContract.test.mjs`
- `backend/tests/masterDataLgdImportContract.test.mjs`
- `backend/tests/cmsSeedContract.test.mjs`
- `backend/tests/adminContentDashboardContract.test.mjs`

Updated stale repository contracts where their assertions contradicted the current three-role runtime contract or the already-existing geographic implementation.

## 16. Targeted test results

Direct targeted execution passed for:

- public visibility contract
- LGD MasterData import contract
- CMS seed contract
- Admin content/dashboard contract
- Admin Doctors MasterData contract
- Phase-3 MasterData contract
- Phase-3 migration safety
- Phase-3 canonical filtering
- P12 geographic consistency
- P12 geographic helper
- Phase-4 performance contract
- runtime roles contract
- P12 booking/auth flow contract
- notification lifecycle idempotency
- notification Phase-2 contract
- Phase-1 auth
- Phase-1 onboarding
- email verification crypto
- email verification concurrency (1/1)
- doctor approval concurrency (4/4)
- onboarding mass-assignment
- Phase-1 admin registration email

Backend JavaScript syntax validation covered **344 backend `.js` files with 0 syntax failures**.

Frontend lazy-route import resolution covered **92 lazy imports with 0 missing relative targets**.

## 17. Dependency validation

### Frontend

`npm install --ignore-scripts --no-audit --no-fund` timed out in the available environment.

Offline retry failed because the npm cache did not contain:

`zod-validation-error-4.0.2.tgz`

Consequently:

- `npm run lint` = **BLOCKED** (`eslint: not found`)
- `npm run build` = **BLOCKED** (`vite: not found`)

### Backend

Offline installation failed because the npm cache did not contain:

`yauzl-3.3.0.tgz`

The full backend test runner therefore executed with missing runtime dependencies and ended with:

**67 passed / 48 failed / 115 total**

The representative blocker is:

`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'mongoose'`

The 48 failures are therefore not treated as a clean application-test pass.

## 18. Runtime / database verification

**BLOCKED**.

The uploaded repository did not contain a backend `.env`, MongoDB was not available in the execution environment, and dependency installation could not complete.

Therefore the following were not falsely marked as verified:

- actual LGD import into MongoDB
- actual State → District → City records
- live SUPER_ADMIN approval → public visibility transition
- live service publish/archive workflow
- live article publish/archive workflow
- browser verification
- production frontend build

## 19. Security / role checks

Runtime roles remain exactly:

- `SUPER_ADMIN`
- `DOCTOR`
- `PATIENT`

No `ADMIN` or `RECEPTIONIST` runtime role was introduced.

No fake doctors, patients, appointments, or healthcare professionals were added.

## 20. Remaining limitations

The repair is intentionally reported as **PARTIALLY COMPLETED** because the environment prevented the final live-data and build gates.

The remaining execution steps for a real deployment environment are:

1. Obtain the intended LGD export snapshot and record its exact retrieval date/version.
2. Place the three required LGD CSV exports under `backend/master-data/source/lgd/` or configure their paths through environment variables.
3. Connect the intended production/staging MongoDB.
4. Run `npm run migrate:master-data:lgd`.
5. Run the existing backend seed to create the service/article catalog using the real SUPER_ADMIN seed actor.
6. Install dependencies from the repository lockfiles.
7. Run frontend lint/build.
8. Run the complete backend suite with dependencies installed.
9. Start backend/frontend and execute the browser acceptance flow.
10. Verify the real public API against the populated database.

No claim of COMPLETE should be made until those gates are actually observed passing.
