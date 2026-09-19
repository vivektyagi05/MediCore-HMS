# PHASE 3 — MASTER DATA + DATA CONSISTENCY REPORT

## Actual repository findings

- Doctor professional data was stored primarily as free-text `specialization`, `state`, `district`, and `city` fields.
- Doctor onboarding and Professional Profile both wrote these fields independently.
- Public search metadata was built from `Doctor.distinct(...)`, creating a database-derived source separate from a canonical master-data layer.
- Public geographic filtering already preserved primary-location/clinic pairing through `backend/utils/geographicSearch.js`.
- Existing Doctor records contain real values but there was no dedicated canonical State/District/City/Specialization master-data collection.
- Admin doctor listing supported specialization filtering but did not expose state/district/city filters.
- Existing doctor approval, notification, Socket.IO, Brevo, authentication, and Phase-1 verification flows were not changed.

## Canonical architecture selected

A single `MasterData` MongoDB collection is now the server-authoritative source for:

- `specialization`
- `state`
- `district`
- `city`

Each master value has a deterministic normalized name and optional parent:

`State -> District -> City`

The collection has a unique `(kind, parentId, normalizedName)` index.

Doctor records retain their existing string fields for compatibility with existing search, serializers, reports, and downstream consumers. New canonical references are stored alongside them:

- `specializationMasterId`, `specializationType`, `specializationOther`
- `stateMasterId`, `stateType`, `stateOther`
- `districtMasterId`, `districtType`, `districtOther`
- `cityMasterId`, `cityType`, `cityOther`

The master-data reference/type fields are authoritative for new writes; the existing strings remain the compatibility/display projection.

## API changes

Added read-only server-authoritative APIs:

- `GET /api/master-data/specializations`
- `GET /api/master-data/states`
- `GET /api/master-data/districts?parent=<stateMasterId>`
- `GET /api/master-data/cities?parent=<districtMasterId>`

Responses are bounded and deterministically ordered.

Server-side validation rejects:

- invalid master IDs
- inactive/unknown master values
- district/state mismatches
- city/district mismatches
- canonical child values without their required canonical parent
- invalid/empty/whitespace-only `OTHER`
- oversized `OTHER` values

## Migration decision

No existing Doctor data is silently guessed or rewritten into an unrelated value.

Added:

`backend/migrations/004_master_data_backfill.js`

The migration promotes only real values already present in Doctor records into `MasterData` and backfills their canonical reference/type fields. Where a relationship cannot be established from existing persisted data, the original value is preserved as `OTHER` rather than guessing a State/District/City relationship.

The migration is also available through:

`npm run migrate:master-data`

It was not executed against a live database in this environment because no usable MongoDB/dependency environment was available.

The migration is intentionally not run on every server boot, avoiding an unnecessary full Doctor collection scan during normal startup.

## Doctor onboarding

Updated the existing onboarding flow to:

- load canonical specializations and states
- load districts only for the selected state
- load cities only for the selected district
- clear dependent selections when the parent changes
- support controlled `OTHER`
- submit canonical master IDs/type/value metadata
- validate the same relationships server-side

Existing onboarding authorization, pending status, verification history, and mass-assignment protections remain intact.

## Professional Profile

Updated the existing Professional Profile primary specialization/location flow to use the same master-data API and server validation.

Professional profile writes now use the same canonical resolution logic as onboarding.

Clinic location updates are normalized/validated through the same State/District/City resolver while preserving the existing clinic model.

Credential-change re-verification behavior remains unchanged.

## Admin doctor management

Admin doctor listing now supports server-side:

- specialization
- state
- district
- city

filters.

The Admin Doctor creation form uses canonical specialization values and controlled `Other`.

## Public doctor discovery

Public search metadata now reads specialization/state/district/city options from `MasterData` instead of independently constructing those lists from arbitrary Doctor strings.

Existing approved-doctor visibility rules and geographic filtering remain intact.

## Security / validation

- Frontend dropdowns are not trusted.
- Master-data IDs are validated server-side.
- Parent-child relationships are validated server-side.
- `OTHER` is explicit and length-bounded.
- Raw arbitrary text is not treated as a canonical master value.
- Existing doctor verification fields remain outside onboarding/profile master-data payload authority.
- Existing mass-assignment protection remains active.
- AI/payment architecture was not changed.

## Tests actually executed

### PASS

- `phase3MasterDataContract.test.mjs`
- `onboardingMassAssignment.test.mjs`
- `p12GeographicHelper.test.mjs`
- `notificationLifecycleIdempotency.test.mjs`
- `notificationPhase2Contract.test.mjs`
- `emailVerificationCrypto.test.mjs`
- `emailVerificationConcurrency.test.mjs`
- `phase1AdminRegistrationEmail.test.mjs`
- `phase1AuthContract.test.mjs`
- `phase1OnboardingContract.test.mjs`
- `runtimeRolesContract.test.mjs`
- `doctorApprovalConcurrencyRace.test.mjs`

All of the above actually executed successfully in the supplied environment.

### Could not execute

`p12Geography.test.mjs` could not execute because the environment has no installed `mongoose` package.

