# MediCore HMS — Phase 16 Legal, Privacy, Consent & User Data Rights

## Scope
Implemented only Phase 16 legal/privacy functionality on the existing architecture.

### Added
- Public Privacy Policy, Terms, Medical Disclaimer and Cookie Policy routes.
- Authenticated Privacy Preferences and Data Rights routes.
- Centralized legal document metadata in `shared/legalDocuments.js`.
- `PrivacyRequest`, `PrivacyPreference`, and immutable `ConsentRecord` models.
- Authenticated privacy APIs plus a rate-limited public grievance endpoint.
- Account-scoped JSON data export with protected authentication fields excluded.
- Password re-authentication for deletion requests; deletion remains a controlled request rather than an unsafe cascade.
- Server-recorded Terms/Privacy acceptance at registration.
- Server-recorded booking legal acknowledgement with policy versions.
- Footer legal navigation and contextual legal links.
- `robots.txt` and a public legal-document sitemap.
- Phase 16 contract validation.

### Privacy/security audit finding fixed
The booking flow previously persisted its complete in-progress form in `localStorage`, which could include health-related fields. Phase 16 removes that browser draft persistence and the dashboard's resume-draft UI. Authentication storage remains unchanged because it is part of the existing authentication architecture.

### Actual product disclosures
The policy content is based on the audited repository. Current optional analytics/personalization/marketing categories are not active, so the preference center does not fabricate toggles. Actual integrations identified for disclosure include Brevo password-recovery email, Razorpay payment processing, OpenStreetMap/public GeoJSON map resources, and an explicit Google Maps navigation action.

## Verification
- Node syntax checks for all changed backend/locale JS: PASS.
- TypeScript JSX transpile checks for all changed JSX: PASS.
- P13/P14/P15 validators: PASS.
- P16 contract validator: PASS.
- Repository secret/config scan: no committed real secrets found.
- Frontend build: BLOCKED — clean package has no installed `vite`.
- Backend runtime: BLOCKED — clean package has no installed `dotenv`/backend dependencies.
- Real MongoDB/API/browser E2E: BLOCKED by unavailable runtime dependencies/database.
