import { useCallback, useEffect, useState } from "react";
import { TrendingUp, Wallet, Star, Users, CalendarCheck } from "lucide-react";
import { doctorApi } from "../../api/doctorApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import BusinessIntelligenceNav from "../../components/business/BusinessIntelligenceNav";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import ErrorState from "../../components/shared/ErrorState";
import { useRealtime } from "../../context/RealtimeContext";
import { useI18n } from "../../i18n/I18nContext";

export default function DoctorBusinessOverview() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { dashboardSyncTick } = useRealtime();
  const { t } = useI18n();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await doctorApi.getBusinessOverview();
      setOverview(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load, dashboardSyncTick]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card h-32 rounded-2xl bg-slate-100" />
          ))}
        </div>
        <div className="glass-card h-64 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Couldn't load business overview" description={error} onRetry={load} />;
  }

  const { businessScore, revenue, rating, growth, retention, appointments, refundRate, reviewsNeedingAttention } = overview;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Business Overview"
        description="Performance → Patient Satisfaction → Clinical Quality → Revenue → Growth → Retention → Business Health, in one view"
      />

      <BusinessIntelligenceNav overview={overview} active="overview" />

      {/* Business Health headline */}
      <div className="glass-card flex flex-col items-center gap-4 rounded-2xl p-8 text-center sm:flex-row sm:text-left">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-3xl font-black text-white shadow-xl">
          {businessScore}
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Business Health Score</p>
          <p className="mt-1 text-sm text-slate-500">
            A weighted composite of reputation, revenue trend, patient retention, and approval conversion — out of 100.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard icon={Wallet} label="Revenue this month" value={`₹${revenue.monthly}`} caption={`Forecast: ₹${revenue.forecast}`} tone="success" />
        <MetricCard icon={Star} label="Rating" value={rating.average > 0 ? `${rating.average}/5` : "—"} caption={`${rating.totalReviews} reviews`} tone="warning" />
        <MetricCard icon={TrendingUp} label="Growth" value={`${growth.monthlyGrowth >= 0 ? "+" : ""}${growth.monthlyGrowth}%`} caption={`${growth.newPatientsThisMonth} new patients`} tone="info" />
        <MetricCard icon={Users} label="Repeat Patients" value={`${retention.repeatPatientRate}%`} caption={`${retention.repeatPatients} total`} tone="violet" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard icon={CalendarCheck} label="Completed" value={appointments.completed} caption="consultations" tone="neutral" />
        <MetricCard icon={CalendarCheck} label="Cancelled" value={appointments.cancelled} caption="appointments" tone="danger" />
        <MetricCard icon={TrendingUp} label="Conversion Rate" value={`${appointments.conversionRate}%`} caption="approved of decided" tone="info" />
        <MetricCard icon={Wallet} label="Refund Rate" value={`${refundRate}%`} caption="of gross revenue" tone="warning" />
      </div>

      {(reviewsNeedingAttention.negativeCount > 0 || reviewsNeedingAttention.unrepliedCount > 0) && (
        <div className="glass-card rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <p className="text-sm font-black text-amber-800">Needs attention</p>
          <p className="mt-1 text-sm text-amber-700">
            {reviewsNeedingAttention.negativeCount > 0 && `${reviewsNeedingAttention.negativeCount} negative review(s). `}
            {reviewsNeedingAttention.unrepliedCount > 0 && `${reviewsNeedingAttention.unrepliedCount} review(s) awaiting your reply.`}
          </p>
        </div>
      )}

      <AIDraftPanel
        title="AI Business Advisor"
        actionLabel="Generate Monthly Business Report"
        onGenerate={() => aiAssistApi.getBusinessAdvisor()}
      />
    </div>
  );
}