The complete backend suite was attempted with:

`node tests/run-all.mjs`

It could not complete because the supplied repository has no usable installed backend dependencies; execution repeatedly failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'mongoose'`.

Frontend validation was attempted:

- `npm run lint` → could not execute: `eslint: Permission denied`
- `npm run build` → could not execute: `vite: Permission denied`

Therefore no full backend suite, frontend lint, or frontend build is claimed as PASS.

## Syntax verification

`node --check` passed for all modified backend JavaScript files, including:

- MasterData model
- master-data service/controller/routes
- Doctor model
- onboarding controller
- Professional Profile controller
- admin Doctor controller
- public controller
- Doctor controller
- migration
- validation utility
- Phase-3 contract test
- app/server wiring

## Remaining environment limitations

- No installed backend `node_modules`, including `mongoose`.
- Frontend `eslint` and `vite` binaries are unavailable/permission-blocked.
- No live MongoDB migration execution was possible in this environment.
- Consequently, live database schema/index creation and end-to-end browser validation remain environment-dependent.

No Phase 4 work was performed.
No AI/payment changes were made.
No notification/Socket.IO/Brevo redesign was made.

## Phase 3 Closure Patch — Canonical Filtering + Safe Legacy Migration

### Migration behaviour

The previous `bootstrapMasterDataFromDoctors()` behaviour was unsafe because it created canonical `MasterData` rows from arbitrary non-empty Doctor strings.

The closure patch replaces that behaviour with a repository-controlled deterministic seed source at:

`backend/master-data/canonicalSeed.js`

The seed intentionally contains only existing MediCore business terminology already present in the repository:

- General Medicine
- Cardiology
- Emergency Medicine
- Neurology

There is no authoritative State/District/City dataset in the supplied repository. The patch therefore does **not** manufacture geographic master values from legacy Doctor strings. Legacy geography remains:

- `type = OTHER`
- `masterId = null`
- original string preserved in the corresponding `*Other` field

Known seeded specialization values are promoted to `MASTER`.
Unknown/ambiguous values are preserved as `OTHER` and never create a new canonical master record.

Existing non-seed MasterData rows are retained for auditability but deactivated and marked `source = legacy`; they are not treated as active canonical values.

The migration remains deterministic and idempotent: a second execution reuses the same seeded records and does not create another canonical value for the same seed.

### Canonical filtering behaviour

Admin Doctor filtering now supports canonical ObjectId filters against:

- `specializationMasterId`
- `stateMasterId`
- `districtMasterId`
- `cityMasterId`

The preferred query parameters are also supported as requested (`specialization`, `state`, `district`, `city`) when their values are canonical ObjectIds. Existing text filters remain available for compatibility when a legacy string is supplied.

Canonical filters are validated for:

- valid ObjectId format
- correct MasterData kind
- active master value
- State → District relationship
- District → City relationship

A child-only canonical filter derives its persisted parent relationship instead of allowing an unrelated parent/child combination.

Public Doctor discovery applies canonical specialization filtering directly to `specializationMasterId` and canonical geography filtering to the corresponding master IDs. Primary Doctor location and clinic location continue to be matched as separate complete location objects, preventing cross-location combinations such as a primary State paired with an unrelated clinic City.

No canonical ID field is filtered with RegExp.

Existing Doctor display strings remain unchanged for compatibility and display.

### Index audit

The Doctor model already has individual indexes on:

- `specializationMasterId`
- `stateMasterId`
- `districtMasterId`
- `cityMasterId`

No duplicate or speculative indexes were added.

The existing MasterData unique index remains unchanged:

`{ kind: 1, parentId: 1, normalizedName: 1 }` with `unique: true`.

### Closure tests actually executed

PASS:

- `phase3MasterDataContract.test.mjs`
- `phase3MigrationSafety.test.mjs`
- `phase3CanonicalFiltering.test.mjs`
- `p12GeographicSearchConsistency.test.mjs`
- `onboardingMassAssignment.test.mjs`
- `phase1AuthContract.test.mjs`
- `phase1OnboardingContract.test.mjs`
- `emailVerificationCrypto.test.mjs`
- `emailVerificationConcurrency.test.mjs`
- `notificationLifecycleIdempotency.test.mjs`
- `notificationPhase2Contract.test.mjs`
- `doctorApprovalConcurrencyRace.test.mjs`

Modified backend files also passed `node --check` syntax validation.

### Full validation result

The complete backend suite was actually attempted and produced:

`67 passed, 43 failed (110 total)`

The failed tests are environment/dependency failures caused by the supplied repository lacking installed backend dependencies, with repeated:

`ERR_MODULE_NOT_FOUND: Cannot find package 'mongoose'`

`p12Geography.test.mjs` likewise could not execute because `mongoose` is unavailable.

Frontend validation was attempted but could not execute:

- `npm run lint` → `eslint: not found`
- `npm run build` → `vite: not found`

Therefore full backend, frontend lint, and frontend build are **not claimed as PASS**.

The live migration was not executed because no usable MongoDB/dependency environment was available.

No Phase 4 work was performed and no unrelated architecture was changed.
