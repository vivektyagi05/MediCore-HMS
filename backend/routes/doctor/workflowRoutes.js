import path from "path";
import fs from "fs";
import multer from "multer";
import { Router } from "express";

import {
  createMedicalNote,
  createPrescription,
  downloadPrescription,
  exportDoctorData,
  getConsultationHistory,
  getDoctorAnalytics,
  getDoctorDocuments,
  getSchedule,
  listLeaves,
  listMedicalNotes,
  listPrescriptions,
  requestLeave,
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

export default router;