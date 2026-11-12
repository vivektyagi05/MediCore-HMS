// Phase 03 completion: doctor refund-REVIEW requests (no refund execution, no money movement, no patient data).
import mongoose from "mongoose";
import Payment from "../../models/Payment.js";
import DoctorPayout from "../../models/DoctorPayout.js";
import RefundReview, { ACTIVE_REVIEW_STATUSES, REFUND_REVIEW_STATUS as S } from "../../models/RefundReview.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { clampPage } from "./walletReconciliationService.js";

export const REVIEW_ACTIONS = Object.freeze({ acknowledge: S.ACKNOWLEDGED, resolve: S.RESOLVED, dismiss: S.DISMISSED });
const FROM = { [S.ACKNOWLEDGED]: [S.OPEN], [S.RESOLVED]: [S.OPEN, S.ACKNOWLEDGED], [S.DISMISSED]: [S.OPEN, S.ACKNOWLEDGED] };

/** Safe projection: never includes patient identity, payment credentials or gateway references. */
export const toReviewView = (r) => ({
  _id: String(r._id), paymentId: String(r.paymentId), payoutId: r.payoutId ? String(r.payoutId) : null, status: r.status, reason: r.reason,
  snapshot: r.snapshot || null, adminNote: r.adminNote || null, createdAt: r.createdAt, resolvedAt: r.resolvedAt || null,
  timeline: (r.timeline || []).map((t) => ({ status: t.status, note: t.note, at: t.at })),
});

const validId = (id, name) => { if (!mongoose.Types.ObjectId.isValid(String(id || ""))) throw new AppError(`Invalid ${name}`, 400); };

export const createDoctorRefundReview = async ({ doctor, paymentId, reason }) => {
  validId(paymentId, "payment id");
  const text = String(reason || "").trim();
  if (text.length < 10 || text.length > 500) throw new AppError("Please explain your concern in 10-500 characters", 400, { code: "REASON_REQUIRED" });
  const payment = await Payment.findById(paymentId).select("doctorId refundedAmount").lean();
  // Ownership: a payment that is not this doctor's is indistinguishable from one that does not exist (no IDOR oracle).
  if (!payment || String(payment.doctorId) !== String(doctor._id)) throw new AppError("Payment not found", 404);
  const payout = await DoctorPayout.findOne({ paymentId }).select("refundAdjustmentAmount status").lean();
  if (!(Number(payment.refundedAmount) > 0) && !(Number(payout?.refundAdjustmentAmount) > 0)) {
    throw new AppError("Only consultations that have been refunded can be queried", 409, { code: "REVIEW_NOT_APPLICABLE" });
  }
  const snapshot = { refundedAmount: payment.refundedAmount || 0, doctorAdjustment: payout?.refundAdjustmentAmount || 0, payoutStatus: payout?.status || null };
  try {
    const created = await RefundReview.create({
      doctorId: doctor._id, doctorUserId: doctor.userId, paymentId, payoutId: payout?._id, reason: text, snapshot,
      timeline: [{ status: S.OPEN, note: "Review requested by the doctor", actorId: doctor.userId }],
    });
    return { review: toReviewView(created), created: true };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await RefundReview.findOne({ doctorId: doctor._id, paymentId, status: { $in: ACTIVE_REVIEW_STATUSES } }).lean();
    throw new AppError("A review request is already open for this consultation", 409, { code: "REVIEW_ALREADY_OPEN", existingId: existing ? String(existing._id) : null });
  }
};

export const listDoctorRefundReviews = async ({ doctor, page, limit }) => {
  const p = clampPage({ page, limit });
  const filter = { doctorId: doctor._id };
  const [total, rows] = await Promise.all([RefundReview.countDocuments(filter), RefundReview.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean()]);
  return { reviews: rows.map(toReviewView), pagination: { page: p.page, limit: p.limit, total, pages: Math.max(Math.ceil(total / p.limit), 1) } };
};

export const listAdminRefundReviews = async ({ status, page, limit }) => {
  if (status && !Object.values(S).includes(status)) throw new AppError("Unknown status filter", 400);
  const p = clampPage({ page, limit });
  const filter = status ? { status } : {};
  const [total, rows] = await Promise.all([RefundReview.countDocuments(filter), RefundReview.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean()]);
  return { reviews: rows.map((r) => ({ ...toReviewView(r), doctorId: String(r.doctorId) })), pagination: { page: p.page, limit: p.limit, total, pages: Math.max(Math.ceil(total / p.limit), 1) } };
};

export const resolveRefundReview = async ({ actor, id, action, note, audit }) => {
  validId(id, "review id");
  const to = REVIEW_ACTIONS[action];
  if (!to) throw new AppError("Unsupported action", 400, { code: "ACTION_INVALID" });
  const text = String(note || "").trim();
  if (text.length < 5 || text.length > 500) throw new AppError("A note of 5-500 characters is required", 400, { code: "NOTE_REQUIRED" });
  const updated = await RefundReview.findOneAndUpdate(
    { _id: id, status: { $in: FROM[to] } },
    { $set: { status: to, adminNote: text, resolvedBy: actor._id, ...(to === S.ACKNOWLEDGED ? {} : { resolvedAt: new Date() }) }, $push: { timeline: { status: to, note: text, actorId: actor._id, at: new Date() } } },
    { returnDocument: "after" },
  ).lean();
  if (!updated) {
    const exists = await RefundReview.findById(id).select("status").lean();
    if (!exists) throw new AppError("Review request not found", 404);
    throw new AppError(`This request is already ${exists.status}`, 409, { code: "REVIEW_STATE_CONFLICT" });
  }
  if (audit) await audit({ action: `finance.refund_review_${to}`, resourceType: "RefundReview", resourceId: String(id), severity: "info", metadata: { paymentId: String(updated.paymentId), note: text } });
  return { review: toReviewView(updated) };
};
