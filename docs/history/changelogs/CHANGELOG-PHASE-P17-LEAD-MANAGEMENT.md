# MediCore HMS — Phase 17 Contact + Lead Management

## Scope
Phase 17 only. The existing public Contact experience was connected to a real Lead workflow without introducing a second contact, authentication, audit, or email architecture.

## Implemented
- Real public `POST /api/leads` contact submission.
- Server-side validation, consent enforcement, duplicate-submission fingerprinting and IP-aware rate limiting.
- Anonymous and authenticated submissions; authenticated submissions are associated through existing JWT validation when a valid token is present.
- Secure `MC-XXXXXXXX` public reference generation.
- Lead lifecycle, priority, assignment, internal notes and immutable-in-practice timeline entries.
- Existing admin shell extended with `/admin/leads`.
- Admin list/search/filter/detail/assignment/status/priority/note operations.
- Existing `AdminActivityLog` reused for administrative mutations.
- Optional acknowledgement uses the existing Brevo/API email path only; no Phase 17 SMTP mechanism was added.
- Lead persistence is independent from optional email delivery; notification failure does not roll back a stored lead.
- Contact form links to the existing P16 Privacy Policy, Terms and Data Rights routes.
- Contact consent stores the server-authoritative current Terms/Privacy versions and backend timestamp.
- Contact UI and admin UI are integrated with existing i18n and shared design components.

## Runtime limitation
The supplied environment did not have project dependencies installed. `npm install --no-audit --no-fund` timed out; Vite, ESLint and backend runtime dependencies remained unavailable. Therefore browser/runtime/MongoDB/API E2E verification was not falsely marked as passing.
