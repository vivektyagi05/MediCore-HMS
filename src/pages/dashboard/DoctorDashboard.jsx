import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appointmentApi } from "../../api/appointmentApi";
import { doctorApi } from "../../api/doctorApi";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import { commandCenterApi } from "../../api/commandCenterApi";
import { getApiErrorMessage } from "../../api/axios";
import ErrorState from "../../components/shared/ErrorState";
import CancelAppointmentDialog from "../../components/shared/CancelAppointmentDialog";
import ScheduleFollowUpDialog from "../../components/schedule/ScheduleFollowUpDialog";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import {
  DoctorHero,
  TodayGlanceStrip,
  CurrentNextConsultation,
  SchedulePreview,
  CapacityPanel,
  AttentionCenter,
  FollowUpQueue,
  ClinicalWorkCompletion,
  ReputationSnapshot,
  EarningsSnapshot,
  TrendsIntelligencePanel,
  QuickActionsPanel,
  PendingApprovalsQueue,
  formatDate,
} from "../../components/doctor/dashboard/DoctorHomeWidgets";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import { aiAssistApi } from "../../api/aiAssistApi";
import { buildNavigation } from "../../config/navigation";
import { STATUS_LABELS } from "../../utils/doctorAppointmentWorkflow";
import { getRecentlyViewedPatients } from "../../utils/doctorPatientPreferences";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function isSameDay(a, b) {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return (
    dateA.getUTCFullYear() === dateB.getUTCFullYear() &&
    dateA.getUTCMonth() === dateB.getUTCMonth() &&
    dateA.getUTCDate() === dateB.getUTCDate()
  );
}

