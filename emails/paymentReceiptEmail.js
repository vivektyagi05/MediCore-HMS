export const paymentReceiptEmail = ({ invoice }) => `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
    <h2 style="color:#0f172a">Payment received</h2>
    <p>Your payment for invoice <strong>${invoice.invoiceNumber}</strong> was successful.</p>
    <p>Total: <strong>${invoice.currency} ${invoice.totalAmount}</strong></p>
    <p>Thank you for using HMS Pro.</p>
  </div>
`;
