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
import { requireApprovedDoctor } from "../../middleware/doctorAccessMiddleware.js";

// PHASE 2-B — Section 8: every doctor-role route below is real clinical/
// practice functionality (prescriptions, schedule, certificates,
// analytics, ...) and requires an approved doctor. The /documents* routes
// are deliberately excluded below (see doctorAccessMiddleware.js) since
// uploading verification documents is part of the pending application
// itself, not a post-approval feature.
const authorizeApprovedDoctor = [authorizeRoles(ROLES.DOCTOR), requireApprovedDoctor];

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
  ...authorizeApprovedDoctor,
  listPrescriptions
);

router.post(
  "/prescriptions",
  ...authorizeApprovedDoctor,
  createPrescription
);

router.put(
  "/prescriptions/:id",
  ...authorizeApprovedDoctor,
  updatePrescription
);

router.get(
  "/prescriptions/:id/download",
  ...authorizeApprovedDoctor,
  downloadPrescription
);

router.get(
  "/notes",
  ...authorizeApprovedDoctor,
  listMedicalNotes
);

router.post(
  "/notes",
  ...authorizeApprovedDoctor,
  createMedicalNote
);

router.get(
  "/history",
  ...authorizeApprovedDoctor,
  getConsultationHistory
);

router.get(
  "/schedule",
  ...authorizeApprovedDoctor,
  getSchedule
);

router.get(
  "/schedule/day",
  ...authorizeApprovedDoctor,
  getScheduleDay
);

// Phase DOC-07 final pass — Week/Month view intelligence (bounded range).
router.get(
  "/schedule/range",
  ...authorizeApprovedDoctor,
  getScheduleRange
);

// Phase DOC-07 final pass — Follow-up → Real Scheduling.
router.post(
  "/patients/:patientId/schedule-follow-up",
  ...authorizeApprovedDoctor,
  scheduleFollowUpAppointment
);

router.put(
  "/schedule",
  ...authorizeApprovedDoctor,
  updateSchedule
);

router.get(
  "/leaves",
  authorizeRoles(
    ROLES.DOCTOR,
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
  ...authorizeApprovedDoctor,
  getDoctorAnalytics
);

router.get(
  "/exports",
  ...authorizeApprovedDoctor,
  exportDoctorData
);

// ── Prescription Intelligence ──
router.post(
  "/prescriptions/check",
  ...authorizeApprovedDoctor,
  checkPrescriptionSafety
);

router.get(
  "/medicine-templates",
  ...authorizeApprovedDoctor,
  listMedicineTemplates
);

router.post(
  "/medicine-templates",
  ...authorizeApprovedDoctor,
  createMedicineTemplate
);

router.delete(
  "/medicine-templates/:id",
  ...authorizeApprovedDoctor,
  deleteMedicineTemplate
);

router.get(
  "/favourite-medicines",
  ...authorizeApprovedDoctor,
  listFavouriteMedicines
);

router.post(
  "/favourite-medicines",
  ...authorizeApprovedDoctor,
  addFavouriteMedicine
);

router.delete(
  "/favourite-medicines/:id",
  ...authorizeApprovedDoctor,
  removeFavouriteMedicine
);

// ── Certificate Generator ──
router.get(
  "/certificates",
  ...authorizeApprovedDoctor,
  listCertificates
);

router.post(
  "/certificates",
  ...authorizeApprovedDoctor,
  createCertificate
);

router.get(
  "/certificates/:id/download",
  ...authorizeApprovedDoctor,
  downloadCertificate
);

router.put(
  "/certificates/:id/revoke",
  ...authorizeApprovedDoctor,
  revokeCertificate
);

// ── Scheduling Intelligence: Session Templates ──
router.get(
  "/schedule/templates",
  ...authorizeApprovedDoctor,
  listScheduleTemplates
);

router.post(
  "/schedule/templates",
  ...authorizeApprovedDoctor,
  saveScheduleTemplate
);

router.delete(
  "/schedule/templates/:id",
  ...authorizeApprovedDoctor,
  deleteScheduleTemplate
);

router.post(
  "/schedule/templates/:id/apply",
  ...authorizeApprovedDoctor,
  applyScheduleTemplate
);

// ── Patient Clinical Snapshot / Reports (Clinical Workspace) ──
router.get(
  "/patients/:patientId/clinical-profile",
  ...authorizeApprovedDoctor,
  getPatientClinicalProfile
);

router.get(
  "/patients/:patientId/reports",
  ...authorizeApprovedDoctor,
  getPatientReportsForDoctor
);

router.get(
  "/patients/:patientId/reports/:reportId/download",
  ...authorizeApprovedDoctor,
  downloadPatientReportForDoctor
);

// PHASE P6 — Report Review (see markPatientReportReviewed for why this is
// a second, correctly-scoped entry point rather than a duplicate engine).
router.patch(
  "/patients/:patientId/reports/:reportId/review",
  ...authorizeApprovedDoctor,
  markPatientReportReviewed
);

export default router;