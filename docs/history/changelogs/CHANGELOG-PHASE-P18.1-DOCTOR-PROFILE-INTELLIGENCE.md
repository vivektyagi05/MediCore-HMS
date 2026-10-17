# MediCore HMS — P18.1 Doctor Profile 3.0 Intelligence Upgrade

## Scope
P18.1 strengthens the existing Doctor Profile ecosystem. No parallel Doctor model, public Doctor collection, profile store, appointment engine, or notification architecture was introduced.

## Architecture audit
- Existing `Doctor` remains the canonical professional profile record.
- `User` remains the identity/account owner through `Doctor.userId`.
- Existing Practice APIs, verification, documents, schedule/slot engine, reviews, public search/profile, compare, and booking flows remain the authoritative integrations.
- Existing `doctorPublicSerializer` remains the public serialization boundary.

## New/strengthened capability
- Added `backend/services/doctorProfileIntelligenceService.js` as a deterministic profile-quality/attention service.
- Profile quality is weighted from actual Doctor fields; no random or frontend-only score is used.
- Added category scores for identity, credentials, practice, and discoverability.
- Added backend-driven attention items and public-readiness blockers.
- Added stable Doctor identity metadata to the intelligence response for real public preview navigation.
- Refactored the existing practice controller to delegate profile-intelligence rules to the dedicated service.

## Doctor UX
- Existing Profile Strength page is upgraded into a Profile Command Center.
- Shows profile quality, category readiness, trust score, verification progress, public presence, attention items, and real navigation actions.
- Professional Profile editor now uses sectional navigation rather than rendering every collection as one long page.
- Added unsaved-change detection and browser navigation protection for profile edits.
- Save controls are disabled when there are no unsaved profile changes.
- Credential re-verification warning is surfaced in the editor.

## Public/Admin integration
- Public preview opens the actual `/doctors/:doctorId` route using the canonical Doctor ID from the server.
- Existing Admin Doctor workspace and public serializer were retained rather than duplicated.

## i18n
- P18.1 strings are present in English, Hindi, and Hinglish with parity verified.

## Tests
- `backend/tests/p18_1ProfileIntelligence.test.mjs` — PASS
- `backend/tests/p18DoctorProfileContract.test.mjs` — PASS
- Backend syntax audit — PASS (388 JS/MJS files)
- Frontend TypeScript parser check — PASS
- Locale parity — PASS (102 keys x 3)

## Runtime status
Full browser/MongoDB/production runtime E2E remains environment-dependent. Do not claim P18.1 complete until the real Doctor edit → MongoDB → admin → public search/profile → availability → booking browser flow is executed successfully.
