import path from "path";
import fs from "fs";
import multer from "multer";
import { Router } from "express";
import {
  createFamilyMember,
  createInsurance,
  downloadPatientPrescription,
  downloadReport,
  exportPatientData,
  getHealthTimeline,
  getPatientNotifications,
  getProfileCompletion,
  listFamilyMembers,
  listInsurance,
  listPatientPrescriptions,
  listReports,
  listReviews,
  listSavedDoctors,
  removeSavedDoctor,
  saveDoctor,
  updateFamilyMember,
  updatePatientProfile,
  uploadReport,
  upsertReview,
} from "../../controllers/patient/patientWorkflowController.js";
import { ROLES } from "../../constants/roles.js";
import { protect } from "../../middleware/authMiddleware.js";
import { authorizeRoles } from "../../middleware/roleMiddleware.js";

const makeStorage = (destination) =>
  multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(destination, { recursive: true });
      cb(null, destination);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });

const fileFilter = (_req, file, cb) => {
  const allowed = ["application/pdf", "image/png", "image/jpeg"];
  cb(null, allowed.includes(file.mimetype));
};

const reportUpload = multer({
  storage: makeStorage("storage/patient-reports"),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter,
});

const insuranceUpload = multer({
  storage: makeStorage("storage/insurance-documents"),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter,
});

const router = Router();

router.use(protect, authorizeRoles(ROLES.PATIENT));

router.get("/reports", listReports);
router.post("/reports", reportUpload.single("report"), uploadReport);
router.get("/reports/:id/download", downloadReport);

router.get("/prescriptions", listPatientPrescriptions);
router.get("/prescriptions/:id/download", downloadPatientPrescription);

router.get("/family", listFamilyMembers);
router.post("/family", createFamilyMember);
router.put("/family/:id", updateFamilyMember);

router.get("/insurance", listInsurance);
router.post("/insurance", insuranceUpload.single("document"), createInsurance);

router.get("/reviews", listReviews);
router.post("/reviews", upsertReview);

router.get("/saved-doctors", listSavedDoctors);
router.post("/saved-doctors", saveDoctor);
router.delete("/saved-doctors/:doctorId", removeSavedDoctor);

router.get("/profile-completion", getProfileCompletion);
router.put("/profile", updatePatientProfile);
router.get("/timeline", getHealthTimeline);
router.get("/notifications", getPatientNotifications);
router.get("/exports", exportPatientData);

export default router;
