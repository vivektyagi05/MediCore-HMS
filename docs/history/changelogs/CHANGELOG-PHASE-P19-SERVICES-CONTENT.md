# MediCore HMS — Phase P19 — Services + Content

## Scope
P19 strengthens the existing Service collection and existing CMSPage content store. No duplicate Service, Article, ServiceCategory, ArticleCategory, or Doctor model was introduced.

## Architecture audit findings
- `Service` is the canonical persisted service entity and was previously consumed by admin `/api/admin/services` and public `/api/public/services`.
- There was no separate `ServiceCategory` collection; category was a persisted string on Service and remains so.
- There was no Article model. Public articles were backed by `CMSPage`; P19 keeps `CMSPage` as the canonical content source and adds explicit `contentType` so article content is distinguishable from generic pages.
- There was no Doctor→Service relationship. P19 introduces an optional, validated `Service.relatedDoctors` reference only where an administrator deliberately selects existing Doctor records. Doctor profile data is not copied into Service documents.
- Existing Doctor public serialization remains canonical for doctor data exposed from Service/Article relations.
- Existing booking/appointment infrastructure is reused through Doctor Profile/booking links; no second booking system was introduced.
- Existing `AdminActivityLog` is reused for editorial/service lifecycle operations.

## Implemented
- Service structured fields: slug, short description, benefits, eligibility, preparation, procedure information, duration, consultation modes, relationships, lifecycle, visibility, featured ordering, localization, SEO.
- CMSPage structured article fields: excerpt, author, category, tags, related services/specialties/doctors, lifecycle, visibility, localization, SEO, content type.
- Safe lifecycle: draft → review → published → archived. Public APIs enforce published + public state; legacy records remain readable through compatibility filters until migration.
- Idempotent migration `backend/migrations/003_content_lifecycle_backfill.js` preserves existing public state without inventing content.
- Server-side validation, slug normalization/uniqueness, relationship existence checks, whitelisted mutation payloads, publication authorization, and content sanitization.
- Canonical public serializers for Service and Article with normalized URLs and safe related entities.
- Public Service catalog search/category/sort/pagination and Service Detail route.
- Public Article search/category/pagination and Article Detail with deterministic related-content selection.
- Admin Service workspace with structured editing, real Doctor/Service relationship selectors, lifecycle controls, and quality/SEO indicators.
- Admin Article workspace with structured editing, relationship selectors, lifecycle controls, and authorized unpublished preview through the real public serializer.
- English/Hindi/Hinglish P19 locale parity.
- P19 contract test covering lifecycle, serialization routes, whitelist/mass-assignment boundaries, and category/detail routes.

## Not fabricated
No medical statistics, treatment guarantees, success rates, doctor credentials, patient outcomes, service demand, popularity, view counts, or invented content were added.

## Verification status
- Backend syntax: PASS — 392 JS/MJS files checked.
- P19 contract test: PASS.
- Locale parity: PASS — 117 keys in English, Hindi, Hinglish.
- Frontend production build: BLOCKED — `npm ci` could not complete within the available runtime window; Vite executable was therefore unavailable.
- Backend dependency/runtime E2E: BLOCKED — backend dependencies/MongoDB/browser runtime were not available after the interrupted install.
- Browser network E2E: NOT VERIFIED.

P19 is therefore a **closure candidate, not complete**. P20 must not start until the runtime acceptance matrix passes.
