import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import Appointment from "../../models/Appointment.js";
import ConsultationHistory from "../../models/ConsultationHistory.js";
import Doctor from "../../models/Doctor.js";
import LeaveRequest from "../../models/LeaveRequest.js";
import MedicalNote from "../../models/MedicalNote.js";
import Payment from "../../models/Payment.js";
import Prescription from "../../models/Prescription.js";
import { APPOINTMENT_STATUS } from "../../constants/appointmentStatus.js";
import { ROLES } from "../../constants/roles.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { ensureDoctorProfileForUser } from "../../services/doctorProfileService.js";

const getDoctorProfile = async (userId) => {
  return ensureDoctorProfileForUser(userId);
};

const ensureAppointmentOwned = async (doctorId, appointmentId) => {
  const appointment = await Appointment.findOne({ _id: appointmentId, doctorId })
    .populate("patientId", "name email")
    .populate({ path: "doctorId", populate: { path: "userId", select: "name email" } });
  if (!appointment) throw new AppError("Appointment not found for this doctor", 404);
  return appointment;
};

const normalizeDate = (value) => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const parseRequiredDate = (value, fieldName) => {
  if (!value) {
    throw new AppError(`${fieldName} is required`, 400);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${fieldName} must be a valid date`, 400);
  }

  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const createPrescriptionPdf = async (prescription, appointment) => {
  const dir = path.resolve(process.cwd(), "storage/prescriptions");
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `RX-${prescription._id}.pdf`);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(20).font("Helvetica-Bold").text("HMS Pro Prescription");
    doc.moveDown();
    doc.fontSize(10).font("Helvetica").text(`Patient: ${appointment.patientId.name}`);
    doc.text(`Doctor: Dr. ${appointment.doctorId.userId.name}`);
    doc.text(`Date: ${new Date(prescription.createdAt).toLocaleDateString()}`);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Diagnosis");
    doc.font("Helvetica").text(prescription.diagnosis);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Medicines");
    prescription.medicines.forEach((medicine) => {
      doc.font("Helvetica").text(`${medicine.name} - ${medicine.dosage}, ${medicine.frequency}, ${medicine.duration}`);
      if (medicine.instructions) doc.text(`Instructions: ${medicine.instructions}`);
    });
    doc.moveDown();
    if (prescription.notes) doc.text(`Notes: ${prescription.notes}`);
    if (prescription.followUpDate) doc.text(`Follow-up: ${new Date(prescription.followUpDate).toLocaleDateString()}`);
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return filePath;
};

const upsertHistoryLink = async ({ doctorId, patientId, appointmentId, prescriptionId, noteId }) => {
  const update = {};
  if (prescriptionId) update.$addToSet = { prescriptionIds: prescriptionId };
  if (noteId) update.$addToSet = { ...(update.$addToSet || {}), noteIds: noteId };
  await ConsultationHistory.findOneAndUpdate(
    { doctorId, patientId, appointmentId },
    { ...update, $setOnInsert: { doctorId, patientId, appointmentId } },
    { upsert: true, returnDocument: "after" },
  );
};

export const listPrescriptions = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const filter = { doctorId: doctor._id };
  if (req.query.search) filter.$text = { $search: req.query.search };
  if (req.query.patientId) filter.patientId = req.query.patientId;
  const prescriptions = await Prescription.find(filter).populate("patientId", "name email").sort({ createdAt: -1 }).limit(100).lean();
  res.status(200).json({ success: true, data: { prescriptions }, message: "Prescriptions fetched successfully" });
});
export const createPrescription = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);

  const {
    appointmentId,
    diagnosis,
    medicines,
    notes,
    followUpDate,
  } = req.body;

  if (!diagnosis || !Array.isArray(medicines) || medicines.length === 0) {
    throw new AppError(
      "Diagnosis and at least one medicine are required",
      400
    );
  }

  const appointment = await Appointment.findById(appointmentId)
    .populate("patientId", "name email")
    .populate({
      path: "doctorId",
      populate: {
        path: "userId",
        select: "name email",
      },
    });

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  if (
    appointment.doctorId._id.toString() !==
    doctor._id.toString()
  ) {
    throw new AppError(
      "You can create prescription only for your patients",
      403
    );
  }

  if (
    appointment.status !==
    APPOINTMENT_STATUS.COMPLETED
  ) {
    throw new AppError(
      "Appointment must be completed before prescription",
      400
    );
  }

  const existingPrescription =
    await Prescription.findOne({
      appointmentId,
      status: "active",
    });

  if (existingPrescription) {
    throw new AppError(
      "Prescription already exists for this appointment",
      409
    );
  }

  const prescription = await Prescription.create({
    doctorId: doctor._id,
    patientId: appointment.patientId._id,
    appointmentId,
    diagnosis,
    medicines,
    notes,
    followUpDate,
  });

  prescription.pdfPath =
    await createPrescriptionPdf(
      prescription,
      appointment
    );

  await prescription.save();

  await upsertHistoryLink({
    doctorId: doctor._id,
    patientId: appointment.patientId._id,
    appointmentId,
    prescriptionId: prescription._id,
  });

  res.status(201).json({
    success: true,
    data: { prescription },
    message: "Prescription created successfully",
  });
});

export const updatePrescription = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const prescription = await Prescription.findOneAndUpdate(
    { _id: req.params.id, doctorId: doctor._id },
    req.body,
    { returnDocument: "after", runValidators: true },
  );
  if (!prescription) throw new AppError("Prescription not found", 404);
  res.status(200).json({ success: true, data: { prescription }, message: "Prescription updated successfully" });
});

export const downloadPrescription = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const prescription = await Prescription.findOne({ _id: req.params.id, doctorId: doctor._id }).lean();
  if (!prescription?.pdfPath || !fs.existsSync(prescription.pdfPath)) throw new AppError("Prescription PDF not found", 404);
  res.download(prescription.pdfPath, `prescription-${prescription._id}.pdf`);
});

export const listMedicalNotes = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const filter = { doctorId: doctor._id };
  if (req.query.search) filter.$text = { $search: req.query.search };
  if (req.query.appointmentId) filter.appointmentId = req.query.appointmentId;
  const notes = await MedicalNote.find(filter).populate("patientId", "name email").sort({ createdAt: -1 }).limit(100).lean();
  res.status(200).json({ success: true, data: { notes }, message: "Medical notes fetched successfully" });
});

export const createMedicalNote = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const appointment = await ensureAppointmentOwned(doctor._id, req.body.appointmentId);
  
  if (!req.body.notes) throw new AppError("Clinical note is required", 400);
  if (
    appointment.status !==
    APPOINTMENT_STATUS.COMPLETED
  ) {
    throw new AppError(
      "Clinical notes can only be added after consultation",
      400
    );
  }
  const note = await MedicalNote.create({
    doctorId: doctor._id,
    patientId: appointment.patientId._id,
    appointmentId: appointment._id,
    symptoms: req.body.symptoms || [],
    notes: req.body.notes,
    recommendations: req.body.recommendations || "",
    attachments: req.body.attachments || [],
  });
  await upsertHistoryLink({ doctorId: doctor._id, patientId: appointment.patientId._id, appointmentId: appointment._id, noteId: note._id });
  res.status(201).json({ success: true, data: { note }, message: "Medical note saved successfully" });
});

export const getConsultationHistory = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const filter = { doctorId: doctor._id };
  if (req.query.patientId) filter.patientId = req.query.patientId;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }
  const history = await ConsultationHistory.find(filter)
    .populate("patientId", "name email")
    .populate("appointmentId", "date timeSlot status paymentStatus")
    .populate("prescriptionIds")
    .populate("noteIds")
    .populate("paymentId", "totalAmount status")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.status(200).json({ success: true, data: { history }, message: "Consultation history fetched successfully" });
});

export const getSchedule = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const appointments = await Appointment.find({ doctorId: doctor._id, status: { $in: [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.APPROVED] } }).select("date timeSlot status").lean();
  res.status(200).json({ success: true, data: { availability: doctor.availability, blockedDates: doctor.blockedDates, appointments }, message: "Schedule fetched successfully" });
});

export const updateSchedule = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const availability = req.body.availability || doctor.availability;
  const duplicateCheck = new Set();
  for (const day of availability) {
    for (const slot of day.timeSlots || []) {
      const key = `${day.dayOfWeek}:${slot}`;
      if (duplicateCheck.has(key)) throw new AppError("Overlapping or duplicate slots are not allowed", 400);
      duplicateCheck.add(key);
    }
  }
  doctor.availability = availability;
  if (req.body.blockedDates) doctor.blockedDates = req.body.blockedDates.map((item) => ({ ...item, date: normalizeDate(item.date) }));
  await doctor.save();
  res.status(200).json({ success: true, data: { doctor }, message: "Schedule updated successfully" });
});

export const requestLeave = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const startDate = parseRequiredDate(req.body.startDate, "Start date");
  const endDate = parseRequiredDate(req.body.endDate, "End date");
  if (!req.body.reason?.trim()) throw new AppError("Leave reason is required", 400);
  if (endDate < startDate) throw new AppError("Leave end date cannot be before start date", 400);
  const conflict = await LeaveRequest.findOne({
    doctorId: doctor._id,
    status: { $in: ["pending", "approved"] },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  }).lean();
  if (conflict) throw new AppError("Leave request overlaps with an existing leave", 409);
  const leave = await LeaveRequest.create({ doctorId: doctor._id, userId: req.user._id, startDate, endDate, reason: req.body.reason.trim() });
  res.status(201).json({ success: true, data: { leave }, message: "Leave request submitted successfully" });
});

export const listLeaves = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === ROLES.DOCTOR) {
    const doctor = await getDoctorProfile(req.user._id);
    filter.doctorId = doctor._id;
  }
  if (req.query.status) filter.status = req.query.status;
  const leaves = await LeaveRequest.find(filter).populate("userId", "name email role").sort({ createdAt: -1 }).limit(100).lean();
  res.status(200).json({ success: true, data: { leaves }, message: "Leave requests fetched successfully" });
});

export const updateLeaveStatus = asyncHandler(async (req, res) => {
  if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role)) throw new AppError("Admin access is required", 403);
  const leave = await LeaveRequest.findById(req.params.id);
  if (!leave) throw new AppError("Leave request not found", 404);
  leave.status = req.body.status;
  leave.adminComment = req.body.adminComment || "";
  leave.reviewedBy = req.user._id;
  leave.reviewedAt = new Date();
  await leave.save();
  if (leave.status === "approved") {
    await Doctor.findByIdAndUpdate(leave.doctorId, { $addToSet: { blockedDates: { date: leave.startDate, reason: leave.reason } } });
  }
  res.status(200).json({ success: true, data: { leave }, message: "Leave request updated successfully" });
});

export const uploadDoctorDocument = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  if (!req.file) throw new AppError("Document file is required", 400);
  const document = {
    type: req.body.type || "other",
    title: req.body.title || req.file.originalname,
    fileName: req.file.originalname,
    filePath: req.file.path,
    mimeType: req.file.mimetype,
  };
  doctor.documents.push(document);
  await doctor.save();
  res.status(201).json({ success: true, data: { document: doctor.documents.at(-1) }, message: "Document uploaded successfully" });
});

export const getDoctorDocuments = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  res.status(200).json({ success: true, data: { documents: doctor.documents }, message: "Documents fetched successfully" });
});

export const getDoctorAnalytics = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const [appointments, revenue] = await Promise.all([
    Appointment.find({ doctorId: doctor._id }).lean(),
    Payment.aggregate([{ $match: { doctorId: doctor._id } }, { $group: { _id: null, total: { $sum: "$totalAmount" }, count: { $sum: 1 } } }]),
  ]);
  const completed = appointments.filter((item) => item.status === "completed").length;
  const cancelled = appointments.filter((item) => item.status === "cancelled").length;
  const uniquePatients = new Set(appointments.map((item) => item.patientId.toString()));
  res.status(200).json({
    success: true,
    data: {
      completed,
      averageRating: doctor.rating,
      patientReturnRatio: appointments.length ? Number(((appointments.length - uniquePatients.size) / appointments.length).toFixed(2)) : 0,
      revenue: revenue[0]?.total || 0,
      cancellationRate: appointments.length ? Number((cancelled / appointments.length).toFixed(2)) : 0,
    },
    message: "Doctor analytics fetched successfully",
  });
});

export const exportDoctorData = asyncHandler(async (req, res) => {
  const doctor = await getDoctorProfile(req.user._id);
  const resource = req.query.resource || "prescriptions";
  const format = req.query.format || "csv";
  const data = resource === "schedules"
    ? doctor.availability
    : await Prescription.find({ doctorId: doctor._id }).populate("patientId", "name email").lean();
  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 36 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${resource}.pdf"`);
    doc.pipe(res);
    doc.fontSize(18).text(`Doctor ${resource} export`);
    doc.moveDown();
    data.forEach((item) => doc.fontSize(9).text(JSON.stringify(item)));
    doc.end();
    return;
  }
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${resource}.csv"`);
  res.send(data.map((item) => JSON.stringify(item).replaceAll(",", ";")).join("\n"));
});
