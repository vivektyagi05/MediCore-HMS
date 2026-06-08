import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { env } from "../config/env.js";

const formatMoney = (amount, currency) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
  }).format(amount);

export const generateInvoicePdf = async (invoice) => {
  const invoiceDir = path.resolve(process.cwd(), env.invoiceStorageDir);
  await fs.promises.mkdir(invoiceDir, { recursive: true });

  const filePath = path.join(invoiceDir, `${invoice.invoiceNumber}.pdf`);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);
    doc.fontSize(22).font("Helvetica-Bold").text(invoice.hospital.name);
    doc.fontSize(10).font("Helvetica").text(invoice.hospital.address);
    doc.text(`GSTIN: ${invoice.hospital.gstin}`);
    doc.text(`${invoice.hospital.email} ${invoice.hospital.phone || ""}`);
    doc.moveDown(2);

    doc.fontSize(18).font("Helvetica-Bold").text("Tax Invoice");
    doc.fontSize(10).font("Helvetica").text(`Invoice Number: ${invoice.invoiceNumber}`);
    doc.text(`Issued At: ${new Date(invoice.issuedAt).toLocaleString()}`);
    doc.moveDown();

    doc.font("Helvetica-Bold").text("Patient");
    doc.font("Helvetica").text(invoice.patient.name);
    doc.text(invoice.patient.email);
    doc.moveDown();

    doc.font("Helvetica-Bold").text("Doctor");
    doc.font("Helvetica").text(`Dr. ${invoice.doctor.name}`);
    doc.text(invoice.doctor.specialization);
    doc.moveDown(2);

    doc.font("Helvetica-Bold").text("Items");
    invoice.lineItems.forEach((item) => {
      doc
        .font("Helvetica")
        .text(`${item.description} x ${item.quantity}`, { continued: true })
        .text(formatMoney(item.total, invoice.currency), { align: "right" });
    });

    doc.moveDown();
    doc.text(`Subtotal: ${formatMoney(invoice.subtotal, invoice.currency)}`, {
      align: "right",
    });
    doc.text(`Taxes: ${formatMoney(invoice.taxAmount, invoice.currency)}`, {
      align: "right",
    });
    doc.font("Helvetica-Bold").text(`Total: ${formatMoney(invoice.totalAmount, invoice.currency)}`, {
      align: "right",
    });

    doc.moveDown(3);
    doc.fontSize(9).font("Helvetica").fillColor("#475569");
    doc.text("This invoice was generated electronically by HMS Pro.", {
      align: "center",
    });

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return filePath;
};
