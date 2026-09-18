import PDFDocument from "pdfkit";
import Appointment from "../../models/Appointment.js";
import Doctor from "../../models/Doctor.js";
import Payment from "../../models/Payment.js";
import User from "../../models/User.js";
import { ROLES } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";

// PHASE 2-C — Section 24 bugfix: every dataset below queried its full
// collection with no row cap at all -- for a hospital with a large
// appointment/payment/patient history, one export request could load an
// unbounded number of documents into memory and hand them all back in a
// single response. Capped at EXPORT_ROW_CEILING (same bounded-query
// convention as GOVERNANCE_SCAN_CEILING/getUsers pagination elsewhere in
// this codebase); when a query is truncated the caller is told so
// explicitly via the `truncated` flag on the response rather than silently
// handing back a partial file that looks complete.
const EXPORT_ROW_CEILING = 5000;

const datasets = {
  appointments: async (filter) =>
    Appointment.find(filter)
      .sort({ createdAt: -1 })
      .limit(EXPORT_ROW_CEILING + 1)
      .populate("patientId", "name email")
      .populate({ path: "doctorId", populate: { path: "userId", select: "name email" } })
      .lean(),
  payments: async (filter) =>
    Payment.find(filter).sort({ createdAt: -1 }).limit(EXPORT_ROW_CEILING + 1).populate("userId", "name email").lean(),
  doctors: async () => Doctor.find().sort({ createdAt: -1 }).limit(EXPORT_ROW_CEILING + 1).populate("userId", "name email").lean(),
  patients: async () =>
    User.find({ role: ROLES.PATIENT }).sort({ createdAt: -1 }).limit(EXPORT_ROW_CEILING + 1).select("name email isActive createdAt").lean(),
};

const dateFilter = (query) => {
  const filter = {};
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }
  if (query.status) filter.status = query.status;
  if (query.minRevenue || query.maxRevenue) {
    filter.totalAmount = {};
    if (query.minRevenue) filter.totalAmount.$gte = Number(query.minRevenue);
    if (query.maxRevenue) filter.totalAmount.$lte = Number(query.maxRevenue);
  }
  return filter;
};

const flatten = (row) => ({
  id: row._id?.toString(),
  name: row.name || row.title || row.userId?.name || row.patientId?.name || row.doctorId?.userId?.name || "",
  email: row.email || row.userId?.email || row.patientId?.email || "",
  status: row.status || row.paymentStatus || "",
  amount: row.totalAmount || row.fees || "",
  date: row.createdAt ? new Date(row.createdAt).toISOString() : "",
});

// PHASE 2-C — Section 24 bugfix: this escaping neutralized double-quotes
// (correct CSV syntax) but did nothing about CSV/formula injection --
// a patient or doctor `name` beginning with =, +, -, or @ (fully
// user-controlled, real registration data) opens as a live formula the
// instant the exported file is opened in Excel/Sheets/Numbers, e.g. a name
// of `=cmd|'/c calc'!A0`. Prefixing a leading single quote for those four
// characters is the standard mitigation and matches the exact character
// set named in the brief; it only affects display (spreadsheet software
// treats the prefix as "force text"), so legitimate values are unaffected.
const FORMULA_LEAD_CHARS = ["=", "+", "-", "@"];

const neutralizeFormulaInjection = (value) => {
  const str = String(value ?? "");
  return FORMULA_LEAD_CHARS.includes(str[0]) ? `'${str}` : str;
};

const toCsv = (rows) => {
  const headers = ["id", "name", "email", "status", "amount", "date"];
  const escape = (value) => `"${neutralizeFormulaInjection(value).replaceAll('"', '""')}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((key) => escape(row[key])).join(","))].join("\n");
};

const streamPdf = (res, rows, resource) => {
  const doc = new PDFDocument({ margin: 36 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${resource}-export.pdf"`);
  doc.pipe(res);
  doc.fontSize(18).font("Helvetica-Bold").text(`HMS ${resource} export`);
  doc.moveDown();
  rows.forEach((row) => {
    doc.fontSize(9).font("Helvetica").text(`${row.id} | ${row.name} | ${row.email} | ${row.status} | ${row.amount} | ${row.date}`);
  });
  doc.end();
};

export const exportData = asyncHandler(async (req, res) => {
  const { resource, format = "csv" } = req.query;
  if (!datasets[resource]) throw new AppError("Unsupported export resource", 400);
  if (!["csv", "pdf"].includes(format)) throw new AppError("Unsupported export format", 400);

  const data = await datasets[resource](dateFilter(req.query));
  // Section 24: datasets are fetched with a +1 over-fetch (see
  // EXPORT_ROW_CEILING above) so truncation can be detected and disclosed
  // instead of silently handing back a partial file that looks complete.
  const truncated = data.length > EXPORT_ROW_CEILING;
  const rows = data.slice(0, EXPORT_ROW_CEILING).map(flatten);
  await writeAdminLog({
    req,
    action: "export.run",
    resourceType: resource,
    severity: "warning",
    metadata: { format, rows: rows.length, truncated },
  });

  res.setHeader("X-Export-Truncated", truncated ? "true" : "false");

  if (format === "pdf") {
    streamPdf(res, rows, resource);
    return;
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${resource}-export.csv"`);
  res.status(200).send(toCsv(rows));
});
