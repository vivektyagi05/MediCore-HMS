import fs from "fs";
import PDFDocument from "pdfkit";
import Appointment from "../../models/Appointment.js";
import Doctor from "../../models/Doctor.js";
import FamilyMember from "../../models/FamilyMember.js";
import Insurance from "../../models/Insurance.js";
import MedicalReport from "../../models/MedicalReport.js";
import Payment from "../../models/Payment.js";
import Prescription from "../../models/Prescription.js";
import Review from "../../models/Review.js";
import SavedDoctor from "../../models/SavedDoctor.js";
import User from "../../models/User.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";

const ownership = (req) => ({ userId: req.user._id });

const assertOwnedReport = async (req, id) => {
  const report = await MedicalReport.findOne({ _id: id, ...ownership(req) }).lean();
  if (!report) throw new AppError("Report not found", 404);
  return report;
};

const downloadFile = (res, filePath, fileName) => {
  if (!filePath || !fs.existsSync(filePath)) throw new AppError("File not found", 404);
  res.download(filePath, fileName);
};


export const listReports = asyncHandler(async (req, res) => {
  const filter = { ...ownership(req) };
  if (req.query.search) filter.$text = { $search: req.query.search };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.from || req.query.to) {
    filter.reportDate = {};
    if (req.query.from) filter.reportDate.$gte = new Date(req.query.from);
    if (req.query.to) filter.reportDate.$lte = new Date(req.query.to);
  }
  const reports = await MedicalReport.find(filter).populate("doctorId", "specialization userId").sort({ reportDate: -1 }).limit(100).lean();
  res.status(200).json({ success: true, data: { reports }, message: "Reports fetched successfully" });
});

export const uploadReport = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError("Report file is required", 400);
  if (!req.body.title || !req.body.category || !req.body.reportDate) throw new AppError("Title, category, and report date are required", 400);
  const report = await MedicalReport.create({
    userId: req.user._id,
    familyMemberId: req.body.familyMemberId || undefined,
    doctorId: req.body.doctorId || undefined,
    title: req.body.title,
    category: req.body.category,
    reportDate: new Date(req.body.reportDate),
    notes: req.body.notes || "",
    tags: req.body.tags ? req.body.tags.split(",").map((item) => item.trim()).filter(Boolean) : [],
    fileName: req.file.originalname,
    filePath: req.file.path,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
  res.status(201).json({ success: true, data: { report }, message: "Report uploaded successfully" });
});

export const downloadReport = asyncHandler(async (req, res) => {
  const report = await assertOwnedReport(req, req.params.id);
  downloadFile(res, report.filePath, report.fileName);
});

export const listPatientPrescriptions = asyncHandler(async (req, res) => {
  const filter = { patientId: req.user._id };
  if (req.query.search) filter.$text = { $search: req.query.search };
  const prescriptions = await Prescription.find(filter)
    .populate({ path: "doctorId", populate: { path: "userId", select: "name email" } })
    .populate("appointmentId", "date timeSlot")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.status(200).json({ success: true, data: { prescriptions }, message: "Prescriptions fetched successfully" });
});

export const downloadPatientPrescription = asyncHandler(async (req, res) => {
  const prescription = await Prescription.findOne({ _id: req.params.id, patientId: req.user._id }).lean();
  if (!prescription) throw new AppError("Prescription not found", 404);
  downloadFile(res, prescription.pdfPath, `prescription-${prescription._id}.pdf`);
});

export const listFamilyMembers = asyncHandler(async (req, res) => {
  const familyMembers = await FamilyMember.find(ownership(req)).sort({ createdAt: -1 }).lean();
  res.status(200).json({ success: true, data: { familyMembers }, message: "Family members fetched successfully" });
});

export const createFamilyMember = asyncHandler(async (req, res) => {
  const required = ["name", "relation", "age", "gender"];
  if (required.some((key) => req.body[key] === undefined || req.body[key] === "")) throw new AppError("Name, relation, age, and gender are required", 400);
  const familyMember = await FamilyMember.create({ ...req.body, userId: req.user._id });
  res.status(201).json({ success: true, data: { familyMember }, message: "Family member added successfully" });
});

export const updateFamilyMember = asyncHandler(async (req, res) => {
  const familyMember = await FamilyMember.findOneAndUpdate({ _id: req.params.id, ...ownership(req) }, req.body, { returnDocument: "after", runValidators: true });
  if (!familyMember) throw new AppError("Family member not found", 404);
  res.status(200).json({ success: true, data: { familyMember }, message: "Family member updated successfully" });
});

