// Payment.status/refundStatus use a different, more granular vocabulary
// than Appointment.paymentStatus (which appointmentStatusDisplay.js already
// covers — "paid", not "captured"; no "created"/"partially_refunded").
// Single source here so the Payments workspace list, detail workspace, and
// KPI strip never disagree on wording or color for the same status.
export const PAYMENT_TX_STATUS_LABELS = {
  created: "Order Created",
  pending: "Pending",
  captured: "Captured",
  failed: "Failed",
  refunded: "Refunded",
  partially_refunded: "Partially Refunded",
};

export const PAYMENT_TX_STATUS_TONE = {
  created: "neutral",
  pending: "warning",
  captured: "success",
  failed: "danger",
  refunded: "sky",
  partially_refunded: "info",
};

export function paymentTxStatusLabel(status) {
  return PAYMENT_TX_STATUS_LABELS[status] || status;
}

export function paymentTxStatusTone(status) {
  return PAYMENT_TX_STATUS_TONE[status] || "neutral";
}

export const REFUND_STATUS_LABELS = {
  none: "No Refund",
  pending: "Refund Pending",
  partial: "Partially Refunded",
  full: "Fully Refunded",
  failed: "Refund Failed",
};

export const REFUND_STATUS_TONE = {
  none: "neutral",
  pending: "warning",
  partial: "info",
  full: "sky",
  failed: "danger",
};

export function refundStatusLabel(status) {
  return REFUND_STATUS_LABELS[status] || status;
}

export function refundStatusTone(status) {
  return REFUND_STATUS_TONE[status] || "neutral";
}

// Refund REQUEST status (RefundRequest.status) — a third, distinct
// vocabulary (pending/approved/rejected/processed/failed) already used as
// literal strings in AdminRefunds.jsx. Reused here rather than duplicated.
export const REFUND_REQUEST_STATUS_TONE = {
  pending: "warning",
  approved: "info",
  processed: "success",
  rejected: "danger",
  failed: "danger",
};

export function refundRequestStatusTone(status) {
  return REFUND_REQUEST_STATUS_TONE[status] || "neutral";
}

// Phase UI-6: labels were previously inlined as raw status strings
// (e.g. AdminRefunds.jsx rendering `request.status` directly). Centralized
// here so the registry, detail workspace, and Payments workspace's Refunds
// tab can never disagree on wording.
export const REFUND_REQUEST_STATUS_LABELS = {
  pending: "Pending Approval",
  approved: "Approved · Processing",
  processed: "Processed",
  rejected: "Rejected",
  failed: "Failed",
};

export function refundRequestStatusLabel(status) {
  return REFUND_REQUEST_STATUS_LABELS[status] || status;
}
