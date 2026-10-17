# Phase P20 — SEO Infrastructure

## Scope
SEO infrastructure only. Existing Service, Article/CMS, Doctor, booking, payment, patient, admin and notification architectures remain canonical.

## Implemented
- Central frontend SEO URL/configuration layer.
- Canonical `SEOMeta` abstraction with title, description, canonical, robots, Open Graph, Twitter, locale and JSON-LD support.
- Route-aware indexing policy for public directories and transient filter/compare states.
- Canonical Organization, WebSite/SearchAction, Physician, MedicalService, Article and BreadcrumbList helpers.
- Backend database-backed `/robots.txt` and `/sitemap.xml`.
- Sitemap uses actual eligible public Doctors, Services and Articles.
- Private/application routes and unpublished content excluded from sitemap.
- Production SEO origins are configuration-driven; localhost is not used as a production SEO origin.
- Removed stale static robots/sitemap files to avoid competing sources.
- Added SEO contract coverage.

## Intentionally not changed
- Service architecture
- Article/CMS architecture
- Doctor architecture
- Booking/payments/patient/admin/AI/notifications
- general performance/accessibility work
