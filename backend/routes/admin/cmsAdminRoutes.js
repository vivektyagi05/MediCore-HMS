import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { archiveCMSPage, deleteCMSPage, getCMSPage, listCMSPages, previewCMSPage, publishCMSPage, saveCMSPage, updateCMSPage, uploadCMSBanner } from "../../controllers/admin/cmsAdminController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireAdmin, requirePermission } from "../../middleware/adminMiddleware.js";
import { AppError } from "../../middleware/errorMiddleware.js";
const router = Router();
const bannerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => { fs.mkdirSync("storage/cms", { recursive: true }); cb(null, "storage/cms"); },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomBytes(12).toString("hex")}${ext}`);
  },
});
const bannerUpload = multer({
  storage: bannerStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!({"image/jpeg":[".jpg",".jpeg"],"image/png":[".png"]}[file.mimetype] || []).includes(ext)) return cb(new Error("Banner must be a JPG or PNG image"));
    cb(null, true);
  },
});
const bannerUploadSafe = (req, res, next) => bannerUpload.single("image")(req, res, (error) => {
  if (!error) return next();
  if (error.code === "LIMIT_FILE_SIZE") return next(new AppError("Banner image must be 5 MB or smaller", 400));
  return next(new AppError(error.message || "Invalid banner image", 400));
});
router.use(protect, requireAdmin);
router.get("/", listCMSPages);
router.get("/:id", getCMSPage);
router.get("/:id/preview", requirePermission("manage_cms"), previewCMSPage);
router.post("/banner", requirePermission("manage_cms"), bannerUploadSafe, uploadCMSBanner);
router.post("/", requirePermission("manage_cms"), saveCMSPage);
router.put("/:id", requirePermission("manage_cms"), updateCMSPage);
router.post("/:id/publish", requirePermission("manage_cms"), publishCMSPage);
router.post("/:id/archive", requirePermission("manage_cms"), archiveCMSPage);
router.delete("/:id", requirePermission("manage_cms"), deleteCMSPage);
export default router;
