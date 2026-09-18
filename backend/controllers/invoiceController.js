import fs from "fs";
import mongoose from "mongoose";
import Invoice from "../models/Invoice.js";
import Payment, { REFUND_STATUS } from "../models/Payment.js";
import Doctor from "../models/Doctor.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";

// PHASE DOC-09 — Doctor Earnings / Financial Control Center.
//
// AUDIT FINDING: doctors had NO real invoice access anywhere — this route
// was gated to ADMIN/SUPER_ADMIN/PATIENT only, and buildDoctorRevenueIntelligence()
// worked around that by loading up to 200 raw Invoice documents itself
// (unbounded search/filter/pagination) just so the old Earnings page could
// render an "Invoices" card. Per the DOC-09 brief's rule against building a
// second invoice engine, the fix is additive: let a doctor caller use this
// EXACT existing endpoint (real pagination/search/sort already built in),
// scoped to their own doctorId rather than a patient's userId. Nothing
// about the admin or patient branches changes.
const ownershipFilter = async (req) => {
  if ([ROLES.SUPER_ADMIN].includes(req.user.role)) return {};
  if (req.user.role === ROLES.DOCTOR) {
    const doctor = await Doctor.findOne({ userId: req.user._id }).select("_id").lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);
    return { doctorId: doctor._id };
  }
  return { userId: req.user._id };
};

// The Invoice model itself only ever represents one document shape (a tax
// invoice generated at capture time — see invoiceService.createInvoice).
// Rather than fabricate distinct Receipt/CreditNote/RefundReceipt document
// types with no real PDF content behind them, this derives an honest label
// from the *actual* linked Payment's refund state so the Invoice Center can
// visually distinguish "still just a tax invoice" from "this appointment
// was later refunded" — real data, not a new document.
const documentTypeFor = (payment) => {
  if (!payment) return "tax_invoice";
  if (payment.refundStatus === REFUND_STATUS.FULL) return "refund_receipt";
  if (payment.refundStatus === REFUND_STATUS.PARTIAL) return "partial_refund_receipt";
  return "tax_invoice";
};

export const getInvoices = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = await ownershipFilter(req);
  // SECURITY (DOC-09 audit): this must stay admin-only. ownershipFilter()
  // now hard-scopes a doctor caller to their own doctorId (mirroring how
  // it already hard-scopes a patient to their own userId) — honoring an
  // arbitrary client-supplied doctorId for a doctor caller here would let
  // them widen that scope to any other doctor's invoices.
  if (req.query.doctorId && [ROLES.SUPER_ADMIN].includes(req.user.role)) {
    filter.doctorId = req.query.doctorId;
  }
  if (req.query.from || req.query.to) {
    filter.issuedAt = {};
    if (req.query.from) filter.issuedAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.issuedAt.$lte = new Date(req.query.to);
  }
  // PHASE UI-7 — Invoice Operations Workspace (admin). Additive filters
  // only; every existing caller (patient InvoiceHistory.jsx) omits these
  // params and is unaffected. userId is only honored for admin/super_admin
  // callers — ownershipFilter() already hard-scopes a patient caller to
  // their own userId, so a patient passing this param cannot widen their
  // own view.
  if (req.query.status && ["issued", "void"].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.userId && [ROLES.SUPER_ADMIN].includes(req.user.role)) filter.userId = req.query.userId;
  if (req.query.appointmentId) filter.appointmentId = req.query.appointmentId;
  if (req.query.paymentId) filter.paymentId = req.query.paymentId;
  if (req.query.minAmount || req.query.maxAmount) {
    filter.totalAmount = {};
    if (req.query.minAmount) filter.totalAmount.$gte = Number(req.query.minAmount);
    if (req.query.maxAmount) filter.totalAmount.$lte = Number(req.query.maxAmount);
  }
  if (req.query.search) {
    const regex = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { invoiceNumber: regex },
      { "patient.name": regex },
      { "patient.email": regex },
      { "doctor.name": regex },
      { "doctor.specialization": regex },
    ];
  }

  const sortField = ["issuedAt", "totalAmount"].includes(req.query.sortBy) ? req.query.sortBy : "issuedAt";
  const sortDir = req.query.sortDir === "asc" ? 1 : -1;

  const [invoices, total] = await Promise.all([
    Invoice.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
    Invoice.countDocuments(filter),
  ]);

  const paymentDocs = await Payment.find({ _id: { $in: invoices.map((i) => i.paymentId) } })
    .select("refundStatus refundedAmount totalAmount")
    .lean();
  const paymentById = new Map(paymentDocs.map((p) => [p._id.toString(), p]));

  const enrichedInvoices = invoices.map((invoice) => {
    const payment = paymentById.get(invoice.paymentId?.toString());
    return {
      ...invoice,
      documentType: documentTypeFor(payment),
      refundedAmount: payment?.refundedAmount || 0,
    };
  });

  res.status(200).json({
    success: true,
    data: { invoices: enrichedInvoices, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Invoices fetched successfully",
  });
});

// Invoice Center: expense/tax summary reused by the AI expense-summary
// feature and the Invoice Center header cards. Real aggregates only.
export const getInvoiceSummary = asyncHandler(async (req, res) => {
  const filter = await ownershipFilter(req);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  const [allTime, thisYear, byDoctor] = await Promise.all([
    Invoice.aggregate([
      { $match: filter },
      { $group: { _id: null, totalAmount: { $sum: "$totalAmount" }, totalTax: { $sum: "$taxAmount" }, count: { $sum: 1 } } },
    ]),
    Invoice.aggregate([
      { $match: { ...filter, issuedAt: { $gte: yearStart } } },
      { $group: { _id: null, totalAmount: { $sum: "$totalAmount" }, totalTax: { $sum: "$taxAmount" }, count: { $sum: 1 } } },
    ]),
    Invoice.aggregate([
      { $match: filter },
      { $group: { _id: "$doctor.name", totalAmount: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
      { $sort: { totalAmount: -1 } },
      { $limit: 5 },
    ]),
  ]);

  res.status(200).json({
    success: true,
    data: {
      allTime: allTime[0] || { totalAmount: 0, totalTax: 0, count: 0 },
      thisYear: thisYear[0] || { totalAmount: 0, totalTax: 0, count: 0 },
      topDoctorsByExpense: byDoctor.map((entry) => ({ doctorName: entry._id, totalAmount: entry.totalAmount, count: entry.count })),
    },
    message: "Invoice summary fetched successfully",
  });
});

export const getInvoiceById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid invoice id", 400);
  }

  const invoice = await Invoice.findOne({ _id: req.params.id, ...(await ownershipFilter(req)) }).lean();
  if (!invoice) throw new AppError("Invoice not found", 404);

  const payment = invoice.paymentId ? await Payment.findById(invoice.paymentId).select("refundStatus refundedAmount").lean() : null;

  res.status(200).json({
    success: true,
    data: { invoice: { ...invoice, documentType: documentTypeFor(payment), refundedAmount: payment?.refundedAmount || 0 } },
    message: "Invoice fetched successfully",
  });
});

export const downloadInvoice = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid invoice id", 400);
  }

  const invoice = await Invoice.findOne({ _id: req.params.id, ...(await ownershipFilter(req)) }).lean();
  if (!invoice?.pdfPath || !fs.existsSync(invoice.pdfPath)) {
    throw new AppError("Invoice PDF not found", 404);
  }

  res.download(invoice.pdfPath, `${invoice.invoiceNumber}.pdf`);
});
