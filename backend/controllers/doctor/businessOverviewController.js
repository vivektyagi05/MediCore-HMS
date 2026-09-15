import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { ensureDoctorProfileForUser } from "../../services/doctorProfileService.js";
import { buildDoctorAnalyticsIntelligence } from "./workflowController.js";
import { buildDoctorRevenueIntelligence } from "./doctorEarningsController.js";
import { buildDoctorReviewIntelligence } from "./doctorReviewController.js";
import { buildDoctorReputationIntelligence } from "../publicController.js";

// Doctor Business Intelligence Platform — Business Health Overview (Phase D3).
// Composes the four already-built domain intelligence builders in parallel.
// Every number here is read from those same builders — nothing here is a
// separate, potentially-divergent calculation.
export const getDoctorBusinessOverview = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user._id);
  if (!doctor) throw new AppError("Doctor profile not found", 404);

  const [analytics, revenue, reviews, reputation] = await Promise.all([
    buildDoctorAnalyticsIntelligence(doctor),
    buildDoctorRevenueIntelligence(doctor._id),
    buildDoctorReviewIntelligence(doctor._id),
    buildDoctorReputationIntelligence(doctor._id),
  ]);

  // Business Score: one transparent weighted composite drawing on all four
  // domains (revenue growth, reputation, retention, operational reliability).
  // Documented weights, all backed by real computed figures above — never
  // fabricated. Bounded to 0-100 in case of unusual growth outliers.
  const revenueHealth = Math.max(0, Math.min(100, 50 + (analytics.growthForecast || 0)));
  const businessScore = Number(
    Math.max(
      0,
      Math.min(
        100,
        (reputation.intelligence.businessReputationScore || 0) * 0.35 +
          revenueHealth * 0.25 +
          (reputation.intelligence.repeatPatientRate || 0) * 0.2 +
          (analytics.approvalRate * 100 || 0) * 0.2,
      ),
    ).toFixed(1),
  );

  res.status(200).json({
    success: true,
    data: {
      businessScore,
      revenue: {
        total: revenue.totalEarnings,
        monthly: revenue.monthlyEarnings,
        pending: revenue.pendingEarnings,
        upcomingPayout: revenue.upcomingPayout,
        forecast: analytics.revenueForecast,
      },
      rating: {
        average: reputation.overview.rating,
        totalReviews: reputation.overview.totalReviews,
        satisfactionRate: reputation.overview.satisfactionRate,
        businessReputationScore: reputation.intelligence.businessReputationScore,
      },
      growth: {
        monthlyGrowth: analytics.monthlyGrowth,
        growthForecast: analytics.growthForecast,
        newPatientsThisMonth: analytics.patientFunnel.newPatients,
      },
      retention: {
        repeatPatients: reputation.overview.repeatPatients,
        repeatPatientRate: reputation.intelligence.repeatPatientRate,
        returningPatientsThisMonth: analytics.patientFunnel.returningPatients,
      },
      appointments: {
        completed: analytics.completed,
        cancelled: analytics.appointmentFunnel.cancelled,
        conversionRate: Number((analytics.approvalRate * 100).toFixed(1)),
        pendingApprovals: analytics.pendingApprovals,
      },
      refundRate: revenue.totalEarnings
        ? Number(((revenue.totalRefunded / (revenue.totalEarnings + revenue.totalRefunded || 1)) * 100).toFixed(1))
        : 0,
      reviewsNeedingAttention: {
        negativeCount: reviews.negativeCount,
        unrepliedCount: reviews.unrepliedCount,
      },
    },
    message: "Business overview fetched successfully",
  });
});
