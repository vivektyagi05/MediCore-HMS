import fs from "fs";
import mongoose from "mongoose";
import Invoice from "../models/Invoice.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";

const ownershipFilter = (req) => ([ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role) ? {} : { userId: req.user._id });

export const getInvoices = asyncHandler(async (req, res) => {
  const invoices = await Invoice.find(ownershipFilter(req))
    .sort({ issuedAt: -1 })
    .limit(100)
    .lean();

  res.status(200).json({
    success: true,
    data: { invoices },
    message: "Invoices fetched successfully",
  });
});

export const getInvoiceById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid invoice id", 400);
  }

  const invoice = await Invoice.findOne({ _id: req.params.id, ...ownershipFilter(req) }).lean();
  if (!invoice) throw new AppError("Invoice not found", 404);

  res.status(200).json({
    success: true,
    data: { invoice },
    message: "Invoice fetched successfully",
  });
});

export const downloadInvoice = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid invoice id", 400);
  }

  const invoice = await Invoice.findOne({ _id: req.params.id, ...ownershipFilter(req) }).lean();
  if (!invoice?.pdfPath || !fs.existsSync(invoice.pdfPath)) {
    throw new AppError("Invoice PDF not found", 404);
  }

  res.download(invoice.pdfPath, `${invoice.invoiceNumber}.pdf`);
});
