import path from "path";
import fs from "fs";
import multer from "multer";
import { Router } from "express";

import {
  addFavouriteMedicine,
  applyScheduleTemplate,
  checkPrescriptionSafety,
  createCertificate,
  createMedicalNote,
  createMedicineTemplate,
  createPrescription,
  deleteDoctorDocument,
  deleteMedicineTemplate,
  deleteScheduleTemplate,
  downloadCertificate,
  downloadPatientReportForDoctor,
  downloadPrescription,
  exportDoctorData,
  getConsultationHistory,
  getDoctorAnalytics,
  getDoctorDocuments,
  getDocumentCenterOverview,
  getPatientClinicalProfile,
  getPatientReportsForDoctor,
  markPatientReportReviewed,
  getSchedule,
  getScheduleDay,
  getScheduleRange,
  scheduleFollowUpAppointment,
  listCertificates,
  listFavouriteMedicines,
  listLeaves,
  listMedicalNotes,
  listMedicineTemplates,
  listPrescriptions,
  listScheduleTemplates,
  removeFavouriteMedicine,
  requestLeave,
  revokeCertificate,
  saveScheduleTemplate,
  updateLeaveStatus,
  updatePrescription,
  updateSchedule,
  uploadDoctorDocument,
} from "../../controllers/doctor/workflowController.js";

import { ROLES } from "../../constants/roles.js";
import { protect } from "../../middleware/authMiddleware.js";
import { authorizeRoles } from "../../middleware/roleMiddleware.js";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync("storage/doctor-documents", { recursive: true });
    cb(null, "storage/doctor-documents");
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/png",
      "image/jpeg",
    ];

    cb(null, allowed.includes(file.mimetype));
  },
});

const router = Router();

router.use(protect);

router.get(
  "/prescriptions",
  authorizeRoles(ROLES.DOCTOR),
  listPrescriptions
);

router.post(
  "/prescriptions",
  authorizeRoles(ROLES.DOCTOR),
  createPrescription
);

router.put(
  "/prescriptions/:id",
  authorizeRoles(ROLES.DOCTOR),
  updatePrescription
);

router.get(
  "/prescriptions/:id/download",
  authorizeRoles(ROLES.DOCTOR),
  downloadPrescription
);

router.get(
  "/notes",
  authorizeRoles(ROLES.DOCTOR),
  listMedicalNotes
);

router.post(
  "/notes",
  authorizeRoles(ROLES.DOCTOR),
  createMedicalNote
);

router.get(
  "/history",
  authorizeRoles(ROLES.DOCTOR),
  getConsultationHistory
);

router.get(
  "/schedule",
  authorizeRoles(ROLES.DOCTOR),
  getSchedule
);

router.get(
  "/schedule/day",
  authorizeRoles(ROLES.DOCTOR),
  getScheduleDay
);

// Phase DOC-07 final pass — Week/Month view intelligence (bounded range).
router.get(
  "/schedule/range",
  authorizeRoles(ROLES.DOCTOR),
  getScheduleRange
);

// Phase DOC-07 final pass — Follow-up → Real Scheduling.
router.post(
  "/patients/:patientId/schedule-follow-up",
  authorizeRoles(ROLES.DOCTOR),
  scheduleFollowUpAppointment
);

router.put(
  "/schedule",
  authorizeRoles(ROLES.DOCTOR),
  updateSchedule
);

router.get(
  "/leaves",
  authorizeRoles(
    ROLES.DOCTOR,
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN
  ),
  listLeaves
);

router.post(
  "/leaves",
  authorizeRoles(ROLES.DOCTOR),
  requestLeave
);

router.put(
  "/leaves/:id/status",
  authorizeRoles(
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN
  ),
  updateLeaveStatus
);

router.get(
  "/documents",
  authorizeRoles(ROLES.DOCTOR),
  getDoctorDocuments
);

router.post(
  "/documents",
  authorizeRoles(ROLES.DOCTOR),
  upload.single("document"),
  uploadDoctorDocument
);

router.delete(
  "/documents/:id",
  authorizeRoles(ROLES.DOCTOR),
  deleteDoctorDocument
);

router.get(
  "/documents/overview",
  authorizeRoles(ROLES.DOCTOR),
  getDocumentCenterOverview
);

router.get(
  "/analytics",
  authorizeRoles(ROLES.DOCTOR),
  getDoctorAnalytics
);

router.get(
  "/exports",
  authorizeRoles(ROLES.DOCTOR),
  exportDoctorData
);

// ── Prescription Intelligence ──
router.post(
  "/prescriptions/check",
  authorizeRoles(ROLES.DOCTOR),
  checkPrescriptionSafety
);

router.get(
  "/medicine-templates",
  authorizeRoles(ROLES.DOCTOR),
  listMedicineTemplates
);

router.post(
  "/medicine-templates",
  authorizeRoles(ROLES.DOCTOR),
  createMedicineTemplate
);

router.delete(
  "/medicine-templates/:id",
  authorizeRoles(ROLES.DOCTOR),
  deleteMedicineTemplate
);

router.get(
  "/favourite-medicines",
  authorizeRoles(ROLES.DOCTOR),
  listFavouriteMedicines
);

router.post(
  "/favourite-medicines",
  authorizeRoles(ROLES.DOCTOR),
  addFavouriteMedicine
);

router.delete(
  "/favourite-medicines/:id",
  authorizeRoles(ROLES.DOCTOR),
  removeFavouriteMedicine
);

// ── Certificate Generator ──
router.get(
  "/certificates",
  authorizeRoles(ROLES.DOCTOR),
  listCertificates
);

router.post(
  "/certificates",
  authorizeRoles(ROLES.DOCTOR),
  createCertificate
);

router.get(
  "/certificates/:id/download",
  authorizeRoles(ROLES.DOCTOR),
  downloadCertificate
);

router.put(
  "/certificates/:id/revoke",
  authorizeRoles(ROLES.DOCTOR),
  revokeCertificate
);

// ── Scheduling Intelligence: Session Templates ──
router.get(
  "/schedule/templates",
  authorizeRoles(ROLES.DOCTOR),
  listScheduleTemplates
);

router.post(
  "/schedule/templates",
  authorizeRoles(ROLES.DOCTOR),
  saveScheduleTemplate
);

router.delete(
  "/schedule/templates/:id",
  authorizeRoles(ROLES.DOCTOR),
  deleteScheduleTemplate
);

router.post(
  "/schedule/templates/:id/apply",
  authorizeRoles(ROLES.DOCTOR),
  applyScheduleTemplate
);

// ── Patient Clinical Snapshot / Reports (Clinical Workspace) ──
router.get(
  "/patients/:patientId/clinical-profile",
  authorizeRoles(ROLES.DOCTOR),
  getPatientClinicalProfile
);

router.get(
  "/patients/:patientId/reports",
  authorizeRoles(ROLES.DOCTOR),
  getPatientReportsForDoctor
);

router.get(
  "/patients/:patientId/reports/:reportId/download",
  authorizeRoles(ROLES.DOCTOR),
  downloadPatientReportForDoctor
);

// PHASE P6 — Report Review (see markPatientReportReviewed for why this is
// a second, correctly-scoped entry point rather than a duplicate engine).
router.patch(
  "/patients/:patientId/reports/:reportId/review",
  authorizeRoles(ROLES.DOCTOR),
  markPatientReportReviewed
);

export default router;