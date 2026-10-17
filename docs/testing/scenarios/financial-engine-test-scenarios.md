# HMS Financial Engine Test Scenarios

## Webhooks

- Send the same `payment.captured` webhook twice with a valid Razorpay signature and confirm only one `WebhookEvent` is processed.
- Send a webhook with a modified body and original signature and confirm the API returns `400`.
- Send `payment.failed` and confirm the payment is marked failed and a retry ledger row is created.

## Coupons

- Apply an expired coupon and confirm checkout is rejected before order creation.
- Apply a user-specific coupon from another account and confirm `403`.
- Reuse a coupon after successful payment and confirm duplicate usage is blocked.

## Wallet

- Attempt a wallet contribution greater than the current balance and confirm only the available safe amount is applied.
- Verify a recharge with an invalid Razorpay signature and confirm no wallet credit is posted.
- Retry wallet recharge verification and confirm the pending ledger prevents duplicate credits.

## Refunds

- Submit two pending refund requests for the same payment and confirm the second request is rejected.
- Approve a partial refund and confirm payment `refundedAmount`, wallet credit, and ledger rows are updated.
- Attempt a refund larger than remaining refundable balance and confirm the API returns `400`.

## Invoices

- Try downloading another patient's invoice and confirm the request returns `404` or `403`.
- Complete payment verification and confirm invoice record, PDF path, download URL, and email receipt are generated.

## Reconciliation

- Seed two payments with the same Razorpay order id and confirm the reconciliation report flags `duplicate_order`.
- Seed a captured payment without `paymentId` and confirm `missing_capture_reference`.
- Seed a payment with refunded amount greater than total and confirm `refund_exceeds_payment`.
