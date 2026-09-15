export const refundEmail = ({ amount, currency }) => `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
    <h2 style="color:#0f172a">Refund update</h2>
    <p>Your refund of <strong>${currency} ${amount}</strong> has been processed.</p>
  </div>
`;
