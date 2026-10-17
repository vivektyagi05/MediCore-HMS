# MediCore HMS — Master Data + Doctor Onboarding Location Flow Remediation
**Date:** 2026-09-24
**Scope:** State → District → City master-data flow in doctor onboarding /
professional-profile forms. The Appointment Engine checkpoint
(`MediCore-HMS-APPOINTMENT-ENGINE-CHECKPOINT-2026-09-24.zip`) is untouched by
this pass except where explicitly noted below.

---

## 1. Root cause

**The reported symptom — "predefined State/District/City options are not
reliably appearing, forcing the user to Other/manually enter" — was real, but
only for City.** State and District were already correct, working canonical
dropdowns before this pass. City was the one level implemented as a **plain
free-text input** in the shared `DoctorLocationFields` component
(`src/components/doctor/DoctorLocationFields.jsx`); there was no city
`<select>` for the user to see canonical options in at all, so "predefined
options not appearing" for city was not a bug in the data/API layer — it was
the intended (but incomplete) design of that one field.

The entire rest of the chain — source data → importer → MongoDB → API →
backend validation → Doctor record → reload — was **already fully built,
tested, and correct** for City, symmetrically with State/District. This was
verified by tracing the code (Section 2), not assumed.

## 2. Existing architecture (traced, not assumed)

Every layer was inspected before any code was changed, per the mission's
Phase 1/2 instruction not to "immediately change React code" or "report
frontend bug" without checking backend/API/DB first.

| Layer | File(s) | Status found |
|---|---|---|
| Source data | `backend/master-data/source/lgd/*.csv` + `MANIFEST.json` | Present, real LGD data: 36 states, 784 districts, ~35k ULB/city rows, checksummed in the manifest. |
| Importer | `backend/migrations/005_import_lgd_master_data.js` | Deterministic, idempotent (upsert by kind+normalizedName+parentId), duplicate-safe, hierarchy-safe. Already correct. |
| MongoDB model | `backend/models/MasterData.js` | Single polymorphic collection (`kind`: state/district/city/specialization), `parentId`, `active`, unique compound index. Already correct. |
| Backend API | `backend/routes/masterDataRoutes.js`, `masterDataController.js` | `GET /api/master-data/{states,districts,cities,specializations}`, parent-filtered, mounted at `/api/master-data`, no auth required (correct — needed pre-login during onboarding). Already correct. |
| Resolution/validation | `backend/services/masterDataService.js` (`resolveDoctorMasterData`, `applyDoctorMasterData`, `assertHierarchy`) | Generic MASTER/OTHER resolution **identical for state, district, and city**: an id resolves and is hierarchy-checked against its parent; a district-of-wrong-state or city-of-wrong-district is rejected (422); a typed city is matched by exact name **scoped to the selected district only** (never a global match) and falls back to OTHER. Already correct — this is the part of the system that made the fix possible without any backend changes. |
| Doctor model | `backend/models/Doctor.js` | `stateMasterId`/`districtMasterId`/`cityMasterId` + parallel `*Type`/`*Other` fields, symmetric across all three levels. Already correct. |
| Doctor onboarding/profile controllers | `doctorOnboardingController.js`, `practiceController.js` | Call the same generic `applyDoctorMasterData` for all three levels; profile reload returns the stored ids/types directly. Already correct. |
| **Frontend hook** | `src/hooks/useLocationOptions.js` | **Gap.** Fetched `states` and `districts` only. No `cities` fetch existed at all. |
| **Frontend form model** | `src/utils/doctorLocation.js` | **Gap.** City was special-cased to always be free text (`setCityText`), bypassing the generic MASTER/OTHER model used for state/district. |
| **Frontend component** | `src/components/doctor/DoctorLocationFields.jsx` | **Gap.** City was rendered as `<input type="text">`, never as a `<select>` — this is the actual, sole, root cause of the reported symptom. |

## 3. What was already correct (do not re-read as "fixed")

- Source data, importer, MongoDB schema, master-data API, hierarchy
  validation, Doctor model, and both onboarding/profile controllers — see
  the table above. None of these needed or received any code change.
- State and District were already real dropdowns end-to-end, with correct
  reset-on-parent-change semantics, loading/error states, and an "Other"
  free-text fallback.
- The exact-match-to-canonical resolution for a typed city (`resolveDoctorMasterData`'s
  `isTypedCity` path, `masterDataService.js`) — this existing, tested
  behavior (`backend/tests/masterDataResolution.test.mjs`) is what a plain
  free-text city field relied on, and it is retained unchanged as the
  server-side backstop for any caller (including this fix's own "Other"
  city text box, and any future/legacy client) that still sends a typed
  city value.
