import PDFDocument from "pdfkit";
import Appointment from "../../models/Appointment.js";
import Doctor from "../../models/Doctor.js";
import Payment from "../../models/Payment.js";
import User from "../../models/User.js";
import { ROLES } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";

const datasets = {
  appointments: async (filter) =>
    Appointment.find(filter)
      .populate("patientId", "name email")
      .populate({ path: "doctorId", populate: { path: "userId", select: "name email" } })
      .lean(),
  payments: async (filter) => Payment.find(filter).populate("userId", "name email").lean(),
  doctors: async () => Doctor.find().populate("userId", "name email").lean(),
  patients: async () => User.find({ role: ROLES.PATIENT }).select("name email isActive createdAt").lean(),
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

const toCsv = (rows) => {
  const headers = ["id", "name", "email", "status", "amount", "date"];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
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
  const rows = data.map(flatten);
  await writeAdminLog({ req, action: "export.run", resourceType: resource, severity: "warning", metadata: { format, rows: rows.length } });

  if (format === "pdf") {
    streamPdf(res, rows, resource);
    return;
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${resource}-export.csv"`);
  res.status(200).send(toCsv(rows));
});
