import { env } from "../config/env.js";
import { paymentReceiptEmail } from "../emails/paymentReceiptEmail.js";
import { refundEmail } from "../emails/refundEmail.js";
import { logger } from "../utils/logger.js";
import fs from "fs/promises";
import { passwordRecoveryEmail } from "../emails/passwordRecoveryEmail.js";
import { doctorApprovalEmail, doctorRejectionEmail } from "../emails/doctorVerificationEmail.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));


const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const BREVO_ACCOUNT_ENDPOINT = "https://api.brevo.com/v3/account";
export const isBrevoConfigured = () => Boolean(env.brevo.apiKey && env.brevo.senderEmail);

// PHASE 2-D — Brevo diagnostics bugfix: `isBrevoConfigured()` only ever
// checked that BREVO_API_KEY/BREVO_SENDER_EMAIL env vars are *present* --
// never that the key is actually *valid* with Brevo. That gap is the real
// reason the reported 401 was confusing: the platform health check
// reported email as "healthy" (env vars present) right up until a real
// send attempt hit Brevo and got rejected. This calls Brevo's lightweight
// account-info endpoint (no email is sent) to verify the key itself is
// live, so a revoked/rotated/incorrect key shows up in health checks
// before it silently breaks the next real send. Never logs the key value.
let cachedCredentialCheck = null;
const CREDENTIAL_CHECK_TTL_MS = 60_000;

