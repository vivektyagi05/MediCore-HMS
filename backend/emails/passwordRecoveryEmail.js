const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));

// Phase P15 — sent only via Brevo's transactional API, and only ever to
// the account's own registered address. Never persisted (see
// PasswordReset model) and never logged (see services/emailService.js).
export const passwordRecoveryEmail = ({ name, otp, expiryMinutes, hospitalName }) => `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background-color:#0f172a;padding:24px 32px;">
                <span style="color:#f97316;font-size:20px;font-weight:800;letter-spacing:-0.02em;">${escapeHtml(hospitalName)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px;color:#0f172a;font-size:16px;line-height:24px;">
                  Hi ${escapeHtml(name)},
                </p>
                <p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:24px;">
                  We received a request to reset the password on your ${escapeHtml(hospitalName)} account. Use the verification code below to continue.
                </p>
                <div style="margin:0 0 24px;text-align:center;">
                  <span style="display:inline-block;padding:16px 28px;border-radius:12px;background-color:#f1f5f9;color:#0f172a;font-size:32px;font-weight:800;letter-spacing:0.3em;">${escapeHtml(otp)}</span>
                </div>
                <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:22px;">
                  This code expires in <strong>${escapeHtml(String(expiryMinutes))} minutes</strong> and can only be used once.
                </p>
                <p style="margin:0;color:#64748b;font-size:13px;line-height:20px;">
                  If you did not request this, you can safely ignore this email — your password will not be changed.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
