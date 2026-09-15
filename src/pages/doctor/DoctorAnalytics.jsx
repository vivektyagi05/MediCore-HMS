import { Activity, BarChart3, CalendarCheck, Download, Percent, Repeat, Star, TrendingUp, XCircle, Users, FileText, ClipboardList, Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import DoctorMetricCard from "../../components/doctor/DoctorMetricCard";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/shared/EmptyState";
import Loader from "../../components/ui/Loader";
import BusinessIntelligenceNav from "../../components/business/BusinessIntelligenceNav";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

function DoctorAnalytics() {
  const [analytics, setAnalytics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const toast = useToast();
  const { t } = useI18n();
  const { dashboardSyncTick } = useRealtime();

  const loadAnalytics = () => {
    setIsLoading(true);
    setError("");
    doctorWorkflowApi.getAnalytics()
      .then((response) => setAnalytics(response.data))
      .catch((err) => {
        setError(getApiErrorMessage(err));
        toast.error(getApiErrorMessage(err));
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadAnalytics();
  }, [dashboardSyncTick]);

  const maxTrendRevenue = useMemo(() => {
    if (!analytics?.revenueTrend?.length) return 0;
    return Math.max(...analytics.revenueTrend.map((point) => point.revenue), 1);
  }, [analytics]);

  const exportData = async (resource, format) => {
    try {
      const blob = await doctorWorkflowApi.exportData({ resource, format });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${resource}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Export started");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  if (isLoading) return <Loader label="Loading doctor analytics" />;

  // BUGFIX: previously this page crashed with a TypeError ("Cannot read
  // properties of null") whenever the analytics fetch failed, because it
  // unconditionally read analytics.completed etc. right after the loading
  // check with no null-guard for the error path.
  if (!analytics) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">{t("sidebar.analytics")}</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Clinical and revenue intelligence</h1>
        </div>
        <EmptyState
          title="Analytics unavailable"
          description={error || "Could not load analytics right now."}
        />
        <Button onClick={loadAnalytics}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">{t("sidebar.analytics")}</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Clinical and revenue intelligence</h1>
        </div>
        <Button onClick={loadAnalytics}>Refresh</Button>
      </div>

      <BusinessIntelligenceNav overview={null} active="analytics" />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-5">
        <DoctorMetricCard icon={Activity} label="Completed" value={analytics.completed} />
        <DoctorMetricCard icon={Star} label="Average rating" value={analytics.averageRating} />
        <DoctorMetricCard icon={Repeat} label="Return ratio" value={`${Math.round((analytics.patientReturnRatio || 0) * 100)}%`} />
        <DoctorMetricCard icon={BarChart3} label="Revenue" value={`INR ${analytics.revenue}`} />
        <DoctorMetricCard icon={XCircle} label="Cancellation" value={`${Math.round((analytics.cancellationRate || 0) * 100)}%`} />
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <DoctorMetricCard icon={CalendarCheck} label="Patients today" value={analytics.patientsToday ?? 0} />
        <DoctorMetricCard icon={Percent} label="Approval rate" value={`${Math.round((analytics.approvalRate || 0) * 100)}%`} />
        <DoctorMetricCard icon={Activity} label="Most common consultation" value={analytics.mostCommonConsultationType ? analytics.mostCommonConsultationType.replace("_", " ") : "N/A"} />
        <DoctorMetricCard icon={TrendingUp} label="Most active day" value={analytics.mostActiveDay || "N/A"} />
      </div>

      <Card title="Revenue Trend (last 6 months)">
        {analytics.revenueTrend?.length ? (
          <div className="flex h-72 items-end gap-4 rounded-2xl bg-white/50 p-5">
            {analytics.revenueTrend.map((point) => (
              <div key={point.month} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-xl bg-blue-600 shadow-lg"
                  style={{ height: `${Math.max((point.revenue / maxTrendRevenue) * 100, 4)}%` }}
                  title={`₹${point.revenue}`}
                />
                <p className="text-xs font-bold text-slate-500">{point.month}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No revenue yet" description="Revenue trend will appear once payments start coming in." />
        )}
        <p className="mt-4 text-sm font-bold text-slate-500">
          Monthly growth: <span className={analytics.monthlyGrowth >= 0 ? "text-emerald-600" : "text-red-600"}>{analytics.monthlyGrowth >= 0 ? "+" : ""}{analytics.monthlyGrowth}%</span> vs previous month
          {" · "}
          Forecast next month: <span className="text-slate-900">₹{analytics.revenueForecast ?? 0}</span> ({analytics.growthForecast >= 0 ? "+" : ""}{analytics.growthForecast ?? 0}% projected growth)
        </p>
      </Card>

      {/* Appointment / Revenue / Patient Funnels */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Appointment Funnel">
          <div className="space-y-2 text-sm font-semibold text-slate-600">
            <div className="flex justify-between"><span>Requested</span><span>{analytics.appointmentFunnel?.requested ?? 0}</span></div>
            <div className="flex justify-between"><span>Approved or beyond</span><span>{analytics.appointmentFunnel?.approvedOrBeyond ?? 0}</span></div>
            <div className="flex justify-between"><span>Completed</span><span className="text-emerald-600">{analytics.appointmentFunnel?.completed ?? 0}</span></div>
            <div className="flex justify-between"><span>Cancelled</span><span className="text-rose-600">{analytics.appointmentFunnel?.cancelled ?? 0}</span></div>
          </div>
        </Card>
        <Card title="Revenue Funnel">
          <div className="space-y-2 text-sm font-semibold text-slate-600">
            <div className="flex justify-between"><span>Payments created</span><span>{analytics.revenueFunnel?.created ?? 0}</span></div>
            <div className="flex justify-between"><span>Paid</span><span className="text-emerald-600">{analytics.revenueFunnel?.paid ?? 0}</span></div>
            <div className="flex justify-between"><span>Refunded</span><span className="text-rose-600">{analytics.revenueFunnel?.refunded ?? 0}</span></div>
          </div>
        </Card>
        <Card title="Patient Funnel (this month)">
          <div className="space-y-2 text-sm font-semibold text-slate-600">
            <div className="flex justify-between"><span>New patients</span><span className="text-blue-600">{analytics.patientFunnel?.newPatients ?? 0}</span></div>
            <div className="flex justify-between"><span>Returning patients</span><span className="text-violet-600">{analytics.patientFunnel?.returningPatients ?? 0}</span></div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <DoctorMetricCard icon={Clock} label="Top peak hour" value={analytics.peakHours?.[0] ? `${analytics.peakHours[0].hour}:00 (${analytics.peakHours[0].count})` : "N/A"} />
        <DoctorMetricCard icon={FileText} label="Follow-up success" value={analytics.followUpSuccessRate === null ? "N/A" : `${analytics.followUpSuccessRate}%`} />
        <DoctorMetricCard icon={ClipboardList} label="Prescriptions issued" value={analytics.prescriptionStats?.total ?? 0} />
        <DoctorMetricCard icon={Users} label="Distinct reports shared" value={analytics.reportStatsTotal ?? 0} />
      </div>

      {analytics.cancellationTrend?.length > 0 && (
        <Card title="Cancellation Trend (6 months)">
          <div className="flex h-40 items-end gap-3 rounded-2xl bg-white/50 p-4">
            {analytics.cancellationTrend.map((point) => {
              const max = Math.max(...analytics.cancellationTrend.map((p) => p.cancelled), 1);
              return (
                <div key={point.month} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-xl bg-rose-500"
                    style={{ height: `${Math.max((point.cancelled / max) * 100, point.cancelled ? 6 : 2)}%` }}
                    title={`${point.cancelled} cancelled`}
                  />
                  <p className="text-xs font-bold text-slate-500">{point.month}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Exports">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => exportData("prescriptions", "csv")}><Download size={17} /> Prescriptions CSV</Button>
          <Button variant="secondary" onClick={() => exportData("prescriptions", "pdf")}>Prescriptions PDF</Button>
          <Button variant="secondary" onClick={() => exportData("schedules", "csv")}>Schedule CSV</Button>
        </div>
      </Card>
    </div>
  );
}

export default DoctorAnalytics;
