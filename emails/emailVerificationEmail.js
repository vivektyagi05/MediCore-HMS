const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char]));

export const emailVerificationEmail = ({ name, verificationUrl, expiryMinutes, hospitalName }) => `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#0f172a">
    <h2>Verify your ${escapeHtml(hospitalName)} account</h2>
    <p>Hello ${escapeHtml(name || "there")},</p>
    <p>Please verify your email address to activate normal account access.</p>
    <p><a href="${escapeHtml(verificationUrl)}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px">Verify email</a></p>
    <p>This verification link expires in ${Number(expiryMinutes)} minutes and can only be used once.</p>
    <p style="color:#64748b;font-size:12px">If you did not create this account, you can ignore this email.</p>
  </div>
`;