- GET client-side caching (`src/api/axios.js`): cache keys already include
  the serialized query params, so `states`/`districts?parent=X`/`cities?parent=Y`
  never collide; only successful responses are cached; a 401 clears the
  whole cache. No change needed.
- Admin doctor search/filter (`src/pages/admin/AdminDoctors.jsx`) already
  has its own correct State→District→City filter dropdown chain, entirely
  independent of the doctor-facing onboarding/profile forms. Unaffected by
  this pass.

## 4. Implemented fix (frontend only)

No backend, database, migration, or API change was made or was necessary.

1. **`src/hooks/useLocationOptions.js`** — added a third fetch stage: cities
   keyed off the selected district's master id, symmetric with how
   districts are keyed off the selected state (same stale-response-discard
   pattern via effect cleanup, same "currently loaded for this parent"
   `forId` bookkeeping).
2. **`src/utils/doctorLocation.js`** — removed `setCityText` and City's
   bespoke "always free text" branch from `locationFromDoctor` and
   `buildLocationPayload`. City now goes through the exact same generic
   MASTER/OTHER helpers (`changeLevel`, `levelFromDoctor`, `levelPayload`,
   `selectValueFor`) already used for State and District. City payload is
   only ever sent once a district has been chosen (mirrors the existing
   state→district gating).
3. **`src/components/doctor/DoctorLocationFields.jsx`** — City is now a
   `<select data-testid="location-city">` populated from
   `useLocationOptions`'s `cities`, disabled until a district is chosen,
   with an explicit **"Other"** option that reveals a free-text "Other
   city/locality" input — so a locality outside the canonical dataset can
   still be entered and saved (per the mission's explicit instruction not
   to remove that ability). If the district itself is "Other" (no
   canonical district), city is forced to a free-text box (a district that
   doesn't exist in the master data can have no canonical cities under it
   either) — this mirrors the existing state-Other→district-text pattern.
   Loading/error text was added for the city select
   (`"Loading cities…"` / `"Select a district first"` /
   `"Could not load cities for this district."`), matching the existing
   state/district pattern from Phase 14 of the mission.

## 5. Master data counts (traced from the source manifest and importer, not live-queried)

No live MongoDB was reachable in this sandbox (see Section 8), so counts
below are read from `backend/master-data/source/lgd/MANIFEST.json` and the
CSV row counts, not a live `db.masterdatas.countDocuments()`:

- States: 36 rows (`states.csv`)
- Districts: 784 rows (`districts.csv`)
- Cities/local bodies: ~35,000 rows (`statewise_ulbs_coverage.csv`)
- Specializations: seeded separately (unchanged, unaffected by this pass)

These are **NOT VERIFIED against a live MongoDB import** — see Section 8.
The importer itself (`005_import_lgd_master_data.js`) was traced and is
idempotent/duplicate-safe by construction (upsert on
`kind+normalizedName+parentId`), so a re-run cannot inflate these counts,
but no environment was available in this sandbox to actually execute it
against a database and confirm the resulting collection counts.

## 6. API verification

Verified by code inspection (route → controller → service), not a live HTTP
call (no reachable server+DB — Section 8):

- `GET /api/master-data/states` → no auth required, returns `active` states
  sorted by name (`masterDataService.listMasterData`).
