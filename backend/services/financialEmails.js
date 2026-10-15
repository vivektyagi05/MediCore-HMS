import { enqueueEmail } from "./emailOutboxService.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (amount, currency = "INR") => `${esc(currency)} ${Number(amount || 0).toFixed(2)}`;
const wrap = (name, lines) => `<p>Hello ${esc(name || "there")},</p>${lines.map((l) => `<p>${l}</p>`).join("")}<p>— MediCore</p>`;

// F-010: financial notifications go through the durable outbox (retry/backoff/
// dead-letter, eventKey dedupe). Enqueue failure is logged by enqueueEmail and
// never blocks money movement, but the row is the durable record of intent.
// A queued row is NOT evidence of delivery: only EmailDelivery.status === "sent" is.
export const financialEmails = {
  paymentReceipt: ({ payment, invoice, user }) => enqueueEmail({
    eventKey: `payment:receipt:${payment._id}`, to: user?.email, recipientId: user?._id, entityType: "payment", entityId: payment._id,
    subject: `Payment receipt - ${invoice?.invoiceNumber || "MediCore"}`,
    html: wrap(user?.name, [`We received your payment of <strong>${money(payment.totalAmount, payment.currency)}</strong>.`, invoice ? `Invoice <strong>${esc(invoice.invoiceNumber)}</strong> is available in your MediCore account under Invoices.` : "Your invoice will appear in your account shortly."]),
  }),
  refundProcessed: ({ payment, refundId, amount, user }) => enqueueEmail({
    eventKey: `refund:processed:${payment._id}:${refundId || amount}`, to: user?.email, recipientId: user?._id, entityType: "refund", entityId: payment._id,
    subject: "Refund processed",
    html: wrap(user?.name, [`A refund of <strong>${money(amount, payment.currency)}</strong> has been processed for your payment.`, "Depending on the original payment method it may take a few business days to appear."]),
  }),
  subscriptionActivated: ({ subscription, user }) => enqueueEmail({
    eventKey: `subscription:activated:${subscription.gatewayPaymentId}`, to: user?.email, recipientId: user?._id, entityType: "subscription", entityId: subscription._id,
    subject: "Your MediCore subscription is active",
    html: wrap(user?.name, [`Payment of <strong>${money(subscription.amount, subscription.currency)}</strong> was confirmed and <strong>${esc(subscription.planName)}</strong> is now active.`, subscription.currentPeriodEnd ? `Current period ends ${esc(new Date(subscription.currentPeriodEnd).toDateString())}.` : ""]),
  }),
  subscriptionPaymentFailed: ({ subscription, user }) => enqueueEmail({
    eventKey: `subscription:failed:${subscription._id}:${subscription.gatewayOrderId}`, to: user?.email, recipientId: user?._id, entityType: "subscription", entityId: subscription._id,
    subject: "Your MediCore subscription payment did not go through",
    html: wrap(user?.name, [`The payment for <strong>${esc(subscription.planName)}</strong> was not completed, so the plan has not been activated or renewed.`, "You can try again from Billing."]),
  }),
  withdrawalManuallySettled: ({ withdrawal, user }) => enqueueEmail({
    eventKey: `withdrawal:manual_settled:${withdrawal._id}`, to: user?.email, recipientId: user?._id, entityType: "withdrawal", entityId: withdrawal._id,
    subject: "Withdrawal recorded as settled",
    html: wrap(user?.name, [`An administrator recorded your withdrawal of <strong>${money(withdrawal.processedAmount ?? withdrawal.requestedAmount)}</strong> as settled manually (reference: ${esc(withdrawal.settlementReference)}).`, "This is a manual settlement record. Please check your bank statement and contact support if the funds are missing."]),
  }),
  withdrawalFailed: ({ withdrawal, user }) => enqueueEmail({
    eventKey: `withdrawal:failed:${withdrawal._id}`, to: user?.email, recipientId: user?._id, entityType: "withdrawal", entityId: withdrawal._id,
    subject: "Your withdrawal could not be completed",
    html: wrap(user?.name, [`Your withdrawal of <strong>${money(withdrawal.requestedAmount)}</strong> could not be completed${withdrawal.failureReason ? `: ${esc(withdrawal.failureReason)}` : ""}.`, "The amount has been released back to your available balance."]),
  }),
};
