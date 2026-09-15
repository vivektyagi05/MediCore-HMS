# Phase 18 — Doctor Profile 3.0

## Scope

Strengthened the existing Doctor profile architecture without introducing a second Doctor/Profile model or public shadow record.

## Existing architecture audited

- `Doctor` remains the canonical professional profile document linked one-to-one to `User`.
- Existing Doctor onboarding remains the credential/re-verification path.
- Existing Professional Profile and Practice Settings APIs remain the doctor-side practice management surface.
- Existing public Doctor Search/Profile/Compare routes continue to read the Doctor collection.
- Existing slot/availability engine and booking flow were not replaced.
- Existing Doctor verification/document architecture was retained.
- The existing `Service` model has no Doctor relationship; no unsupported Doctor→Service relationship was invented.

## P18 changes

- Added a canonical public Doctor serializer in `backend/services/doctorPublicSerializer.js`.
- Public profile/search/compare/featured/similar doctor responses now consume the canonical serializer.
- Public rating for profile/search is supplied from the existing Review data where the endpoint already aggregates reviews rather than requiring doctors to enter a rating.
- Added safe Doctor profile photo upload/replacement/deletion using existing `multer` + file-signature validation infrastructure.
- Profile photos are stored under `storage/doctor-profile` with cryptographically random filenames and served only through the public image route.
- Added 5 MB size limit, JPEG/PNG MIME+extension checks, signature validation, authorization, safe path handling, replacement cleanup, and deletion.
- Expanded the existing Professional Profile PATCH contract to cover identity/professional fields as partial updates with server validation.
- Credential changes on an already-approved Doctor trigger the existing re-verification workflow instead of silently retaining approval.
- Doctor-side Professional Profile now exposes identity fields and real photo management.
- Admin Doctor detail now exposes the canonical profile photo URL.
- Public Doctor Profile now renders real languages, insurance providers, and memberships when present.
- Added English/Hindi/Hinglish P18 translation resources through the existing i18n engine.

## No invented data

No doctor names, qualifications, clinics, ratings, reviews, fees, coordinates, photos, awards, memberships, or other profile facts were generated or seeded.

## Email

No SMTP/Nodemailer mechanism was introduced.

## Testing

- `node backend/tests/p18DoctorProfileContract.test.mjs` — PASS
- `node backend/tests/p17LeadContract.test.mjs` — PASS
- Backend JavaScript syntax audit — PASS
- Frontend production build — BLOCKED in the current environment because `vite` is not installed.
- Browser/MongoDB/Brevo live E2E — NOT VERIFIED in this environment.

## Remaining runtime requirement

Phase 18 must not be marked COMPLETE until a real environment executes the doctor edit → MongoDB → admin verification → public API → search → profile → photo → availability → booking chain and the regression suite passes.
