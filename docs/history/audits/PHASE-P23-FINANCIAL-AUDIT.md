# P23 Financial Audit & Architecture

## Ownership map
| Domain | Canonical source | Responsibility | Main risks found |
|---|---|---|---|
| Payment | `Payment` | customer payment/order/capture state | legacy status mixed order/capture; frontend callback could be mistaken for success |
| Attempt | `PaymentAttempt` (P23) | one gateway attempt/order | retries previously had no durable attempt identity |
| Gateway | `paymentGateway` -> Razorpay/test adapter | external gateway boundary | business code directly depended on Razorpay |
| Ledger | `TransactionLedger` | internal postings | some flows could drift from wallet/payment |
| Wallet | `Wallet` | patient balance | duplicate wallet debit/credit risk during partial retries |
| Invoice | `Invoice` | billed amount and document | invoice numbering used weak random entropy; tax was hardcoded |
| Refund | `RefundRequest` | request/approval/processing state | gateway failure and concurrency needed stronger recovery |
| Webhook | `WebhookEvent` | external event receipt/deduplication | captured webhook path duplicated post-processing logic |
| Reconciliation | `reconciliationService` | detect internal/external drift | previously checked only a small subset of inconsistencies |
| Payout | `DoctorPayout` | doctor settlement state | captured payment must not be treated as settled payout |
| Email | Brevo HTTP API | downstream transactional delivery | SMTP was still present in financial delivery path |

## P23 repairs
- Added durable PaymentAttempt records.
- Added payment workflow state + state history without breaking legacy `Payment.status` consumers.
- Added deterministic integer-paise arithmetic.
- Tax is now configuration-driven; an absent rate means tax is not configured rather than an invented universal rate.
- Added a gateway adapter boundary and deterministic isolated test gateway.
- Server-side payment verification now checks signature, ownership, order, amount and currency.
- Webhook capture reuses the same idempotent post-processing path as server verification.
- Wallet payment/refund mutations are guarded against duplicate reference application.
- Refund requests have a partial unique active-request constraint and per-payment processing lock.
- Refund success stores the gateway refund ID and webhook processing is deduplicated by gateway refund ID.
- Reconciliation now checks invoice, payout, payment ledger, refund totals, refund ledger and explicit reconciliation-required states.
- Retry creates a new gateway order/PaymentAttempt instead of pretending a failed attempt itself was retried.
- Financial transactional email uses Brevo HTTP API only. SMTP/Nodemailer delivery was removed from the runtime implementation.
- Subscription code was not redesigned or included in the P23 payment state machine.

## Known runtime boundary
The repository environment currently lacks installed dependencies and a running MongoDB instance. Static tests can be executed; full browser/MongoDB E2E cannot honestly be marked PASS until those runtime prerequisites are available.
