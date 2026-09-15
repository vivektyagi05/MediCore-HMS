import Invoice from "../models/Invoice.js";
import { env } from "../config/env.js";
import { generateEnterpriseInvoicePDF } from "../invoices/generateInvoicePDF.js";
import crypto from "crypto";

const configuredTaxRate = Number(process.env.CONSULTATION_TAX_RATE);
const TAX_RATE = Number.isFinite(configuredTaxRate) && configuredTaxRate >= 0 && configuredTaxRate <= 100 ? configuredTaxRate : 0;

const invoiceNumber = () => {
  const date = new Date();
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  const entropy = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `HMS-${stamp}-${entropy}`;
};

export const calculateInvoiceAmounts = (baseAmount) => {
  const subtotal = Number(baseAmount);
  const taxAmount = Number((subtotal * TAX_RATE).toFixed(2));
  const totalAmount = Number((subtotal + taxAmount).toFixed(2));

  return { subtotal, taxAmount, totalAmount };
};

// Subscription Intelligence (Phase D4): doctor subscription payments never
// generated an Invoice before -- only appointment payments did. This reuses
// the exact same numbering/PDF/GST pipeline so a doctor's subscription
// billing history has the same real tax-invoice trail as patient invoices.
export const createSubscriptionInvoiceRecord = async ({ subscription, doctorUser }) => {
  const existingInvoice = await Invoice.findOne({ subscriptionId: subscription._id });
  if (existingInvoice) return existingInvoice;

  const { subtotal, taxAmount } = calculateInvoiceAmounts(
    Number((subscription.amount / (1 + TAX_RATE)).toFixed(2)),
  );

  const invoice = await Invoice.create({
    invoiceNumber: invoiceNumber(),
    subscriptionId: subscription._id,
    billingType: "subscription",
    userId: subscription.userId,
    doctorId: subscription.doctorId,
    hospital: env.hospital,
    patient: {
      name: doctorUser?.name || "Doctor",
      email: doctorUser?.email || "",
    },
    doctor: {
      name: doctorUser?.name || "",
      email: doctorUser?.email || "",
      specialization: subscription.planName,
    },
    lineItems: [
      {
        description: `${subscription.planName} (${subscription.interval})`,
        quantity: 1,
        unitAmount: subtotal,
        total: subtotal,
      },
    ],
    subtotal,
    taxAmount,
    totalAmount: subscription.amount,
    currency: subscription.currency,
  });

  const pdfPath = await generateEnterpriseInvoicePDF(invoice.toJSON());
  invoice.pdfPath = pdfPath;
  invoice.downloadUrl = `/api/invoices/${invoice._id}/download`;
  await invoice.save();

  return invoice;
};

export const invoiceService = {
  async createInvoice({ payment, appointment }) {
    // Idempotency guard: verifyPayment's post-processing chain can be retried
    // (by reconciliation) if an earlier attempt failed partway through. Without
    // this check a retry would create a second Invoice with a different
    // invoiceNumber for the same payment.
    const existingInvoice = await Invoice.findOne({ paymentId: payment._id });
    if (existingInvoice) return existingInvoice;

    const patient = appointment.patientId;
    const doctorProfile = appointment.doctorId;
    const doctorUser = doctorProfile.userId;

    const invoice = await Invoice.create({
      invoiceNumber: invoiceNumber(),
      paymentId: payment._id,
      appointmentId: appointment._id,
      userId: patient._id,
      doctorId: doctorProfile._id,
      hospital: env.hospital,
      patient: {
        name: patient.name,
        email: patient.email,
      },
      doctor: {
        name: doctorUser.name,
        email: doctorUser.email,
        specialization: doctorProfile.specialization,
      },
      lineItems: [
        {
          description: `Consultation - ${doctorProfile.specialization}`,
          quantity: 1,
          unitAmount: payment.amount,
          total: payment.amount,
        },
      ],
      subtotal: payment.amount,
      taxAmount: payment.taxAmount,
      totalAmount: payment.totalAmount,
      currency: payment.currency,
    });

    const pdfPath = await generateEnterpriseInvoicePDF(invoice.toJSON());
    invoice.pdfPath = pdfPath;
    invoice.downloadUrl = `/api/invoices/${invoice._id}/download`;
    await invoice.save();

    return invoice;
  },
};
