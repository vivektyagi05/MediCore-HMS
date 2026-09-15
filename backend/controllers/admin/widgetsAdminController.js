import OnlineSession from "../../models/OnlineSession.js";
import { onlineFilter } from "../../socket/presenceQuery.js";
import NotificationDelivery from "../../models/NotificationDelivery.js";
import RefundRequest from "../../models/RefundRequest.js";
import Insurance from "../../models/Insurance.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { userHasPermission } from "../../middleware/adminMiddleware.js";
import { buildPlatformOverviewData, buildPlatformAnalyticsData } from "./overviewAdminController.js";
import { buildExecutiveDashboardData, buildMissionControlData, buildSmartAlerts } from "./missionControlAdminController.js";
import {
  buildPlatformHealthCenter,
  buildInfrastructureStatus,
  buildOperationalHealth,
} from "./platformHealthAdminController.js";

// ─────────────────────────────────────────────────────────────────────────
// Phase A5.2 — Smart Widgets Platform.
//
// One reusable widget architecture instead of 14 bespoke components/
// endpoints. WIDGET_REGISTRY is the single source of truth for what a
// widget is (title, category, which existing permission key gates it,
// whether it supports a date range / drill-down / export). getWidgetData
// dispatches by key into a `load` function that ALWAYS reuses an existing
// builder from A5.1 or earlier in this phase — nothing below re-runs an
// aggregate another endpoint already computes. Frontend widget rendering
// is likewise one generic shell (see src/components/widgets/WidgetShell.jsx)
// configured per key from this same registry shape.
// ─────────────────────────────────────────────────────────────────────────

