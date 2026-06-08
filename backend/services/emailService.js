import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { paymentReceiptEmail } from "../emails/paymentReceiptEmail.js";
import { refundEmail } from "../emails/refundEmail.js";
import { logger } from "../utils/logger.js";

const isEmailConfigured = Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);

const getTransporter = () =>
  nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass,
    },
  });

const sendMail = async ({ to, subject, html, attachments = [] }) => {
  if (!isEmailConfigured) {
    logger.info("Email skipped because SMTP is not configured", { to, subject });
    return { skipped: true };
  }

  const transporter = getTransporter();
  return transporter.sendMail({
    from: env.smtp.from,
    to,
    subject,
    html,
    attachments,
  });
};

export const emailService = {
  sendAppointmentConfirmation({ patient, appointment }) {
    return sendMail({
      to: patient.email,
      subject: "Appointment confirmed",
      html: `<p>Your appointment for ${new Date(appointment.date).toDateString()} at ${appointment.timeSlot} has been confirmed.</p>`,
    });
  },

  sendPaymentReceipt({ patient, invoice, pdfPath }) {
    return sendMail({
      to: patient.email,
      subject: `Payment receipt - ${invoice.invoiceNumber}`,
      html: paymentReceiptEmail({ patient, invoice }),
      attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, path: pdfPath }],
    });
  },

  sendRefundConfirmation({ patient, amount, currency }) {
    return sendMail({
      to: patient.email,
      subject: "Refund processed",
      html: refundEmail({ patient, amount, currency }),
    });
  },
};
