import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Bell, CreditCard, Stethoscope } from "lucide-react";

import { appointmentApi } from "../../api/appointmentApi";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import { invoiceApi } from "../../api/invoiceApi";
import { paymentApi } from "../../api/paymentApi";
import { walletApi } from "../../api/walletApi";
import { refundApi } from "../../api/refundApi";
import { getApiErrorMessage } from "../../api/axios";
import { getRecentlyViewed } from "../../utils/recentlyViewed";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import { aiAssistApi } from "../../api/aiAssistApi";

import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import { useRealtime } from "../../context/RealtimeContext";
import { useI18n } from "../../i18n/I18nContext";

import {
  StatTile,
  QuickActionsPanel,
  UpcomingAppointmentCard,
  HealthTimelineWidget,
  FamilyHealthWidget,
  HealthInsightsWidget,
  PaymentsSnapshotWidget,
  RecordsSnapshotWidget,
  InsuranceSnapshotWidget,
  NotificationCenterWidget,
  ProfileCompletionWidget,
  DiscoveryWidget,
  HealthAlertsStrip,
} from "../../components/patient/dashboard/PatientHomeWidgets";

// Appointment lifecycle — mirrors backend constants/appointmentStatus.js.
// Kept local because the frontend and backend are separate bundles; the
// values themselves must stay in lockstep with the backend enum.
const UPCOMING_STATUSES = [
  "pending",
  "approved",
  "payment_pending",
  "payment_completed",
  "consultation_started",
  "consultation_completed",
];
const DONE_STATUSES = ["completed", "review_eligible"];
const PAYABLE_STATUSES = ["approved", "payment_pending"];
function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}