const REGISTRY = [
  {
    key: "revenue",
    title: "Revenue",
    category: "financial",
    permissionKey: "manage_payments",
    supportsDateRange: true,
    supportsDrillDown: true,
    supportsExport: true,
    load: async ({ days }) => {
      const [overview, analytics] = await Promise.all([buildPlatformOverviewData(), buildPlatformAnalyticsData(days)]);
      return { revenue: overview.revenue, revenuePerDay: analytics.revenuePerDay, rangeDays: analytics.rangeDays };
    },
  },
  {
    key: "appointments",
    title: "Appointments",
    category: "operations",
    permissionKey: null,
    supportsDateRange: true,
    supportsDrillDown: true,
    supportsExport: true,
    load: async ({ days }) => {
      const [overview, analytics] = await Promise.all([buildPlatformOverviewData(), buildPlatformAnalyticsData(days)]);
      return { appointments: overview.appointments, appointmentsPerDay: analytics.appointmentsPerDay, cancellationRate: analytics.cancellationRate };
    },
  },
  {
    key: "doctors",
    title: "Doctors",
    category: "operations",
    permissionKey: "manage_doctors",
    supportsDateRange: true,
    supportsDrillDown: true,
    supportsExport: true,
    load: async ({ days }) => {
      const [overview, analytics] = await Promise.all([buildPlatformOverviewData(), buildPlatformAnalyticsData(days)]);
      return { doctors: overview.doctors, doctorGrowth: analytics.doctorGrowth, topSpecialties: analytics.topSpecialties, topDoctors: analytics.topDoctors };
    },
  },
  {
    key: "patients",
    title: "Patients",
    category: "operations",
    permissionKey: null,
    supportsDateRange: true,
    supportsDrillDown: false,
    supportsExport: true,
    load: async ({ days }) => {
      const [overview, analytics, executive] = await Promise.all([
        buildPlatformOverviewData(),
        buildPlatformAnalyticsData(days),
        buildExecutiveDashboardData(),
      ]);
      return { patients: overview.patients, patientGrowth: analytics.patientGrowth, repeatPatients: executive.repeatPatients };
    },
  },
  {
    key: "insurance",
    title: "Insurance",
    category: "financial",
    permissionKey: "manage_payments",
    supportsDateRange: false,
    supportsDrillDown: true,
    supportsExport: true,
    load: async () => {
      const now = new Date();
      const expiringSoon = await Insurance.find({
        validTill: { $gte: now, $lte: new Date(now.getTime() + 14 * 86400000) },
        claimStatus: { $nin: ["approved", "rejected"] },
      })
        .select("provider validTill claimStatus policyNumber")
        .limit(50)
        .lean();
      return { expiringWithin14Days: expiringSoon.length, items: expiringSoon };
    },
  },
  {
    key: "refunds",
    title: "Refunds",
    category: "financial",
    permissionKey: "manage_payments",
    supportsDateRange: false,
    supportsDrillDown: true,
    supportsExport: true,
    load: async () => {
      const overview = await buildPlatformOverviewData();
      const stalePending = await RefundRequest.find({ status: "pending" })
        .sort({ createdAt: 1 })
        .limit(50)
        .select("amount reason status createdAt")
        .lean();
      return { refunds: overview.refunds, items: stalePending };
    },
  },
  {
    key: "notifications",
    title: "Notifications",
    category: "operations",
    permissionKey: null,
    supportsDateRange: false,
    supportsDrillDown: true,
    supportsExport: false,
    load: async () => {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const [last15Min, unreadCritical, recent] = await Promise.all([
        NotificationDelivery.countDocuments({ createdAt: { $gte: fifteenMinutesAgo } }),
        NotificationDelivery.countDocuments({ severity: "critical", readAt: null }),
        NotificationDelivery.find({}).sort({ createdAt: -1 }).limit(20).select("title severity type createdAt readAt").lean(),
      ]);
      return { last15Min, unreadCritical, items: recent };
    },
  },
  {
    key: "ai",
    title: "AI Activity",
    category: "intelligence",
    permissionKey: null,
    supportsDateRange: false,
    supportsDrillDown: false,
    supportsExport: false,
    load: async () => {
      const [executive, operational] = await Promise.all([buildExecutiveDashboardData(), buildOperationalHealth()]);
      return { aiRequestsToday: executive.aiRequestsToday, aiActivityToday: operational.aiActivityToday, discardRate: operational.aiDraftDiscardRate };
    },
  },
  {
    key: "automation",
    title: "Automation",
    category: "intelligence",
    permissionKey: "manage_settings",
    supportsDateRange: false,
    supportsDrillDown: true,
    supportsExport: false,
    load: async () => {
      const infra = await buildInfrastructureStatus();
      return { jobs: infra.scheduler.jobs, model: infra.scheduler.model };
    },
  },
  {
    key: "platformHealth",
    title: "Platform Health",
    category: "system",
    permissionKey: "manage_settings",
    supportsDateRange: false,
    supportsDrillDown: true,
    supportsExport: false,
    load: async () => buildPlatformHealthCenter(),
  },
  {
    key: "systemStatus",
    title: "System Status",
    category: "system",
    permissionKey: "manage_settings",
    supportsDateRange: false,
    supportsDrillDown: false,
    supportsExport: false,
    load: async () => buildInfrastructureStatus(),
  },
  {
    key: "criticalAlerts",
    title: "Critical Alerts",
    category: "system",
    permissionKey: null,
    supportsDateRange: false,
    supportsDrillDown: true,
    supportsExport: false,
    load: async () => buildSmartAlerts(),
  },
  {
    key: "emergency",
    title: "Emergency",
    category: "operations",
    permissionKey: null,
    supportsDateRange: false,
    supportsDrillDown: false,
    supportsExport: false,
    load: async () => {
      const executive = await buildExecutiveDashboardData();
      return { emergencyToday: executive.emergencyToday, criticalReportsPending: executive.criticalReportsPending };
    },
  },
  {
    key: "liveSessions",
    title: "Live Sessions",
    category: "system",
    permissionKey: null,
    supportsDateRange: false,
    supportsDrillDown: true,
    supportsExport: false,
    load: async () => {
      const mission = await buildMissionControlData();
      const sessions = await OnlineSession.find(onlineFilter())
        .sort({ lastActiveAt: -1 })
        .limit(50)
        .select("userId role connectedAt lastActiveAt")
        .lean();
      return { presence: mission.presence, liveConsultations: mission.liveConsultations, items: sessions };
    },
  },
];

const REGISTRY_BY_KEY = new Map(REGISTRY.map((w) => [w.key, w]));

// Public metadata only — no `load` function, no permission-key internals
// leaked further than "does this admin have it".
async function describeForUser(user) {
  const described = await Promise.all(
    REGISTRY.map(async (widget) => ({
      key: widget.key,
      title: widget.title,
      category: widget.category,
      supportsDateRange: widget.supportsDateRange,
      supportsDrillDown: widget.supportsDrillDown,
      supportsExport: widget.supportsExport,
      allowed: widget.permissionKey ? await userHasPermission(user, widget.permissionKey) : true,
    })),
  );
  return described;
}

export const getWidgetRegistry = asyncHandler(async (req, res) => {
  const widgets = await describeForUser(req.user);
  res.status(200).json({ success: true, data: { widgets }, message: "Widget registry fetched successfully" });
});

export const getWidgetData = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const widget = REGISTRY_BY_KEY.get(key);
  if (!widget) throw new AppError(`Unknown widget: ${key}`, 404);

  if (widget.permissionKey) {
    const allowed = await userHasPermission(req.user, widget.permissionKey);
    if (!allowed) throw new AppError("You do not have permission to view this widget", 403);
  }

  const data = await widget.load({ days: req.query.days });
  res.status(200).json({
    success: true,
    data,
    meta: { key: widget.key, title: widget.title, fetchedAt: new Date().toISOString() },
    message: "Widget data fetched successfully",
  });
});
