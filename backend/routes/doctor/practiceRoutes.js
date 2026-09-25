import { localCategoryDir } from "../../storage/storageService.js";
import { Router } from "express";
import path from "path";
import multer from "multer";
import { randomBytes } from "crypto";
import { ROLES } from "../../constants/roles.js";
import { protect } from "../../middleware/authMiddleware.js";
import { authorizeRoles } from "../../middleware/roleMiddleware.js";
import { requireApprovedDoctor } from "../../middleware/doctorAccessMiddleware.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import {
  getPracticeOverview,
  getProfileIntelligence,
  getProfessionalProfile,
  updateProfessionalProfile,
  getVerificationCenter,
  getSubscriptionIntelligence,
  changeSubscriptionPlan,
  updatePracticeSettings,
  getPracticeAnalytics,
  uploadProfilePhoto,
  deleteProfilePhoto,
} from "../../controllers/doctor/practiceController.js";


const profilePhotoStorage = multer.diskStorage({
  // DOCKER-PATH FIX: see storage/storageService.js.
  destination: (_req, _file, cb) => cb(null, localCategoryDir("doctor-profile")),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomBytes(12).toString("hex")}${ext}`);
  },
});
const profilePhotoUpload = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
    };
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed[file.mimetype]?.includes(ext)) return cb(new Error("Profile photo must be a JPG or PNG image"));
    cb(null, true);
  },
});
const profilePhotoUploadSafe = (req, res, next) => {
  profilePhotoUpload.single("photo")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") return next(new AppError("Profile photo must be 5 MB or smaller", 400));
    return next(new AppError(error.message || "Invalid profile photo upload", 400));
  });
};

const router = Router();

router.use(protect, authorizeRoles(ROLES.DOCTOR));

// Practice Management Platform hub (Steps 1-6)
router.get("/practice/overview", getPracticeOverview);

// Step 2: Profile Intelligence (Professional Identity Center)
router.get("/practice/profile-intelligence", getProfileIntelligence);

// Step 3: Professional Profile
router.get("/practice/professional-profile", getProfessionalProfile);
router.patch("/practice/professional-profile", updateProfessionalProfile);
router.post("/practice/profile-photo", profilePhotoUploadSafe, uploadProfilePhoto);
router.delete("/practice/profile-photo", deleteProfilePhoto);

// Step 4: Verification Center
router.get("/practice/verification", getVerificationCenter);

// Step 5: Subscription Intelligence + Practice Settings
router.get("/practice/subscription", getSubscriptionIntelligence);
router.patch("/practice/subscription/:id/change-plan", changeSubscriptionPlan);
router.patch("/practice/settings", updatePracticeSettings);

// Step 6: Practice Analytics
// Analytics are approved-only (a pending doctor has no practice data to analyse).
router.get("/practice/analytics", requireApprovedDoctor, getPracticeAnalytics);

export default router;