function computeInsights(appointments, reports) {
  const currentYear = new Date().getFullYear();
  const today = startOfToday();

  const appointmentsThisYear = appointments.filter(
    (item) => new Date(item.date).getFullYear() === currentYear,
  ).length;

  const completedConsultations = appointments.filter((item) =>
    DONE_STATUSES.includes(item.status),
  ).length;

  const upcomingVisits = appointments.filter(
    (item) => new Date(item.date) >= today && item.status !== "cancelled",
  ).length;

  const specialtyCounts = {};
  const doctorCounts = {};
  appointments.forEach((item) => {
    const specialty = item.doctorId?.specialization;
    const doctorName = item.doctorId?.userId?.name;
    if (specialty) specialtyCounts[specialty] = (specialtyCounts[specialty] || 0) + 1;
    if (doctorName) doctorCounts[doctorName] = (doctorCounts[doctorName] || 0) + 1;
  });
  const mostVisitedSpecialty = Object.entries(specialtyCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const mostConsultedDoctor = Object.entries(doctorCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  let avgFrequencyLabel = null;
  if (completedConsultations > 0 && appointments.length > 0) {
    const earliest = appointments.reduce(
      (min, item) => (new Date(item.date) < min ? new Date(item.date) : min),
      new Date(appointments[0].date),
    );
    const monthsSpan = Math.max(
      1,
      (today.getFullYear() - earliest.getFullYear()) * 12 + (today.getMonth() - earliest.getMonth()) + 1,
    );
    const frequency = completedConsultations / monthsSpan;
    avgFrequencyLabel = `${frequency < 1 ? frequency.toFixed(1) : Math.round(frequency)} consultation${frequency >= 1.5 ? "s" : ""} / month`;
  }

  return {
    appointmentsThisYear,
    completedConsultations,
    upcomingVisits,
    mostVisitedSpecialty,
    mostConsultedDoctor,
    avgFrequencyLabel,
    reportsUploaded: reports.length,
  };
}

function PatientDashboard() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { notifications, unreadCount, markNotificationRead, loadNotifications, dashboardSyncTick } = useRealtime();

  const [appointments, setAppointments] = useState([]);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [insurancePolicies, setInsurancePolicies] = useState([]);
  const [reports, setReports] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [profileCompletion, setProfileCompletion] = useState({ percentage: 0, missing: [] });
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [refundRequests, setRefundRequests] = useState([]);
  const [savedDoctors, setSavedDoctors] = useState([]);

  const [referenceNow] = useState(() => Date.now());
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = async () => {
    setIsLoading(true);
    setError("");

    try {
      const [
        appointmentsRes,
        familyRes,
        insuranceRes,
        reportsRes,
        prescriptionsRes,
        timelineRes,
        profileRes,
        invoicesRes,
        paymentsRes,
        walletRes,
        refundsRes,
        savedDoctorsRes,
      ] = await Promise.all([
        appointmentApi.getAppointments({ limit: 100 }),
        patientWorkflowApi.getFamily().catch(() => ({ data: { familyMembers: [] } })),
        patientWorkflowApi.getInsurance().catch(() => ({ data: { policies: [] } })),
        patientWorkflowApi.getReports().catch(() => ({ data: { reports: [] } })),
        patientWorkflowApi.getPrescriptions().catch(() => ({ data: { prescriptions: [] } })),
        patientWorkflowApi.getTimeline().catch(() => ({ data: { timeline: [] } })),
        patientWorkflowApi.getProfileCompletion().catch(() => ({ data: { percentage: 0, missing: [] } })),
        invoiceApi.getInvoices().catch(() => ({ data: { invoices: [] } })),
        paymentApi.getPayments().catch(() => ({ data: { payments: [] } })),
        walletApi.getWallet().catch(() => ({ data: { wallet: null } })),
        refundApi.getRequests().catch(() => ({ data: { refundRequests: [] } })),
        patientWorkflowApi.getSavedDoctors().catch(() => ({ data: { savedDoctors: [] } })),
      ]);

      setAppointments(appointmentsRes.data?.appointments || []);
      setFamilyMembers(familyRes.data?.familyMembers || []);
      setInsurancePolicies(insuranceRes.data?.policies || []);
      setReports(reportsRes.data?.reports || []);
      setPrescriptions(prescriptionsRes.data?.prescriptions || []);
      setTimeline(timelineRes.data?.timeline || []);
      setProfileCompletion(profileRes.data || { percentage: 0, missing: [] });
      setInvoices(invoicesRes.data?.invoices || []);
      setPayments(paymentsRes.data?.payments || []);
      setWallet(walletRes.data?.wallet || null);
      setRefundRequests(refundsRes.data?.refundRequests || refundsRes.data?.requests || []);
      setSavedDoctors(savedDoctorsRes.data?.savedDoctors || []);
      await loadNotifications();
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [dashboardSyncTick]);

  const upcomingAppointment = useMemo(() => {
    return [...appointments]
      .filter((item) => UPCOMING_STATUSES.includes(item.status))
      .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  }, [appointments]);

  const payablePayments = useMemo(
    () =>
      appointments.filter(
        (item) => PAYABLE_STATUSES.includes(item.status) && item.paymentStatus !== "paid",
      ),
    [appointments],
  );

  const pendingApprovalCount = useMemo(
    () => appointments.filter((item) => item.status === "pending").length,
    [appointments],
  );

  const nextFollowUp = useMemo(() => {
    const today = startOfToday();
    return [...prescriptions]
      .filter((item) => item.followUpDate && new Date(item.followUpDate) >= today)
      .sort((a, b) => new Date(a.followUpDate) - new Date(b.followUpDate))[0];
  }, [prescriptions]);

  const insights = useMemo(() => computeInsights(appointments, reports), [appointments, reports]);

  const categoryBreakdown = useMemo(() => {
    const counts = {};
    reports.forEach((report) => {
      counts[report.category] = (counts[report.category] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [reports]);

  const recentPayments = useMemo(
    () => [...payments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [payments],
  );

  const recentlyViewed = useMemo(() => getRecentlyViewed(), []);

  const alerts = useMemo(() => {
    const list = [];
    if (payablePayments.length > 0) {
      list.push({
        message: `You have ${payablePayments.length} appointment${payablePayments.length > 1 ? "s" : ""} awaiting payment.`,
        to: "/patient/payments",
        actionLabel: "Pay now",
      });
    }
    if (pendingApprovalCount > 0) {
      list.push({
        message: `${pendingApprovalCount} appointment request${pendingApprovalCount > 1 ? "s" : ""} awaiting doctor approval.`,
        to: "/patient/appointments",
        actionLabel: "View",
      });
    }
    const expiringSoon = insurancePolicies.filter((policy) => {
      const daysLeft = (new Date(policy.validTill) - referenceNow) / (1000 * 60 * 60 * 24);
      return daysLeft >= 0 && daysLeft <= 30;
    });
    if (expiringSoon.length > 0) {
      list.push({
        message: `${expiringSoon.length} insurance polic${expiringSoon.length > 1 ? "ies" : "y"} expiring within 30 days.`,
        to: "/patient/insurance",
        actionLabel: "Review",
      });
    }
    return list;
  }, [payablePayments, pendingApprovalCount, insurancePolicies, referenceNow]);


  if (isLoading) return <Loader label="Loading your health workspace" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">
            {t("dashboard.patient.heading")}
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
            {t("dashboard.patient.subtext")}
          </h1>
          <p className="mt-2 text-sm text-slate-600">{t("dashboard.patient.tagline")}</p>
        </div>
        <Button onClick={loadDashboard}>{t("dashboard.patient.refresh")}</Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <HealthAlertsStrip alerts={alerts} />

      <div className="grid gap-6 md:grid-cols-4">
        <StatTile
          icon={CalendarDays}
          label="Upcoming Appointment"
          value={upcomingAppointment ? new Date(upcomingAppointment.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "None"}
          to="/patient/appointments"
          tone="blue"
        />
        <StatTile
          icon={CreditCard}
          label="Pending Payments"
          value={payablePayments.length}
          to="/patient/payments"
          tone={payablePayments.length ? "amber" : "emerald"}
        />
        <StatTile
          icon={Stethoscope}
          label="Pending Doctor Approval"
          value={pendingApprovalCount}
          to="/patient/appointments"
          tone={pendingApprovalCount ? "amber" : "emerald"}
        />
        <StatTile
          icon={Bell}
          label="Unread Notifications"
          value={unreadCount}
          tone={unreadCount ? "amber" : "slate"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <UpcomingAppointmentCard
            appointment={upcomingAppointment}
            followUp={nextFollowUp}
            onPayNow={() => upcomingAppointment && navigate(`/patient/payments/${upcomingAppointment._id}`)}
            onReview={() => upcomingAppointment && navigate(`/patient/appointments?review=${upcomingAppointment._id}`)}
          />
          {upcomingAppointment && (
            <AIDraftPanel
              title="AI: Prepare for your visit"
              actionLabel="Get ready"
              onGenerate={() => aiAssistApi.appointmentPrep(upcomingAppointment._id)}
              compact
            />
          )}
          <HealthTimelineWidget timeline={timeline} />
          <HealthInsightsWidget insights={insights} />
          <PaymentsSnapshotWidget
            payablePayments={payablePayments}
            recentPayments={recentPayments}
            invoiceCount={invoices.length}
            wallet={wallet}
            refundRequests={refundRequests}
          />
        </div>
        <div className="space-y-6">
          <QuickActionsPanel />
          <ProfileCompletionWidget
            percentage={profileCompletion.percentage || 0}
            missing={profileCompletion.missing || []}
          />
          <NotificationCenterWidget
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={markNotificationRead}
            expanded={notificationsExpanded}
            onToggleExpand={() => setNotificationsExpanded((current) => !current)}
          />
          <FamilyHealthWidget familyMembers={familyMembers} />
          <InsuranceSnapshotWidget policies={insurancePolicies} />
          <RecordsSnapshotWidget
            reportsCount={reports.length}
            prescriptionsCount={prescriptions.length}
            categoryBreakdown={categoryBreakdown}
          />
          <DiscoveryWidget recentlyViewed={recentlyViewed} savedDoctors={savedDoctors} />
        </div>
      </div>
    </div>
  );
}

export default PatientDashboard;