- `GET /api/master-data/districts?parent=<stateId>` → 400 if `parent` is
  missing/not a valid ObjectId, 422 if `parent` doesn't resolve to an
  `active` `state` document (`listMasterData`'s parent-kind check),
  otherwise only districts with that `parentId`.
- `GET /api/master-data/cities?parent=<districtId>` → same shape, parent
  must resolve to an `active` `district`.
- Confirmed no full-table city response is ever possible: `cities` always
  requires `parent`; `masterDataApi.getCities(districtId)` short-circuits to
  `[]` client-side when no district id is passed at all, so the frontend
  never even attempts to call the endpoint without a parent.

This behavior is covered by
`backend/tests/masterDataResolution.test.mjs`'s
`"listMasterData: district/city require an existing parent of the right kind"`
and `"...correct parent returns only its children (no cross-parent leakage)"`
tests, which passed unchanged (backend untouched).

## 7. Frontend / onboarding / profile-reload verification

Verified by code inspection and by the updated unit test suite
(Section 10) — **not** by a live browser (Section 8):

- `DoctorOnboarding.jsx` and `DoctorProfessionalProfile.jsx` both consume
  `DoctorLocationFields` + `buildLocationPayload`/`locationFromDoctor`
  generically via `LOCATION_KEYS` — neither page needed any change; the fix
  is entirely inside the three shared files in Section 4.
- State→District→City reset semantics (changing a parent clears every
  field below it, including the newly-added city fields) verified in
  `doctorLocationForm.test.mjs`'s `"state change clears district + city"`
  and `"district change clears city only"` tests.
- Save→reload round-trip (`locationFromDoctor` reading back exactly what
  `buildLocationPayload` + `applyDoctorMasterData` would have stored,
  including the OTHER-city case where the server-stored display name is
  the literal string `"Other"` and the real text lives in `cityOther`) is
  verified in `"stored OTHER city is restored as OTHER, not as a display
  name"`.
- The jsdom-based **manual** UI verification scripts
  (`backend/scripts/ui-verification/locationFields.harness.jsx` and
  `doctorForms.harness.jsx` — explicitly documented in their own header
  comments as "NOT part of `npm test`", requiring a running backend+DB)
  were updated to assert the new dropdown behavior instead of the old
  free-text behavior, since they are written against a real server. They
  were **not executed** in this pass — no reachable backend+DB (Section 8).

## 8. Live end-to-end verification — NOT VERIFIED — ENVIRONMENT LIMITATION

No MongoDB was reachable in this sandbox:
- `mongodb-memory-server` attempted to download its `mongod` binary and
  failed — the download host is not on this environment's network
  allow-list.
- No external `MONGO_URI` was provided.

This is the same limitation every prior checkpoint in this project has
hit and disclosed (see `CHECKPOINT-STATUS-2026-09-23.md`,
`APPOINTMENT-ENGINE-REMEDIATION-2026-09-24.md`). Consequently, the
following from the mission's Phase 16 checklist are **explicitly NOT
verified** in this pass, and are not claimed as verified anywhere in this
document or the final response:
- Actual live MongoDB counts for imported states/districts/cities.
- A live `GET` round-trip through the running Express server.
- A live browser mount of the onboarding/profile pages exercising the new
  city `<select>` against a live API (the jsdom harnesses that would do
  this were updated, per Section 7, but not run).
- Live save→reload through an actual doctor record.

What **was** verified in this sandbox instead: full static/unit-level
correctness (Section 10), a clean production build, and 0 ESLint errors.

## 9. Admin doctor edit (Phase 12) — separate finding, not fixed here

The mission asked this pass to check whether the previously-reported
"admin doctor edit is not working" issue involves master data. It was
traced: **`src/pages/admin/AdminDoctors.jsx` (the only admin-side doctor
page) has no location-field-editing UI at all** — it only offers
search/filter (which does have its own, working, independent State→
District→City filter chain — Section 3) and approve/reject actions. There
is no admin flow anywhere in the codebase that edits a doctor's own
`state`/`district`/`city`/`cityMasterId` fields; only the doctor
themselves can, via onboarding/profile (now fixed).

**Conclusion: this is unrelated to master data and was not fixed in this
pass**, per the mission's own instruction ("If the failure is unrelated to
master data: DOCUMENT IT as a separate remaining issue... Do not redesign
all admin doctor editing in this phase"). Whatever the original "admin
doctor edit is not working" report referred to, it is not a location-field
bug — it may refer to the approve/reject flow, which was already
extensively audited and fixed in earlier phases (PHASE 2-C, see
`/areas/medicore-hms.md`), or to a feature (editing a doctor's own profile
fields as an admin) that simply does not exist yet.

## 10. Cache behavior (Phase 13)

Traced `src/api/axios.js`'s GET cache (Section 3): correct as-is, no
change made. Cache keys are `token:url:sortedParams`, so state/district/city
requests for different parents never collide, and only *successful*
responses are ever cached (a rejected promise is never written to
`getCache`), so a transient API failure can't get "stuck" as a cached
empty/error result. `cacheTtlMs: 300000` (5 min) on all four
`masterDataApi` methods is unchanged from before this pass. Cache is
cleared entirely on 401 logout, and the interceptor pattern means any
mutation elsewhere in the app never leaves a stale master-data cache entry
that would matter here (master data is never mutated by the app itself —
only by the migration, which runs at deploy time, before any user
requests come in).

## 11. Tests

- **Rewrote** `backend/tests/doctorLocationForm.test.mjs` (16 assertions):
  covers changeLevel/clearing semantics for all three levels including the
  new city select, the OTHER-city display-name round-trip, and
  `buildLocationPayload`'s gating (a city selection is dropped if no
  district is chosen). The previous version of this file asserted the OLD
  free-text city behavior as correct and has been fully replaced, not
  appended to.
