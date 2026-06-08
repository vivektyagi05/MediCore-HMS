import Invoice from "../models/Invoice.js";
import { env } from "../config/env.js";
import { generateEnterpriseInvoicePDF } from "../invoices/generateInvoicePDF.js";

const TAX_RATE = 0.18;

const invoiceNumber = () => {
  const date = new Date();
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  const entropy = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `HMS-${stamp}-${entropy}`;
};

export const calculateInvoiceAmounts = (baseAmount) => {
  const subtotal = Number(baseAmount);
  const taxAmount = Number((subtotal * TAX_RATE).toFixed(2));
  const totalAmount = Number((subtotal + taxAmount).toFixed(2));

  return { subtotal, taxAmount, totalAmount };
};

export const invoiceService = {
  async createInvoice({ payment, appointment }) {
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
