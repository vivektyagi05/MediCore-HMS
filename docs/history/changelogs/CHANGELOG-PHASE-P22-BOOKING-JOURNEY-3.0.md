# Phase P22 — End-to-End Booking Experience 3.0

## Scope
Patient booking journey, appointment lifecycle visibility, recovery, rescheduling/cancellation UX, and booking/payment state consistency. Existing payment, notification, Doctor, Service, and P20 SEO architectures remain canonical.

## Implemented in this candidate
- Durable `bookingRequestId` idempotency on the canonical `Appointment` document.
- Safe retry recovery when an appointment was created but the client did not receive the response.
- Database-backed slot conflict protection remains authoritative.
- Durable `statusHistory` on `Appointment` for lifecycle timeline rendering.
- History recording for booking, status transitions, cancellation, reschedule, payment completion, and payment-window expiry.
- Canonical authenticated `GET /api/appointments/:id` detail endpoint with role-scoped ownership.
- Patient appointment detail page with actual status, payment state, timeline, cancellation reason, and next actions.
- Patient cancellation confirmation and reschedule actions now use the existing shared dialogs/API.
- Booking wizard preserves booking URL intent through authentication and now reacts to changed intent parameters.
- Existing payment handoff continues to use the existing Razorpay/payment architecture; no financial redesign or SMTP introduced.
- P22 contract tests added.

## Verification status
Static backend syntax and P22 contract checks pass. Full dependency installation timed out in the execution environment, so frontend production build, MongoDB runtime, browser E2E, and mobile E2E remain NOT VERIFIED. P22 is therefore a closure candidate, not COMPLETE.

P23 has not been started.
