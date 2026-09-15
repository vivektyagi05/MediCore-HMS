import mongoose from "mongoose";

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Subscription Intelligence (Phase D4, additive): subscription invoices
    // have no linked Payment document today (subscriptions are activated
    // directly, not via the Razorpay payment-capture flow appointments use),
    // so this is no longer schema-required. The real either/or requirement
    // (a consultation invoice needs paymentId+appointmentId; a subscription
    // invoice needs subscriptionId) is enforced by the pre-validate hook
    // below instead of a blanket `required: true` that would block
    // subscription invoices entirely.
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      index: true,
    },
    // Subscription Intelligence (Phase D4, additive): an invoice is either
    // for a consultation payment (appointmentId set, subscriptionId null) or
    // a doctor subscription payment (subscriptionId set, appointmentId
    // null). appointmentId is no longer required so subscription invoices
    // don't need a fabricated appointment reference -- every pre-existing
    // invoice already has appointmentId populated and is unaffected.
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      index: true,
    },
    billingType: {
      type: String,
      enum: ["consultation", "subscription"],
      default: "consultation",
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    hospital: {
      name: String,
      gstin: String,
      address: String,
      email: String,
      phone: String,
    },
    patient: {
      name: String,
      email: String,
    },
    doctor: {
      name: String,
      email: String,
      specialization: String,
    },
    lineItems: [
      {
        description: String,
        quantity: Number,
        unitAmount: Number,
        total: Number,
      },
    ],
    subtotal: {
      type: Number,
      required: true,
    },
    taxAmount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    pdfPath: String,
    downloadUrl: String,
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ["issued", "void"],
      default: "issued",
      index: true,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Subscription Intelligence (Phase D4): schema-level required:true on
// paymentId/appointmentId would make subscription invoices impossible (they
// have neither), so the real requirement is enforced here instead: every
// invoice must be identifiable as either a consultation invoice (payment +
// appointment) or a subscription invoice (subscriptionId), never neither.
invoiceSchema.pre("validate", function enforceInvoiceLinkage(next) {
  const hasConsultationLink = Boolean(this.paymentId && this.appointmentId);
  const hasSubscriptionLink = Boolean(this.subscriptionId);
  if (!hasConsultationLink && !hasSubscriptionLink) {
    return next(new Error("Invoice must reference either a payment+appointment or a subscription"));
  }
  next();
});

const Invoice = mongoose.model("Invoice", invoiceSchema);

export default Invoice;