export const listInsurance = asyncHandler(async (req, res) => {
  const policies = await Insurance.find(ownership(req)).sort({ createdAt: -1 }).lean();
  res.status(200).json({ success: true, data: { policies }, message: "Insurance policies fetched successfully" });
});

export const createInsurance = asyncHandler(async (req, res) => {
  if (!req.body.provider || !req.body.policyNumber || !req.body.policyHolder || !req.body.validTill) throw new AppError("Insurance provider, policy number, holder, and validity are required", 400);
  const policy = await Insurance.create({
    ...req.body,
    userId: req.user._id,
    document: req.file ? { fileName: req.file.originalname, filePath: req.file.path, mimeType: req.file.mimetype, uploadedAt: new Date() } : undefined,
  });
  res.status(201).json({ success: true, data: { policy }, message: "Insurance policy saved successfully" });
});
const recalculateDoctorRating =
async (doctorId) => {

  const reviews =
    await Review.find({
      doctorId,
    });

  if (!reviews.length) {
    await Doctor.findByIdAndUpdate(
      doctorId,
      { rating: 0 }
    );
    return;
  }

  const avg =
    reviews.reduce(
      (sum, review) =>
        sum + review.rating,
      0
    ) / reviews.length;

  await Doctor.findByIdAndUpdate(
    doctorId,
    {
      rating:
        Number(avg.toFixed(1)),
    }
  );
};
export const listReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find(ownership(req)).populate({ path: "doctorId", populate: { path: "userId", select: "name" } }).sort({ createdAt: -1 }).lean();
  res.status(200).json({ success: true, data: { reviews }, message: "Reviews fetched successfully" });
});

export const upsertReview = asyncHandler(async (req, res) => {
  const appointment =
 await Appointment.findOne({
   _id: req.body.appointmentId,
   patientId: req.user._id,
 }).lean();

if (!appointment) {
  throw new AppError(
    "Appointment not found for this patient",
    404
  );
}

if (
  appointment.paymentStatus !==
  "paid"
) {
  throw new AppError(
    "Only paid appointments can be reviewed",
    400
  );
}

if (
  appointment.status !==
  "completed"
) {
  throw new AppError(
    "Only completed appointments can be reviewed",
    400
  );
}
  const existing = await Review.findOne({ userId: req.user._id, appointmentId: appointment._id });
  if (
    Number(req.body.rating) < 1 ||
    Number(req.body.rating) > 5
  ) {
    throw new AppError(
      "Rating must be between 1 and 5",
      400
    );
  }
  const review =
    await Review.findOneAndUpdate(
      {
        userId: req.user._id,
        appointmentId: appointment._id,
      },
      {
        doctorId: appointment.doctorId,
        rating: Number(req.body.rating),
        comment: req.body.comment || "",
        isEdited: Boolean(existing),
      },
      {
        returnDocument: "after",
        upsert: true,
        runValidators: true,
      }
    );

  await recalculateDoctorRating(
    appointment.doctorId
  );

  res.status(200).json({
    success: true,
    data: { review },
    message: "Review saved successfully",
  });
});

export const listSavedDoctors = asyncHandler(async (req, res) => {
  const savedDoctors = await SavedDoctor.find(ownership(req)).populate({ path: "doctorId", populate: { path: "userId", select: "name email" } }).sort({ createdAt: -1 }).lean();
  res.status(200).json({ success: true, data: { savedDoctors }, message: "Saved doctors fetched successfully" });
});

export const saveDoctor = asyncHandler(async (req, res) => {
  const savedDoctor = await SavedDoctor.findOneAndUpdate(
    { userId: req.user._id, doctorId: req.body.doctorId },
    { notes: req.body.notes || "" },
    { returnDocument: "after", upsert: true, runValidators: true },
  );
  res.status(200).json({ success: true, data: { savedDoctor }, message: "Doctor saved successfully" });
});

export const removeSavedDoctor = asyncHandler(async (req, res) => {
  await SavedDoctor.findOneAndDelete({ userId: req.user._id, doctorId: req.params.doctorId });
  res.status(200).json({ success: true, data: { doctorId: req.params.doctorId }, message: "Doctor removed from saved list" });
});

