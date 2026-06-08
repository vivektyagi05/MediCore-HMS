import QRCode from "qrcode";
import { generateInvoicePdf } from "../utils/generateInvoice.js";
import { invoiceTemplate } from "./invoiceTemplates.js";

export const generateEnterpriseInvoicePDF = async (invoice) => {
  const qrDataUrl = await QRCode.toDataURL(
    JSON.stringify({
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: invoice.totalAmount,
      currency: invoice.currency,
      paymentId: invoice.paymentId?.toString?.() || invoice.paymentId,
    }),
  );
  invoice.metadata = { ...(invoice.metadata || {}), template: invoiceTemplate({ invoice, qrDataUrl }) };
  return generateInvoicePdf(invoice);
};
