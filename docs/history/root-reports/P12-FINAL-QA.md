# P12 Final Closure QA — Evidence Report

## Scope
Doctor Discovery + Geographic Intelligence + Availability + Patient Booking Boundary.
P13/P14/P15 features were not implemented.

## Implemented in this closure pass
- Fixed the public coverage aggregation runtime self-reference and verified filtered location stages are appended to the original location stages.
- Unified primary/clinic geographic matching for state + district + city using a single location object.
- Public coverage now applies the same geographic semantics as public doctor search.
- Clinic-only geographic discovery is supported.
- State/district/city selector hierarchy is data-backed; district is disabled until state is selected; incompatible district/city state is reset together with the URL.
- India map is secondary to doctor results and is collapsible on mobile; accessible selector remains available.
- Public doctor result cards now use one bounded batch availability request instead of one HTTP request per card.
- Batch availability reuses the existing appointment capacity/slot engine and existing leave/appointment rules.
- Same-day past slots are excluded from both next-availability discovery and the patient available-slots endpoint using the existing UTC business-date convention.
- Doctor profile shows district and clinic district; coordinates are never invented and a map/location affordance is shown only when real coordinates exist.
- Modal gained dialog semantics, focus handling, Escape handling and body scroll locking.
- Booking remains patient-only at the backend route boundary and preserves the controlled booking intent.
- Registration against a booking intent is forced to patient role; non-patient sessions are cleared before patient authentication.

## Tests actually executed successfully
- `node backend/tests/p12GeographicHelper.test.mjs` — PASS
- `node backend/tests/p12GeographicSearchConsistency.test.mjs` — PASS
- `node backend/tests/p12BookingAuthFlow.test.mjs` — PASS
- `node backend/tests/capacityAggregates.test.mjs` — PASS
- `node backend/tests/slotEngine.test.mjs` — PASS
- `node --check backend/controllers/publicController.js` — PASS
- `node --check backend/controllers/appointmentController.js` — PASS
- `node --check backend/utils/capacityAggregates.js` — PASS
- `node --check backend/utils/geographicSearch.js` — PASS
- Locale module import validation for English/Hindi/Hinglish — PASS

## Backend full-suite result
Command: `npm run test:backend`

Result: **NOT PASS** — 37 passed, 38 failed, 75 total.
The failures are dependency/environment related in this extracted package: the failing tests report `ERR_MODULE_NOT_FOUND: Cannot find package 'mongoose'` because `backend/node_modules` is absent. The dependency-backed tests were therefore not valid evidence of application failures.

## Frontend lint
Command: `npm run lint`

Result: **NOT PASS / BLOCKED** — `eslint: not found` because root `node_modules` is absent.

## Frontend build
Command: `npm run build`

Result: **NOT PASS / BLOCKED** — `vite: not found` because root `node_modules` is absent.

## Dependency installation
Command: `npm install --no-audit --no-fund`

Result: **BLOCKED** — command timed out in the sandbox before dependencies could be installed.

Command: `npm install --offline --no-audit --no-fund`

Result: **FAILED / environment limitation** — npm reported `ENOTCACHED` for `https://registry.npmjs.org/leaflet`; the required package metadata was not available in the local npm cache.

A package-lock-only attempt also timed out. The root `package-lock.json` root package metadata was synchronized with the new Leaflet dependencies, but a complete lockfile regeneration could not be completed in the sandbox.

## Fresh-extract verification
The final archive must be freshly extracted and checked before delivery. No completion claim is made until that verification is performed.

## Final status
# P12 NOT COMPLETE

### Exact blockers
1. Root dependency installation timed out, leaving `eslint` and `vite` unavailable.
2. Full backend suite cannot run because backend dependencies (notably `mongoose`) are not installed in the extracted environment.
3. Therefore the mandatory fresh frontend build/lint and dependency-backed backend verification gate cannot truthfully be marked PASS.
