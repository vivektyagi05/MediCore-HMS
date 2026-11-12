import { asyncHandler } from "../middleware/asyncHandler.js";
import Doctor from "../models/Doctor.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { writeAdminLog } from "../utils/adminAudit.js";
import { createDoctorRefundReview, listDoctorRefundReviews, listAdminRefundReviews, resolveRefundReview } from "../services/finance/refundReviewService.js";

// The doctor is ALWAYS resolved from the authenticated user, never from a client-supplied id.
const doctorOf = async (req) => {
  const doctor = await Doctor.findOne({ userId: req.user._id }).select("_id userId").lean();
  if (!doctor) throw new AppError("Doctor profile not found", 404);
  return doctor;
};

export const createMyRefundReview = asyncHandler(async (req, res) => {
  const out = await createDoctorRefundReview({ doctor: await doctorOf(req), paymentId: req.body?.paymentId, reason: req.body?.reason });
  res.status(201).json({ success: true, data: out, message: "Review requested. An administrator will look at it." });
});
export const listMyRefundReviews = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await listDoctorRefundReviews({ doctor: await doctorOf(req), page: req.query.page, limit: req.query.limit }) });
});
export const listRefundReviewsAdmin = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await listAdminRefundReviews({ status: req.query.status, page: req.query.page, limit: req.query.limit }) });
});
export const resolveRefundReviewAdmin = asyncHandler(async (req, res) => {
  const out = await resolveRefundReview({ actor: req.user, id: req.params.id, action: req.body?.action, note: req.body?.note, audit: (entry) => writeAdminLog({ req, ...entry }) });
  res.status(200).json({ success: true, data: out, message: "Review updated" });
});
