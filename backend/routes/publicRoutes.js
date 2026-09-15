import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import { ROLES } from "../constants/roles.js";
import {
  getHomeStats,
  getFeaturedDoctors,
  getSearchMeta,
  searchDoctors,
  getDoctorPublicProfile,
  getDoctorPublicReviews,
  getPublicTestimonials,
  getDoctorProfileStrength,
  getDoctorReputation,
  getSpecialtyBrowse,
  getPublicServices,
  getPublicServiceCategories,
  getPublicServiceBySlug,
  getPublicArticles,
  getPublicArticleCategories,
  getPublicArticleBySlug,
  getHospitalInfo,
  getHomeSeo,
  compareDoctors,
  getSimilarDoctors,
  getDoctorCoverage,
  getPublicNextAvailability,
  getPublicDoctorAvailability,
} from "../controllers/publicController.js";

const router = Router();


// Fully public — no auth required
router.get("/seo/home", getHomeSeo);
router.get("/stats", getHomeStats);
router.get("/featured-doctors", getFeaturedDoctors);
router.get("/search-meta", getSearchMeta);
router.get("/doctor-coverage", getDoctorCoverage);
router.get("/next-availability", getPublicNextAvailability);
router.get("/doctor-availability", getPublicDoctorAvailability);
router.get("/specialties", getSpecialtyBrowse);
router.get("/doctors", searchDoctors);
router.get("/doctors/compare", compareDoctors); // must precede /doctors/:id
router.get("/doctors/:id", getDoctorPublicProfile);
router.get("/doctors/:id/reviews", getDoctorPublicReviews);
router.get("/doctors/:id/similar", getSimilarDoctors);
router.get("/testimonials", getPublicTestimonials);
router.get("/services/categories", getPublicServiceCategories);
router.get("/services", getPublicServices);
router.get("/services/:slug", getPublicServiceBySlug);
router.get("/articles/categories", getPublicArticleCategories);
router.get("/articles/:slug", getPublicArticleBySlug);
router.get("/articles", getPublicArticles);
router.get("/hospital-info", getHospitalInfo);

// Doctor-authenticated routes (doctor portal)
router.get(
  "/doctor/profile-strength",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getDoctorProfileStrength,
);
router.get(
  "/doctor/reputation",
  protect,
  authorizeRoles(ROLES.DOCTOR),
  getDoctorReputation,
);

export default router;