- **Updated** `backend/tests/finalDataFlowContract.test.mjs`: its
  assertions about `DoctorLocationFields.jsx` previously *required* a
  city `<input type="text">` and *forbade* `cities.map` — i.e. it was
  actively locking in the bug. Updated to require the new
  `options.cities.map` dropdown and the "Other city/locality" fallback
  instead. Its unrelated assertions (master API shape, DoctorSearch,
  `masterDataService.js`'s `isTypedCity`/`getMasterByName` contract,
  `doctorController.js` RBAC) are untouched.
- **Updated** (not executed — Section 8) the two live-server jsdom
  scripts under `backend/scripts/ui-verification/` to assert dropdown
  behavior for city instead of free text.
- No backend logic changed, so `masterDataResolution.test.mjs`,
  `phase3MasterDataContract.test.mjs`,
  `adminDoctorsMasterDataContract.test.mjs`, and
  `masterDataLgdImportContract.test.mjs` needed no changes and pass
  unmodified.
- Full suite: **145 passed, 0 failed (145 total)** — same total as the
  incoming Appointment Engine checkpoint baseline (one test file's content
  was rewritten in place, not added, so the count is unchanged).

## 12. Lint / build

- `eslint .` (repo root): **0 errors, 0 warnings.**
- `vite build`: clean, no new warnings beyond the pre-existing "chunk >
  500kB" advisory notice (unrelated, pre-existing, not part of this
  scope).
- `node --check` on every backend `.js` file: clean (backend untouched,
  re-verified anyway).

## 13. Fresh-extract gate

Performed against the final zip named in Section 16: extracted into a
clean directory, `npm install` (root) and `npm install` (`backend/`) from
scratch, `npm test` (backend), `eslint .`, `vite build` — see Section 16
for the exact result.

## 14. Multi-clinic location fields — separate, pre-existing gap, not fixed here

While tracing "every doctor location form" (mission Phase 11), the
`clinics` array on the Doctor model (`backend/models/Doctor.js`) was found
to carry its own parallel `city`/`cityMasterId`/`cityType`/`cityOther`
(and state/district) fields, resolved server-side by the same generic
`resolveDoctorMasterData` machinery (`practiceController.js`, with
`allowLegacyOther: true`). However, **the clinic-editing UI
(`src/pages/doctor/DoctorPracticeSettings.jsx`) has no state/district/city
fields in it at all** — a clinic's location cannot currently be entered
through the UI in any form (text or dropdown).

This is a real, pre-existing gap, but it is **not the reported bug** (the
report was specifically about doctor onboarding/profile, which do not use
the `clinics` array) and building clinic location UI from scratch is a
new feature, not a fix to existing broken behavior — out of the mission's
strict scope ("Do NOT start... unrelated... redesign"). Documented here
per the mission's own instruction to document rather than silently expand
scope.

## 15. Security / validation

Unchanged (backend untouched) and already correct, re-confirmed by
inspection: hierarchy validation rejects a district that doesn't belong to
the selected state and a city that doesn't belong to the selected
district (422, `masterDataResolution.test.mjs`'s cross-district/cross-state
tests), an unknown or malformed master id is rejected (400/422), and
`active: false` master records are excluded from both `listMasterData` and
resolution lookups.

## 16. Remaining issues / limitations

- **NOT VERIFIED — ENVIRONMENT LIMITATION**: no live MongoDB in this
  sandbox (Section 8). This is a recurring, disclosed limitation across
  every checkpoint in this project, not something introduced or newly
  discovered in this pass.
- Admin doctor edit (Section 9): no location-editing feature exists for
  admins; unrelated to master data; not built in this pass.
- Multi-clinic location UI (Section 14): does not exist yet; unrelated to
  the reported bug; not built in this pass.