const toDateInputValue = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Phase DOC-07 final pass — Doctor Command Center.
//
// This replaces the previous card-heavy DoctorDashboard with a real
// information hierarchy (Hero -> Today at a Glance -> Current/Next
// Consultation -> Schedule Preview -> Capacity -> Attention Center ->
// Follow-up Queue -> Clinical Work -> Reputation -> Earnings -> Quick
// Actions), matching the same "slim page + widgets file" architecture
// PatientDashboard.jsx already uses (see
// components/patient/dashboard/PatientHomeWidgets.jsx). All data-fetching
// and derivation logic below is unchanged from the previous, already-tested
// implementation — reused, not rewritten — except for one addition: a
// real getScheduleDay() call so the Capacity panel shows the actual
// buildDayCapacity numbers instead of a second, frontend-computed capacity
// calculation.
function DoctorDashboard() {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const { dashboardSyncTick, notifications } = useRealtime();

  const [appointments, setAppointments] = useState([]);
  const [pendingApprovalAppointments, setPendingApprovalAppointments] = useState([]);
  const [earnings, setEarnings] = useState(null);
  const [patients, setPatients] = useState([]);
  const [reviewIntelligence, setReviewIntelligence] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [todayCapacity, setTodayCapacity] = useState(null);
  const [todayCapacityError, setTodayCapacityError] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [commandCenter, setCommandCenter] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [search, setSearch] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const navigate = useNavigate();
  const [followUpTarget, setFollowUpTarget] = useState(null);

  const loadAll = async () => {
    setIsLoading(true);
    setError("");
    try {
      const todayIso = new Date().toISOString();
      const [apptRes, pendingRes, earningsRes, patientsRes, reviewsRes, scheduleRes, todayCapacityRes, analyticsRes, commandCenterRes] = await Promise.all([
        appointmentApi.getAppointments({ dateFrom: todayIso, limit: 100 }),
        appointmentApi.getAppointments({ status: "pending", limit: 100 }),
        doctorApi.getEarnings(),
        doctorApi.getPatients(),
        doctorApi.getReviews(),
        doctorWorkflowApi.getSchedule(),
        // Real capacity engine (buildDayCapacity via GET /doctor/schedule/day)
        // for the dashboard's Capacity panel and the Hero's Today's Timetable —
        // no frontend-computed number. The error (if any) is captured instead
        // of swallowed so the Timetable can show a real error + Retry state
        // rather than silently rendering as if there's simply no data.
        doctorWorkflowApi
          .getScheduleDay(toDateInputValue(new Date()))
          .then((res) => ({ data: res.data, error: null }))
          .catch((scheduleDayError) => ({ data: null, error: scheduleDayError })),
        doctorWorkflowApi.getAnalytics().catch(() => null),
        commandCenterApi.getCommandCenter().catch(() => null),
      ]);
      setAppointments(apptRes.data.appointments || []);
      setPendingApprovalAppointments(pendingRes.data.appointments || []);
      setEarnings(earningsRes.data);
      setPatients(patientsRes.data?.patients || []);
      setReviewIntelligence(reviewsRes.data || null);
      setSchedule(scheduleRes.data);
      setTodayCapacity(todayCapacityRes?.data || null);
      setTodayCapacityError(todayCapacityRes?.error ? getApiErrorMessage(todayCapacityRes.error) : "");
      setAnalytics(analyticsRes?.data || null);
      setCommandCenter(commandCenterRes?.data || null);
      setLastSyncedAt(new Date());
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [dashboardSyncTick]);

  const today = useMemo(() => new Date(), []);

  const todaysAppointments = useMemo(
    () =>
      appointments
        .filter((a) => isSameDay(a.date, today) && a.status !== "cancelled")
        .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot)),
    [appointments, today],
  );

  const upcomingAppointments = useMemo(
    () =>
      appointments
        .filter((a) => new Date(a.date) > today && !isSameDay(a.date, today) && a.status !== "cancelled")
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 6),
    [appointments, today],
  );

  const pendingApprovals = pendingApprovalAppointments;

  const currentConsultation = useMemo(() => appointments.find((a) => a.status === "consultation_started"), [appointments]);

  const nextConsultation = useMemo(() => {
    if (currentConsultation) return null;
    return (
      todaysAppointments.find((a) => ["pending", "approved", "payment_pending", "payment_completed"].includes(a.status)) ||
      upcomingAppointments[0]
    );
  }, [currentConsultation, todaysAppointments, upcomingAppointments]);

  const completedTodayCount = useMemo(
    () => todaysAppointments.filter((a) => ["completed", "review_eligible", "consultation_completed"].includes(a.status)).length,
    [todaysAppointments],
  );

  const emergencyTodayFallback = useMemo(() => todaysAppointments.filter((a) => (a.painLevel || 0) >= 8), [todaysAppointments]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return patients.filter((p) => p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)).slice(0, 6);
  }, [search, patients]);

  const recentlyViewedPatients = useMemo(() => getRecentlyViewedPatients(), [dashboardSyncTick]);
  const recentActivity = useMemo(() => notifications.slice(0, 6), [notifications]);

  const reviewsNeedingReply = useMemo(
    () => (reviewIntelligence?.attentionItems || []).filter((item) => item.source?.includes("doctorReply missing")).slice(0, 3),
    [reviewIntelligence],
  );

  const clinicOpenToday = useMemo(() => {
    if (!schedule) return null;
    const dayKey = DAY_NAMES[today.getUTCDay()];
    const hasSlotToday = (schedule.availability || []).some((slot) => slot.dayOfWeek === dayKey);
    const blockedToday = (schedule.blockedDates || []).some((item) => isSameDay(item.date, today));
    return hasSlotToday && !blockedToday;
  }, [schedule, today]);

  const updateStatus = async (id, status) => {
    setUpdatingId(id);
    try {
      await appointmentApi.updateAppointmentStatus(id, { status });
      toast.success(`Appointment marked ${STATUS_LABELS[status]?.toLowerCase() || status}`);
      await loadAll();
    } catch (statusError) {
      toast.error(getApiErrorMessage(statusError));
    } finally {
      setUpdatingId("");
    }
  };

  const markReportReviewed = async (reportId) => {
    try {
      await commandCenterApi.markReportReviewed(reportId);
      setCommandCenter((prev) => (prev ? { ...prev, pendingReports: prev.pendingReports.filter((r) => r.reportId !== reportId) } : prev));
      toast.success("Report marked as reviewed");
    } catch (reviewError) {
      toast.error(getApiErrorMessage(reviewError));
    }
  };

  const urgentItems = useMemo(() => {
    const items = [];
    if (commandCenter) {
      commandCenter.queue.emergency.forEach((a) => {
        items.push({ key: `emergency-${a.appointmentId}`, tone: "danger", title: a.patientName, detail: `${a.timeSlot} · Emergency`, actionLabel: "Open", to: `/doctor/clinical?patientId=${a.patientId}&tab=history` });
      });
      commandCenter.queue.delayed.filter((a) => !a.isEmergency).forEach((a) => {
        items.push({ key: `delayed-${a.appointmentId}`, tone: "warning", title: a.patientName, detail: `${a.timeSlot} · Delayed consultation`, actionLabel: "Open", to: `/doctor/clinical?patientId=${a.patientId}&tab=history` });
      });
      commandCenter.pendingReports.filter((r) => r.severity === "critical").forEach((r) => {
        items.push({ key: `report-${r.reportId}`, tone: "danger", title: r.title, detail: `${r.patientName} · Critical report waiting for review`, actionLabel: "Review Report", onAction: () => markReportReviewed(r.reportId) });
      });
      if (commandCenter.unreadCriticalNotifications > 0) {
        items.push({ key: "unread-critical", tone: "danger", title: `${commandCenter.unreadCriticalNotifications} unread critical alert${commandCenter.unreadCriticalNotifications === 1 ? "" : "s"}`, detail: "Requires immediate review", actionLabel: "Open Inbox", to: "/doctor/inbox" });
      }
    } else {
      emergencyTodayFallback.forEach((a) => {
        items.push({ key: `emergency-fallback-${a._id}`, tone: "danger", title: a.patientId?.name || "Patient", detail: `Pain level ${a.painLevel}/10 · ${a.timeSlot}`, actionLabel: "Open", to: `/doctor/clinical?patientId=${a.patientId?._id}&tab=history` });
      });
    }
    return items;
  }, [commandCenter, emergencyTodayFallback]);

  const needsActionItems = useMemo(() => {
    const items = [];
    if (pendingApprovals.length > 0) {
      items.push({ key: "pending-approvals", tone: "warning", title: `${pendingApprovals.length} appointment${pendingApprovals.length === 1 ? "" : "s"} awaiting your approval`, detail: "New booking requests need a decision", actionLabel: "Review", to: "#pending-approvals" });
    }
    if (analytics?.pendingPrescriptions > 0) {
      items.push({ key: "pending-prescriptions", tone: "warning", title: `${analytics.pendingPrescriptions} consultation${analytics.pendingPrescriptions === 1 ? "" : "s"} missing a prescription`, detail: "Completed consultations with no prescription on file", actionLabel: "Open Clinical Workspace", to: "/doctor/clinical" });
    }
    if (commandCenter) {
      commandCenter.followUpsDue.filter((f) => f.bucket === "overdue").slice(0, 3).forEach((f) => {
        items.push({ key: `followup-${f.prescriptionId}`, tone: "warning", title: `${f.patientName} · Follow-up overdue`, detail: `Due ${formatDate(f.followUpDate)}${f.diagnosis ? ` · ${f.diagnosis}` : ""}`, actionLabel: "Open Patient", to: `/doctor/clinical?patientId=${f.patientId}&tab=history` });
      });
      // PHASE P10 — a follow-up that was scheduled and then had its
      // appointment cancelled is the one case where the continuity loop can
      // silently break if nobody is told; surface it with the same urgency
      // as an overdue unscheduled one rather than letting it sit invisible.
      commandCenter.followUpsDue.filter((f) => f.bucket === "cancelled_needs_action").slice(0, 3).forEach((f) => {
        items.push({ key: `followup-cancelled-${f.prescriptionId}`, tone: "warning", title: `${f.patientName} · Follow-up appointment cancelled`, detail: `The scheduled follow-up was cancelled${f.diagnosis ? ` · ${f.diagnosis}` : ""} — reschedule or review`, actionLabel: "Open Patient", to: `/doctor/clinical?patientId=${f.patientId}&tab=history` });
      });
      commandCenter.pendingInsuranceExpiring.slice(0, 2).forEach((i, index) => {
        items.push({ key: `insurance-${index}`, tone: "info", title: `${i.patientName} · Insurance expiring`, detail: `${i.provider} · Expires ${formatDate(i.validTill)}`, actionLabel: i.patientId ? "Open Patient" : null, to: i.patientId ? `/doctor/clinical?patientId=${i.patientId}&tab=history` : undefined });
      });
      // PHASE P9 fix: critical reports already surface in urgentItems above.
      // Urgent/normal-severity unreviewed reports previously had NO real
      // representation anywhere the doctor would actually see them — the
      // Dashboard only ever showed their raw *count*, and that count's link
      // went to Smart Inbox, which only shows items with a persisted
      // notification (never created for normal severity). Reusing the same
      // shared, priority-sorted commandCenter.pendingReports the count was
      // already built from — same source of truth, no new calculation —
      // capped to keep the feed scannable; the full list lives on the
      // Documents page (reportsAttention below reuses this identical data).
      const nonCriticalReports = commandCenter.pendingReports.filter((r) => r.priority !== "critical");
      nonCriticalReports.slice(0, 5).forEach((r) => {
        items.push({ key: `report-${r.reportId}`, tone: r.priority === "warning" ? "warning" : "info", title: r.title, detail: `${r.patientName} · ${r.severity} report waiting for review`, actionLabel: "Review Report", onAction: () => markReportReviewed(r.reportId) });
      });
      if (nonCriticalReports.length > 5) {
        items.push({ key: "reports-more", tone: "info", title: `${nonCriticalReports.length - 5} more report${nonCriticalReports.length - 5 === 1 ? "" : "s"} awaiting review`, detail: "See the full list on your Documents page", actionLabel: "View All", to: "/doctor/documents" });
      }
    }
    reviewsNeedingReply.forEach((item) => {
      items.push({ key: `review-${item.reviewId}`, tone: item.severity === "critical" ? "danger" : "warning", title: `${item.patientName} left an unanswered review`, detail: item.reason, actionLabel: "Reply", to: `/doctor/reviews?reviewId=${item.reviewId}` });
    });
    return items;
  }, [pendingApprovals, analytics, commandCenter, reviewsNeedingReply]);

  const informationItems = useMemo(() => {
    const items = [];
    if (commandCenter) {
      items.push({ key: "clinic-summary", tone: "info", title: `${commandCenter.practiceHealth.todaysCompletionPercent}% of today's clinic completed`, detail: `₹${commandCenter.practiceHealth.todaysRevenue} collected today`, actionLabel: "View Earnings", to: "/doctor/earnings" });
    }
    if (recentActivity.length) {
      items.push({ key: "recent-activity", tone: "info", title: recentActivity[0].message || recentActivity[0].title || "New activity", detail: `${recentActivity.length} recent update${recentActivity.length === 1 ? "" : "s"}`, actionLabel: "Open Inbox", to: "/doctor/inbox" });
    }
    return items;
  }, [commandCenter, recentActivity]);

  const quickActionItems = useMemo(() => {
    const doctorItems = buildNavigation(t).filter((item) => item.roles.includes("doctor") && item.path !== "/doctor/dashboard" && item.path !== "/doctor/onboarding");
    // Brief calls for a small set of high-value actions on the dashboard
    // itself (not the full nav) — Today's Schedule, Patients, Smart Inbox,
    // Clinical Workspace, Reviews, Documents, Earnings. Filtered from the
    // single navigation source of truth, not a second hardcoded route list.
    const priorityPaths = ["/doctor/schedule", "/doctor/patients", "/doctor/inbox", "/doctor/clinical", "/doctor/reviews", "/doctor/documents", "/doctor/earnings"];
    const byPath = new Map(doctorItems.map((item) => [item.path, item]));
    return priorityPaths.map((p) => byPath.get(p)).filter(Boolean);
  }, [t]);

  if (isLoading) return <Loader label={t("common.loading")} />;

  return (
    <div className="space-y-6">
      <DoctorHero
        firstName={user?.name?.split(" ")[0]}
        clinicOpenToday={clinicOpenToday}
        todayCount={todaysAppointments.length}
        completedCount={completedTodayCount}
        lastSyncedAt={lastSyncedAt}
        onRefresh={loadAll}
        todayCapacity={todayCapacity}
        todayCapacityError={todayCapacityError}
        onRetryTodayCapacity={loadAll}
        currentConsultationId={currentConsultation?._id}
        nextConsultationId={nextConsultation?._id}
        primaryAction={
          currentConsultation ? (
            <Button to={`/doctor/clinical?patientId=${currentConsultation.patientId?._id}&tab=history`}>Open Current Consultation</Button>
          ) : (
            <Button to="/doctor/schedule">View Today's Schedule</Button>
          )
        }
      />

      {error && <ErrorState title="Couldn't load your dashboard" description={error} onRetry={loadAll} />}

      <Card className="!p-4">
        <div className="flex items-center gap-3">
          <Search size={18} className="text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Smart search: find a patient by name or email…"
            className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            {searchResults.map((p) => (
              <Button key={p._id} variant="secondary" to={`/doctor/clinical?patientId=${p._id}&tab=history`} className="!w-full !justify-start">
                {p.name} <span className="ml-2 text-xs text-slate-400">{p.email}</span>
              </Button>
            ))}
          </div>
        )}
      </Card>

      <TodayGlanceStrip
        todayCount={todaysAppointments.length}
        completedCount={completedTodayCount}
        remainingCount={Math.max(todaysAppointments.length - completedTodayCount, 0)}
        availableSlots={todayCapacity?.capacity?.available}
        pendingApprovalsCount={pendingApprovals.length}
        onOpenApprovals={(e) => {
          e.preventDefault();
          document.getElementById("pending-approvals")?.scrollIntoView({ behavior: "smooth" });
        }}
      />

      <CurrentNextConsultation
        current={currentConsultation}
        next={nextConsultation}
        updatingId={updatingId}
        onEndConsultation={(id) => updateStatus(id, "consultation_completed")}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <SchedulePreview appointments={todaysAppointments} currentId={currentConsultation?._id} />
        <CapacityPanel capacity={todayCapacity} />
      </div>

      <AIDraftPanel title="AI Morning Brief: What needs my attention?" actionLabel="Get suggestions" onGenerate={() => aiAssistApi.getWorkflowSuggestions()} compact />

      <AttentionCenter urgentItems={urgentItems} needsActionItems={needsActionItems} informationItems={informationItems} />

      <div id="followup-queue" className="grid gap-6 xl:grid-cols-2">
        <FollowUpQueue
          followUpsDue={commandCenter?.followUpsDue || []}
          onSchedule={setFollowUpTarget}
          onOpenAppointment={(f) => navigate(`/doctor/appointments?patientId=${f.patientId}&highlight=${f.appointmentId}`)}
          truncated={commandCenter?.followUpQueueTruncated || false}
        />
        <ClinicalWorkCompletion
          incompleteConsultations={analytics?.incompleteConsultations ?? 0}
          pendingPrescriptions={analytics?.pendingPrescriptions ?? 0}
          pendingReportsCount={commandCenter?.pendingReports?.length ?? 0}
          overdueFollowUpsCount={(commandCenter?.followUpsDue || []).filter((f) => f.bucket === "overdue" || f.bucket === "cancelled_needs_action").length}
        />
      </div>

      <PendingApprovalsQueue
        appointments={pendingApprovals}
        updatingId={updatingId}
        onApprove={(a) => updateStatus(a._id, "approved")}
        onReject={(a) => setCancelTarget(a)}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <ReputationSnapshot reviewIntelligence={reviewIntelligence} />
        <EarningsSnapshot earnings={earnings} />
      </div>

      <TrendsIntelligencePanel analytics={analytics} reviewIntelligence={reviewIntelligence} />

      {recentlyViewedPatients.length > 0 && (
        <Card title="Recently Viewed Patients">
          <div className="flex flex-wrap gap-2">
            {recentlyViewedPatients.map((p) => (
              <Button key={p._id} variant="secondary" to={`/doctor/clinical?patientId=${p._id}&tab=history`}>
                {p.name}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <QuickActionsPanel items={quickActionItems} />

      <CancelAppointmentDialog
        appointment={cancelTarget}
        mode="reject"
        onClose={() => setCancelTarget(null)}
        onConfirm={async (reason) => {
          const res = await appointmentApi.cancelAppointment(cancelTarget._id, reason);
          setCancelTarget(null);
          await loadAll();
          return res;
        }}
      />

      <ScheduleFollowUpDialog
        target={followUpTarget}
        onClose={() => setFollowUpTarget(null)}
        onScheduled={async () => {
          setFollowUpTarget(null);
          await loadAll();
        }}
      />
    </div>
  );
}

export default DoctorDashboard;
