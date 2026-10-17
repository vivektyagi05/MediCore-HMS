# Feature map

This page is a navigation aid, not an end-to-end test report. Feature names are based on the repository's documentation and source organization. A source reference is evidence that code is present, not proof that the feature works correctly in every environment.

| Area | Documented/source evidence | Verification status |
|---|---|---|
| Authentication and role-aware access | Backend auth, middleware, and frontend route/context areas exist in the repository | Requires runtime verification |
| Patient and doctor workflows | Frontend pages and backend route/model areas describe patient, doctor, and appointment workflows | Requires role-by-role browser verification |
| Appointments and scheduling | Appointment-related business logic and scheduler documentation are present | Requires runtime verification |
| Clinical records and uploaded documents | Documentation and backend storage-related code describe clinical/document workflows | Requires storage and access-control verification |
| Notifications and realtime features | Socket.IO and notification-related code and scenario documents are present | Requires multi-client/runtime verification |
| AI-assisted workflows | AI-related backend modules and feature documentation are present | Provider configuration and behavior unverified |
| Payments, wallet, refunds, invoices, payouts | Dedicated financial architecture, accounting contract, and payment business-logic documents exist | Requires database and gateway-sandbox verification |
| Admin and operational workflows | Admin-facing documentation and source areas are present | Requires role-by-role browser verification |
| SEO and public content | SEO-related source/test references and historical phase reports exist | Requires current build and runtime verification |

## How to read this table

- **Documented/source evidence** means relevant documentation or code references were found in the supplied repository.
- **Requires runtime verification** means source inspection alone is not enough to confirm the complete workflow.
- Historical phase reports are preserved under `history/` and should not be treated as current acceptance evidence unless their commit and environment match the code being evaluated.

This documentation-only pass did not execute tests, run the application, call external providers, or modify implementation.
