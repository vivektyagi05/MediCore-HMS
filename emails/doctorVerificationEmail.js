// PHASE 2-B — Doctor approval/rejection email templates.
//
// Mirrors the existing template style (passwordRecoveryEmail.js /
// refundEmail.js): a small inline-styled HTML fragment, no external
// dependencies, safe to hand straight to Brevo's htmlContent field.

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));

export const doctorApprovalEmail = ({ name, hospitalName, specialization }) => `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
    <h2 style="color:#0f172a">Your ${escapeHtml(hospitalName)} verification is approved</h2>
    <p>Hello Dr. ${escapeHtml(name || "there")},</p>
    <p>Your doctor profile${specialization ? ` (<strong>${escapeHtml(specialization)}</strong>)` : ""} has been reviewed and <strong>approved</strong>.</p>
    <p>You can now log in and access your dashboard, schedule, appointments, and clinical workspace.</p>
    <p style="color:#64748b;font-size:12px">If you did not expect this email, please contact support.</p>
  </div>
`;

export const doctorRejectionEmail = ({ name, hospitalName, reason }) => `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
    <h2 style="color:#0f172a">Your ${escapeHtml(hospitalName)} verification was not approved</h2>
    <p>Hello Dr. ${escapeHtml(name || "there")},</p>
    <p>After review, your doctor verification request was <strong>not approved</strong> at this time.</p>
    ${reason ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ""}
    <p>You can update your profile and resubmit for review.</p>
    <p style="color:#64748b;font-size:12px">If you have questions, please contact support.</p>
  </div>
`;