export const getProfileCompletion = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).lean();
  const [insuranceCount, reportCount] = await Promise.all([Insurance.countDocuments(ownership(req)), MedicalReport.countDocuments(ownership(req))]);
  const checks = [
    ["personal details", Boolean(user.name && user.email)],
    ["blood group", Boolean(user.patientProfile?.bloodGroup)],
    ["emergency contact", Boolean(user.patientProfile?.emergencyContact?.phone)],
    ["allergies", Boolean(user.patientProfile?.allergies?.length)],
    ["insurance", insuranceCount > 0],
    ["reports", reportCount > 0],
  ];
  const completed = checks.filter(([, ok]) => ok).length;
  res.status(200).json({ success: true, data: { percentage: Math.round((completed / checks.length) * 100), missing: checks.filter(([, ok]) => !ok).map(([label]) => label), profile: user.patientProfile || {} }, message: "Profile completion fetched successfully" });
});

export const updatePatientProfile = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user._id, { patientProfile: req.body.patientProfile }, { returnDocument: "after", runValidators: true }).select("-password");
  res.status(200).json({ success: true, data: { user }, message: "Profile updated successfully" });
});

export const getHealthTimeline = asyncHandler(async (req, res) => {
  const [appointments, prescriptions, reports, payments] = await Promise.all([
    Appointment.find({ patientId: req.user._id }).populate({ path: "doctorId", populate: { path: "userId", select: "name" } }).lean(),
    Prescription.find({ patientId: req.user._id }).lean(),
    MedicalReport.find(ownership(req)).lean(),
    Payment.find(ownership(req)).lean(),
  ]);
  const timeline = [
    ...appointments.map((item) => ({ type: "appointment", date: item.date, title: `Appointment with Dr. ${item.doctorId?.userId?.name || "Doctor"}`, data: item })),
    ...prescriptions.map((item) => ({ type: "prescription", date: item.createdAt, title: item.diagnosis, data: item })),
    ...reports.map((item) => ({ type: "report", date: item.reportDate, title: item.title, data: item })),
    ...payments.map((item) => ({ type: "payment", date: item.createdAt, title: `${item.currency} ${item.totalAmount} ${item.status}`, data: item })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));
  res.status(200).json({ success: true, data: { timeline }, message: "Health timeline fetched successfully" });
});

export const getPatientNotifications = asyncHandler(async (req, res) => {
  const [appointments, prescriptions, reports, insurance] = await Promise.all([
    Appointment.find({ patientId: req.user._id, status: { $in: ["pending", "approved"] } }).limit(5).lean(),
    Prescription.find({ patientId: req.user._id }).sort({ createdAt: -1 }).limit(5).lean(),
    MedicalReport.find(ownership(req)).sort({ createdAt: -1 }).limit(5).lean(),
    Insurance.find(ownership(req)).sort({ updatedAt: -1 }).limit(5).lean(),
  ]);
  const notifications = [
    ...appointments.map((item) => ({ type: "appointment", message: `Appointment ${item.status} for ${new Date(item.date).toLocaleDateString()}`, createdAt: item.updatedAt })),
    ...prescriptions.map((item) => ({ type: "prescription", message: `Prescription updated: ${item.diagnosis}`, createdAt: item.updatedAt })),
    ...reports.map((item) => ({ type: "report", message: `Report uploaded: ${item.title}`, createdAt: item.createdAt })),
    ...insurance.map((item) => ({ type: "insurance", message: `Insurance status: ${item.claimStatus}`, createdAt: item.updatedAt })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.status(200).json({ success: true, data: { notifications }, message: "Notifications fetched successfully" });
});

export const exportPatientData = asyncHandler(async (req, res) => {
  const resource = req.query.resource || "appointments";
  const format = req.query.format || "csv";
  const datasets = {
    appointments: () => Appointment.find({ patientId: req.user._id }).lean(),
    prescriptions: () => Prescription.find({ patientId: req.user._id }).lean(),
    reports: () => MedicalReport.find(ownership(req)).lean(),
  };
  if (!datasets[resource]) throw new AppError("Unsupported export resource", 400);
  const rows = await datasets[resource]();
  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 36 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${resource}.pdf"`);
    doc.pipe(res);
    doc.fontSize(18).text(`Patient ${resource} export`);
    rows.forEach((row) => doc.fontSize(9).text(JSON.stringify(row)));
    doc.end();
    return;
  }
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${resource}.csv"`);
  res.send(rows.map((row) => JSON.stringify(row).replaceAll(",", ";")).join("\n"));
});
