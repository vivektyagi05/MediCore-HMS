import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  UserCog,
  ShieldCheck,
  CreditCard,
  TrendingUp,
  Eye,
  Users,
  Award,
} from "lucide-react";
import { practiceApi } from "../../api/practiceApi";
import PracticeManagementNav from "../../components/practice/PracticeManagementNav";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import ErrorState from "../../components/shared/ErrorState";
import { useRealtime } from "../../context/RealtimeContext";
import { useI18n } from "../../i18n/I18nContext";

// Small label map for the raw verificationStatus enum (approved/pending/
// rejected) — mirrors the same values DoctorVerificationCenter.jsx already
// displays, just capitalized rather than shown raw on this summary card.
function formatVerificationStatus(status) {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Practice Management Platform hub (Phase D4) -- connects Profile Strength,
// Professional Profile, Verification, Billing, and Subscription into one
// view, mirroring the businessOverviewController.js / DoctorBusinessOverview.jsx
// pattern established in Phase D3.
export default function DoctorPracticeOverview() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { dashboardSyncTick } = useRealtime();
  const { t } = useI18n();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await practiceApi.getOverview();
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
    return <ErrorState title="Couldn't load practice overview" description={error} onRetry={load} />;
  }

  const { profile, profileIntelligence, verificationCenter, subscriptionIntelligence, practiceAnalytics } = overview;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Practice Management Platform"
        description="Identity → Professional Profile → Verification → Subscription → Practice Settings, in one connected view"
      />

      <PracticeManagementNav active="overview" />

      <div className="glass-card flex flex-col items-center gap-4 rounded-2xl p-8 text-center sm:flex-row sm:text-left">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-3xl font-black text-white shadow-xl">
          {profileIntelligence.profileCompletionPercent}%
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Profile Completion</p>
          <p className="mt-1 text-sm text-slate-500">
            {profile.specialization ? `${profile.specialization} · ` : ""}
            {profile.hospitalName || "No practice location set yet"}
            {profile.city ? `, ${profile.city}` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard icon={UserCog} label="Trust Score" value={`${profileIntelligence.trustScore}/100`} caption={`SEO readiness: ${profileIntelligence.seoReadinessPercent}%`} tone="violet" />
        <MetricCard
          icon={ShieldCheck}
          label="Verification"
          value={formatVerificationStatus(verificationCenter.verificationStatus)}
          caption={`${verificationCenter.requiredDocuments.filter((d) => d.status === "verified").length}/${verificationCenter.requiredDocuments.length} docs verified`}
          tone={verificationCenter.verificationStatus === "approved" ? "success" : "warning"}
        />
        <MetricCard
          icon={CreditCard}
          label="Subscription Plan"
          value={subscriptionIntelligence.currentPlan.planName}
          caption={subscriptionIntelligence.currentPlan.status}
          tone="info"
        />
        <MetricCard icon={TrendingUp} label="Growth Score" value={`${practiceAnalytics.growthScore}/100`} caption={`${practiceAnalytics.profileVisits} profile visits`} tone="info" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard icon={Eye} label="Profile Visits" value={practiceAnalytics.profileVisits} caption="all-time" tone="neutral" />
        <MetricCard
          icon={TrendingUp}
          label="Appointment Conversion"
          value={practiceAnalytics.appointmentConversionRate != null ? `${practiceAnalytics.appointmentConversionRate}%` : "—"}
          caption={practiceAnalytics.appointmentConversionRate != null ? "of profile visits" : "not enough view data yet"}
          tone="success"
        />
        <MetricCard icon={Users} label="New Patients" value={practiceAnalytics.patientAcquisition.newPatientsThisMonth} caption="this month" tone="warning" />
        <MetricCard icon={Award} label="Repeat Patients" value={`${practiceAnalytics.repeatPatients.rate}%`} caption={`${practiceAnalytics.repeatPatients.count} total`} tone="danger" />
      </div>

      {profileIntelligence.recommendations?.length > 0 && (
        <div className="glass-card rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <p className="text-sm font-black text-amber-800">Recommended next steps</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-700">
            {profileIntelligence.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
          <Link to="/doctor/profile/edit" className="mt-3 inline-block text-sm font-semibold text-blue-600 hover:text-blue-700">
            Update Professional Profile →
          </Link>
        </div>
      )}
    </div>
  );
}
