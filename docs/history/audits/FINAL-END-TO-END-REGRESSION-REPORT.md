# MediCore HMS — Final End-to-End Regression Report

## Status

**PARTIALLY COMPLETED**

Source-level and targeted-contract repairs were implemented. Full lint/build, live MongoDB population, and browser runtime verification remain blocked because project dependencies and a live database are unavailable in this environment.

## Root causes

1. `masterDataApi` returned the Axios response envelope (`{ success, data }`) while `DoctorSearch` treated the result as an array, causing `specializations.map` to crash.
2. Doctor onboarding and professional profile used a city dropdown even though the required UX is a free-text city input.
3. City canonical resolution was not scoped to the selected district when resolving by name.
4. `/api/doctors` was publicly reachable and only filtered approval state for authenticated PATIENT requests; unauthenticated callers could receive non-public doctors.

## Implemented fixes

### MasterData API contract

`src/api/masterDataApi.js` now normalizes all list endpoints to `Promise<Array>`:

- `getSpecializations()`
- `getStates()`
- `getDistricts(stateId)`
- `getCities(districtId)`

Consumers were updated consistently.

### Doctor location UX

`DoctorOnboarding.jsx` and `DoctorProfessionalProfile.jsx` now use:

- canonical State dropdown
- canonical dependent District dropdown
- City free-text input

State changes clear district/city IDs and values. District changes clear city IDs and value.

The backend resolves a typed city as follows:

- exact canonical match under the selected district → `MASTER` + `cityMasterId`
- no exact match → `OTHER` + `cityOther`
- canonical city from another district cannot be accepted.

### Public doctor visibility

`backend/controllers/doctorController.js` now treats `/api/doctors` as a public-safe listing unless the caller is `SUPER_ADMIN`.

Non-SUPER_ADMIN callers require:

- linked User role `DOCTOR`
- User active
- Doctor `isVerified`
- Doctor `verificationStatus=approved`
- Doctor active

The dedicated admin doctor management API remains responsible for administrative visibility.

Existing public-controller visibility protections were preserved.

## MasterData source/import

The repository retains the LGD import pipeline:

`backend/migrations/005_import_lgd_master_data.js`

The migration expects documented LGD source files under:

`backend/master-data/source/lgd/`

It is deterministic/upsert-based and preserves canonical hierarchy.

**Database population: BLOCKED.**

No live MongoDB database was available and the complete LGD source snapshot was not present in the uploaded repository, so actual state/district/city counts cannot honestly be reported.

## Existing content

The repository already contains the persisted seed architecture for six meaningful healthcare services and six educational articles. The seed uses deterministic slugs/upserts.

**Database content counts: BLOCKED.**

No live MongoDB verification was possible.

## Targeted tests

Passed:

- `phase3MasterDataContract.test.mjs`
- `phase3MigrationSafety.test.mjs`
- `phase3CanonicalFiltering.test.mjs`
- `phase4PerformanceContract.test.mjs`
- `adminDoctorsMasterDataContract.test.mjs`
- `publicVisibilityContract.test.mjs`
- `masterDataLgdImportContract.test.mjs`
- `cmsSeedContract.test.mjs`
- `adminContentDashboardContract.test.mjs`
- `p12GeographicHelper.test.mjs`
- `doctorApprovalConcurrencyRace.test.mjs`
- `finalDataFlowContract.test.mjs`

Backend syntax checks passed for modified backend files.

## Frontend lint/build

**BLOCKED**

`npm ci --ignore-scripts --no-audit --no-fund` was attempted but did not complete in the available execution window.

No dependency upgrade was performed.

Therefore:

- `npm run lint` — BLOCKED
- `npm run build` — BLOCKED

These are not reported as passes.

## Backend full suite

**BLOCKED**

The repository has no installed backend dependencies in the current environment. Previous full-suite attempts are not reused as a false pass.

## Runtime verification

**BLOCKED**

A live MongoDB-backed frontend/backend browser session was not available.

Therefore these were not marked verified:

- real LGD records in MongoDB
- Rajasthan → Jaipur live selection
- pending doctor hidden in live public search
- approval changing live visibility
- live service publish/archive
- live article publish/archive
- browser network 403 verification

## Security / role constraints

No `ADMIN` or `RECEPTIONIST` runtime role was introduced.

Existing approved-only clinical routes continue to use `requireApprovedDoctor`.

Pending doctors retain access to:

- professional profile
- verification center
- verification document routes
- onboarding/profile persistence

Approved-only clinical workflows remain protected.

## Changed files

- `src/api/masterDataApi.js`
- `src/pages/public/DoctorSearch.jsx`
- `src/pages/doctor/DoctorOnboarding.jsx`
- `src/pages/doctor/DoctorProfessionalProfile.jsx`
- `src/pages/admin/AdminDoctors.jsx`
- `backend/services/masterDataService.js`
- `backend/controllers/doctorController.js`
- `backend/tests/finalDataFlowContract.test.mjs`
- this report

## Acceptance summary

| Area | Result |
|---|---|
| DoctorSearch response-shape crash | SOURCE VERIFIED |
| MasterData API array contract | SOURCE VERIFIED |
| Doctor city free-text UX | SOURCE VERIFIED |
| District-scoped city resolution | TARGETED TEST PASSED |
| Public `/api/doctors` approval filtering | SOURCE VERIFIED |
| Existing public doctor safeguards | SOURCE VERIFIED |
| Phase-4 performance contract | TARGETED TEST PASSED |
| MasterData actual MongoDB counts | BLOCKED |
| Services actual MongoDB count | BLOCKED |
| Articles actual MongoDB count | BLOCKED |
| Frontend lint | BLOCKED |
| Frontend build | BLOCKED |
| Backend full suite | BLOCKED |
| Browser runtime | BLOCKED |

The project is therefore **PARTIALLY COMPLETED**, not COMPLETE.
