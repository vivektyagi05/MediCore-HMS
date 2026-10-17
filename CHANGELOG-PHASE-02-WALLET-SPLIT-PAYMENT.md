# Phase 02 changelog
Added: models/WalletReservation, Wallet.holds; payments/{walletReservationService,walletOnlyRecovery,walletRechargeService,unpaidPaymentCleanup,captureResolution}.js; admin routes capture-cases; tests (4 files + mongo/phase02, not run).
Changed: paymentController (reserve before order, commit on capture, safer wallet-only), paymentAttemptService (reserve before provider order), financeController + webhookHandler (recharge pipeline/webhook), appointmentExpiryService (guarded release), recoverPaymentEvents (wallet recovery in same leased job), walletController (availableBalance), PaymentCheckout.jsx, walletRechargeStateMachine (late capture), Payment.captureEvidence.resolution.
Behaviour: POST /payments/orders may return 409 WALLET_INSUFFICIENT / 503 WALLET_PAYMENT_PENDING. See docs/PHASE-02-WALLET-SPLIT-PAYMENT.md.

## Closure
Added: src/pages/admin/AdminCaptureCases.jsx, src/utils/captureCaseDisplay.js, adminApi capture-case calls, nav + route; wallet-reservation admin API; persistRechargeGuarded/flagRecharge; PAYMENT_CREATION_IN_PROGRESS guard; recharge amount validation; scripts/audit-wallet-precision.mjs; tests: phase02CrashMatrix, captureCasesHttp, captureCaseDisplay, financialAuthorization, phase02Indexes, walletPrecisionAudit; helpers: phase02Harness, memoryModels (array paths, $pull, positional $).
Changed: financeController (no whole-document recharge saves), walletRechargeService (create vs save), paymentController (young order-less guard), PaymentCheckout.jsx (new code handled), captureResolution (resolved filter, safe fields).
