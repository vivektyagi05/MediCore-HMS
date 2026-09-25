import { requireFeatureEnabled } from "../../services/featureToggleService.js";
import { localCategoryDir } from "../../storage/storageService.js";
import path from "path";
import multer from "multer";
import { Router } from "express";
import {
  createFamilyMember,
  createInsurance,
  deactivateFamilyMember,
  deleteInsurance,
  deleteReport,
  downloadPatientCertificate,
  downloadPatientPrescription,
  downloadReport,
  exportPatientData,
  getFamilyMemberWorkspace,
  getHealthEcosystemOverview,
  getHealthJourney,
  getHealthProfileOverview,
  getHealthTimeline,
  getInsuranceUtilization,
  getPatientNotifications,
  getProfileCompletion,
  getReportCategories,
  listFamilyMembers,
  listInsurance,
  listPatientCertificates,
  listPatientPrescriptions,
  listReports,
  listReviews,
  listSavedDoctors,
  removeSavedDoctor,
  saveDoctor,
  submitInsuranceClaim,
  updateInsurance,
  updateReport,
  updateSavedDoctor,
  updateFamilyMember,
  updatePatientProfile,
  uploadReport,
  upsertReview,
} from "../../controllers/patient/patientWorkflowController.js";
import { ROLES } from "../../constants/roles.js";
import { protect } from "../../middleware/authMiddleware.js";
import { authorizeRoles } from "../../middleware/roleMiddleware.js";

const makeStorage = (category) =>
  multer.diskStorage({
    // DOCKER-PATH FIX: was a bare "storage/..." string resolved against
    // process.cwd() -- inside the built image that is /app, not
    // /app/backend/storage (the actual persistent volume mount point; see
    // docker-compose.yml and storage/storageService.js). localCategoryDir()
    // resolves against the same absolute, Docker-volume-matching root every
    // other storage consumer now uses.
    destination: (_req, _file, cb) => cb(null, localCategoryDir(category)),
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
  storage: makeStorage("patient-reports"),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter,
});

const insuranceUpload = multer({
  storage: makeStorage("insurance-documents"),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter,
});

const router = Router();

router.use(protect, authorizeRoles(ROLES.PATIENT));

router.get("/health-ecosystem/overview", getHealthEcosystemOverview);

router.get("/reports", listReports);
router.get("/reports/categories", getReportCategories);
router.post("/reports", reportUpload.single("report"), uploadReport);
router.patch("/reports/:id", updateReport);
router.delete("/reports/:id", deleteReport);
router.get("/reports/:id/download", downloadReport);

router.get("/prescriptions", listPatientPrescriptions);
router.get("/prescriptions/:id/download", downloadPatientPrescription);

router.get("/certificates", listPatientCertificates);
router.get("/certificates/:id/download", downloadPatientCertificate);

router.get("/family", listFamilyMembers);
router.post("/family", createFamilyMember);
router.put("/family/:id", updateFamilyMember);
router.delete("/family/:id", deactivateFamilyMember);
router.get("/family/:id/workspace", getFamilyMemberWorkspace);

router.get("/insurance", listInsurance);
router.post("/insurance", insuranceUpload.single("document"), createInsurance);
router.patch("/insurance/:id", insuranceUpload.single("document"), updateInsurance);
router.delete("/insurance/:id", deleteInsurance);
router.post("/insurance/:id/claim", submitInsuranceClaim);
router.get("/insurance/:id/utilization", getInsuranceUtilization);

router.get("/reviews", listReviews);
router.post("/reviews", requireFeatureEnabled("reviews", "Reviews"), upsertReview);

router.get("/saved-doctors", listSavedDoctors);
router.post("/saved-doctors", saveDoctor);
router.patch("/saved-doctors/:doctorId", updateSavedDoctor);
router.delete("/saved-doctors/:doctorId", removeSavedDoctor);

router.get("/profile-completion", getProfileCompletion);
router.put("/profile", updatePatientProfile);
router.get("/health-profile", getHealthProfileOverview);
router.get("/health-journey", getHealthJourney);
router.get("/timeline", getHealthTimeline);
router.get("/notifications", getPatientNotifications);
router.get("/exports", exportPatientData);

export default router;