- The `isTypedCity` exact-name-match-to-canonical fallback in
  `masterDataService.js` (kept, unchanged) means a user who explicitly
  picks "Other" for city and then types the exact name of a real city in
  that same district will still be silently linked to the canonical
  record rather than staying OTHER. This is pre-existing, intentional,
  tested behavior (`masterDataResolution.test.mjs` line 34-37,
  `masterDataService.js`'s own doc comment), not something this pass
  introduced — flagged here only for completeness, not as a defect to
  fix.
- All items from `CHECKPOINT-STATUS-2026-09-23.md`'s own Section C not
  related to master data (storage abstraction, CMS/analytics truthfulness,
  broader DB integrity audit, the six final closure deliverable docs, live
  E2E generally) remain open — untouched, per strict scope.

## 17. Addendum (2026-09-25) — re-verification + a real cache bug this pass missed

A follow-up pass, requested specifically to re-diagnose the "state list is
empty on the server" symptom against this same checkpoint.

**Environment limitation unchanged**: still no reachable MongoDB in this
sandbox — `mongodb-memory-server` still fails to download `mongod`
(`fastdl.mongodb.org` still not on the network allow-list). Nothing below
substitutes for actually running the migration against your live `hms_pro`
database and hitting the running API — see the checklist at the end of this
section for exactly what to run there.

Re-verified from scratch (fresh `npm install`, root + backend):
- `eslint .`: 0 errors/warnings.
- `vite build`: succeeds.
- `npm test` (backend): 145 passed, 0 failed. Reconfirmed these are mostly
  static contract tests (regex-matching source files, e.g.
  `phase3MasterDataContract.test.mjs`), not live-DB integration tests —
  passing them says the code shape is right, not that any particular
  MongoDB instance currently has the data loaded.
- `loadLgdSource()` executed standalone (no DB needed — it's a pure
  file-parsing function): all three MANIFEST.json checksums match the
  files on disk, and it resolves cleanly to 36 states / 784 districts /
  5,112 unique city records (from 35,008 raw coverage rows — the
  difference is expected de-duplication by (district, name), not a parsing
  failure or data loss; `loadLgdSource` throws loudly on any row it can't
  resolve, and it didn't).

**Correction to Section 10 above.** Section 10 concluded the GET cache
needed "no change" because it only caches *successful* responses. That's
true but incomplete: it doesn't distinguish a successful non-empty response
from a successful *empty* one. In practice, if a browser tab requests
`/master-data/states` (or districts/cities) before the LGD import has been
run — which is exactly the state a developer's local environment is in
right before running `npm run migrate:master-data:lgd` for the first time —
that empty response gets cached for the full `cacheTtlMs` (300,000ms / 5
minutes). Running the migration in another terminal doesn't invalidate it;
only a full page reload happening to land outside that 5-minute window
would. This is a plausible, real contributor to seeing the empty-state
message persist even after a migration is run, on top of (and independent
from) the "did the migration actually run against this DB" question in the
main root-cause list.

**Fix applied this pass:**
- `src/api/axios.js`: the GET cache now accepts an optional
  `shouldCache(response)` predicate on the request config; a response is
  only written to the cache if there's no predicate, or the predicate
  returns `true`. Every other GET call in the app is unaffected (no
  predicate passed → same behavior as before).
- `src/api/masterDataApi.js`: all four master-data calls
  (`getSpecializations`, `getStates`, `getDistricts`, `getCities`) now pass
  a predicate that refuses to cache a response whose unwrapped list is
  empty, so an empty result is retried on the next request instead of
  being pinned in memory for 5 minutes.

Re-verified after the change: `eslint .` clean on the two touched files,
`vite build` still succeeds. No frontend unit-test suite exists in this
repo to exercise `axios.js` directly.

**What this fix does and doesn't explain.** It closes off client-side
staleness as a cause going forward. It does **not** by itself prove your
local `hms_pro` has state data — if `db.masterdatas.countDocuments({kind:
"state", active:true})` is genuinely `0` in the database your backend
process is connected to, the dropdown will still correctly report empty
(that's the intended, honest error state, not a bug) until the migration is
actually run against that database.

**Exact checklist for your own environment** (none of this can be executed
from this sandbox):

```bash
# Which URI does your running backend actually use?
grep MONGO_URI backend/.env

# Does that database actually have state master data yet?
mongosh "<same URI>" --eval 'db.masterdatas.countDocuments({kind:"state",active:true})'
# expect 36; if 0, the import hasn't landed in this DB

# Run the real import against that exact URI
cd backend && npm run migrate:master-data:lgd

# Re-check, then hit the API directly (bypasses React + the cache entirely)
curl http://localhost:5000/api/master-data/states
```

If the count is already 36 and the `curl` already returns real states, the
cache bug fixed in this pass was the whole story and a hard reload of the
onboarding page should now show them immediately. If the count is 0, the
migration genuinely hasn't run against this database yet — that's Phase 2
of the original mission (backend runtime vs. migration pointing at
different databases), and only you can check `backend/.env` in your actual
running setup to confirm which case you're in.

