# CHANGELOG — Phase 01 (2026-10-14)

See `docs/PHASE-01-PAYMENT-CORE.md` for evidence statuses, behaviour changes, runbook and risks.

# Phase 01 — Payment core, state machine & webhook integrity

Date 2026-10-14 · Base: `MediCore-HMS-PHASE-00-FOUNDATION-2026-10-13.zip` · Tests 172 -> **175/175**, eslint clean, build OK.


Files: payments/{paymentTransitions,paymentAttemptService,paymentFailureService,paymentDeps}.js (new); payments/{webhookHandler,paymentRetryService,paymentCapture,paymentStateMachine,paymentGateway,testGateway}.js; services/razorpayService.js; controllers/paymentController.js; models/{Payment,PaymentAttempt,WebhookEvent}.js; migrations/012_payment_active_slot.js; scripts/release.mjs; cron/{recoverPaymentEvents,financialScheduler}.js; src/pages/payment/{paymentConfirmation.js,PaymentCheckout.jsx}; tests (see doc).