export const verifyBrevoCredentials = async () => {
  if (!isBrevoConfigured()) {
    return { healthy: false, checked: false, reason: "not_configured" };
  }

  if (cachedCredentialCheck && cachedCredentialCheck.expiresAt > Date.now()) {
    return cachedCredentialCheck.result;
  }

  let result;
  try {
    const response = await fetch(BREVO_ACCOUNT_ENDPOINT, {
      method: "GET",
      headers: { "api-key": env.brevo.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 401 || response.status === 403) {
      result = { healthy: false, checked: true, reason: "invalid_credentials" };
    } else if (!response.ok) {
      result = { healthy: false, checked: true, reason: `provider_error_${response.status}` };
    } else {
      result = { healthy: true, checked: true, reason: "ok" };
    }
  } catch (error) {
    result = { healthy: false, checked: true, reason: "network_error", errorName: error.name };
  }

  cachedCredentialCheck = { result, expiresAt: Date.now() + CREDENTIAL_CHECK_TTL_MS };
  return result;
};

export class BrevoConfigurationError extends Error {
  constructor(message) { super(message); this.name = "BrevoConfigurationError"; }
}

export class BrevoDeliveryError extends Error {
  constructor(message, statusCategory) { super(message); this.name = "BrevoDeliveryError"; this.statusCategory = statusCategory; }
}

export const sendPasswordRecoveryOtpEmail = async ({ toEmail, toName, otp, expiryMinutes }) => {
  if (!isBrevoConfigured()) throw new BrevoConfigurationError("Password recovery email provider is not configured.");
  const payload = {
    sender: { email: env.brevo.senderEmail, name: env.brevo.senderName },
    to: [{ email: toEmail, ...(toName ? { name: toName } : {}) }],
    subject: "Password recovery verification code",
  };
  // Brevo supports either a valid transactional templateId or inline HTML.
  // Treat the env value as template mode only when it is a real positive integer.
  // This prevents an invalid/placeholder BREVO_OTP_TEMPLATE_ID from producing a
  // request with neither usable templateId nor htmlContent (Brevo 400:
  // missing_parameter / Either of htmlContent or textContent is required).
  const parsedTemplateId = env.brevo.otpTemplateId
    ? Number.parseInt(String(env.brevo.otpTemplateId).trim(), 10)
    : NaN;

  if (Number.isInteger(parsedTemplateId) && parsedTemplateId > 0) {
    payload.templateId = parsedTemplateId;
    payload.params = { OTP: otp, EXPIRY_MINUTES: expiryMinutes, NAME: toName || "" };
  } else {
    payload.htmlContent = passwordRecoveryEmail({
      name: toName || "there",
      otp,
      expiryMinutes,
      hospitalName: env.hospital.name,
    });
  }
  let response;
  try {
    response = await fetch(BREVO_ENDPOINT, { method: "POST", headers: { "api-key": env.brevo.apiKey, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  } catch (error) {
    logger.error("Brevo password recovery request failed", { event: "password_recovery_email_network_error", errorName: error.name });
    throw new BrevoDeliveryError("Unable to reach the email provider.", "network");
  }
  if (!response.ok) {
    const statusCategory = response.status === 401 || response.status === 403 ? "credential" : response.status === 429 ? "rate_limit" : response.status >= 500 ? "provider_5xx" : "rejected";
    const providerBody = await response.text().catch(() => "");
    let providerError;
    try {
      providerError = providerBody ? JSON.parse(providerBody) : undefined;
    } catch {
      providerError = undefined;
    }

    // Brevo's provider error code/message is safe to log and is essential for
    // diagnosing 400 responses (sender, template, recipient, account policy,
    // etc.). Never log the API key, OTP, or HTML email body.
    logger.error("Brevo rejected the password recovery email", {
      event: "password_recovery_email_send_failed",
      statusCode: response.status,
      statusCategory,
      providerCode: providerError?.code,
      providerMessage: providerError?.message,
    });
    throw new BrevoDeliveryError("The email provider rejected the request.", statusCategory);
  }
  const data = await response.json().catch(() => ({}));
  if (!data?.messageId) {
    logger.error("Brevo returned an unexpected password recovery response", { event: "password_recovery_email_malformed_success_response", statusCode: response.status, statusCategory: "malformed_response" });
    throw new BrevoDeliveryError("The email provider returned an invalid response.", "malformed_response");
  }
  logger.info("Brevo accepted password recovery email for delivery", { event: "password_recovery_email_accepted", messageId: data.messageId });
  return { messageId: data.messageId };
};
export const sendContactLeadAcknowledgement = async ({ toEmail, toName, referenceId }) => {
  if (!isBrevoConfigured()) return { skipped: true };
  const payload = {
    sender: { email: env.brevo.senderEmail, name: env.brevo.senderName },
    to: [{ email: toEmail, ...(toName ? { name: toName } : {}) }],
    subject: "MediCore enquiry received",
    htmlContent: `<p>Hello ${escapeHtml(toName || "there")},</p><p>We received your MediCore enquiry.</p><p>Your reference ID is <strong>${escapeHtml(referenceId)}</strong>.</p><p>Please keep this reference for future correspondence.</p>`,
  };
  let response;
  try {
    response = await fetch(BREVO_ENDPOINT, { method: "POST", headers: { "api-key": env.brevo.apiKey, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  } catch (error) {
    logger.error("Brevo lead acknowledgement request failed", { event: "lead_acknowledgement_network_error", errorName: error.name });
    throw new BrevoDeliveryError("Unable to reach the email provider.", "network");
  }
  if (!response.ok) {
    const statusCategory = response.status === 401 || response.status === 403 ? "credential" : response.status === 429 ? "rate_limit" : response.status >= 500 ? "provider_5xx" : "rejected";
    logger.error("Brevo rejected the lead acknowledgement", { event: "lead_acknowledgement_send_failed", statusCode: response.status, statusCategory });
    throw new BrevoDeliveryError("The email provider rejected the request.", statusCategory);
  }
  const data = await response.json().catch(() => ({}));
  if (!data?.messageId) throw new BrevoDeliveryError("The email provider returned an invalid response.", "malformed_response");
  logger.info("Brevo accepted lead acknowledgement", { event: "lead_acknowledgement_accepted", messageId: data.messageId });
  return { messageId: data.messageId };
};

const sendMail = async ({ to, subject, html, attachments = [] }) => {
  if (!isBrevoConfigured()) {
    logger.error("Transactional email cannot be sent because Brevo is not configured", {
      event: "email_not_configured",
    });
    throw new BrevoConfigurationError("Transactional email provider is not configured.");
  }
  const payload = {
    sender: { email: env.brevo.senderEmail, name: env.brevo.senderName },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (attachments.length) {
    payload.attachment = [];
    for (const attachment of attachments) {
      try {
        const content = await fs.readFile(attachment.path);
        payload.attachment.push({ name: attachment.filename, content: content.toString("base64") });
      } catch (error) {
        logger.error("Unable to attach transactional document", {
          event: "email_attachment_read_failed",
          filename: attachment.filename,
          errorName: error.name,
        });
        throw new BrevoDeliveryError("The transactional email attachment could not be prepared.", "attachment");
      }
    }
  }
  let response;
  try {
    response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: { "api-key": env.brevo.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    logger.error("Brevo transactional email request failed", { event: "transactional_email_network_error", errorName: error.name });
    throw new BrevoDeliveryError("Unable to reach the email provider.", "network");
  }
  if (!response.ok) {
    const statusCategory = response.status === 401 || response.status === 403 ? "credential" : response.status === 429 ? "rate_limit" : response.status >= 500 ? "provider_5xx" : "rejected";
    logger.error("Brevo rejected transactional email", { event: "transactional_email_send_failed", statusCode: response.status, statusCategory });
    throw new BrevoDeliveryError("The email provider rejected the request.", statusCategory);
  }
  const data = await response.json().catch(() => ({}));
  if (!data?.messageId) {
    logger.error("Brevo returned an unexpected transactional email response", {
      event: "transactional_email_malformed_success_response",
      statusCode: response.status,
      statusCategory: "malformed_response",
    });
    throw new BrevoDeliveryError("The email provider returned an invalid response.", "malformed_response");
  }

  logger.info("Brevo accepted transactional email for delivery", {
    event: "transactional_email_accepted",
    messageId: data.messageId,
  });
  return { messageId: data.messageId };
};

export const emailService = {
  // Phase A5.1 addition — lets Mission Control report the platform's real
  // email delivery status instead of a fabricated "online" indicator.
  isConfigured() {
    return isBrevoConfigured();
  },
  isBrevoConfigured() {
    return isBrevoConfigured();
  },
  verifyBrevoCredentials,
  sendPasswordRecoveryOtpEmail,
  sendContactLeadAcknowledgement,

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

  // PHASE 2-B — Doctor Real Workflow. Section 6/7 of the brief: approval and
  // rejection must send a REAL email through this same Brevo abstraction
  // (never console.log/fake success). Business state (verificationStatus)
  // is never rolled back if this throws -- the caller catches and logs
  // the delivery failure separately, matching the existing
  // sendPasswordRecoveryOtpEmail/sendRefundConfirmation contract (throw on
  // provider failure, let the caller decide what "handled safely" means).
  sendDoctorApprovalEmail({ toEmail, toName, specialization }) {
    return sendMail({
      to: toEmail,
      subject: `Your ${env.hospital.name} doctor verification is approved`,
      html: doctorApprovalEmail({ name: toName, hospitalName: env.hospital.name, specialization }),
    });
  },

  sendDoctorRejectionEmail({ toEmail, toName, reason }) {
    return sendMail({
      to: toEmail,
      subject: `Your ${env.hospital.name} doctor verification update`,
      html: doctorRejectionEmail({ name: toName, hospitalName: env.hospital.name, reason }),
    });
  },
};
