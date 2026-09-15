import { useEffect, useState, useCallback } from "react";
import { Star, TrendingUp, Users, MessageSquare, Award, ShieldCheck, Repeat, CalendarCheck } from "lucide-react";
import { publicApi } from "../../api/publicApi";
import { doctorApi } from "../../api/doctorApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import BusinessIntelligenceNav from "../../components/business/BusinessIntelligenceNav";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import ErrorState from "../../components/shared/ErrorState";
import { useRealtime } from "../../context/RealtimeContext";
import { useI18n } from "../../i18n/I18nContext";

const StarRating = ({ rating, size=14 }) => (
  <span className="flex items-center gap-0.5">
    {[1,2,3,4,5].map(i=>(
      <Star key={i} size={size} className={i<=Math.floor(rating)?"fill-amber-400 text-amber-400":i===Math.floor(rating)+1&&rating%1>=0.5?"fill-amber-200 text-amber-400":"text-slate-300"}/>
    ))}
  </span>
);

function RatingBar({ stars, count, total }) {
  const pct = total>0 ? Math.round((count/total)*100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 text-right text-xs font-semibold text-slate-500">{stars} ★</span>
      <div className="flex-1 overflow-hidden rounded-full bg-slate-200 h-2.5">
        <div className="h-2.5 rounded-full bg-amber-400 transition-all duration-700" style={{width:`${pct}%`}}/>
      </div>
      <span className="w-10 text-right text-xs font-semibold text-slate-600">{count} <span className="text-slate-400">({pct}%)</span></span>
    </div>
  );
}

function SparkLine({ data, color="stroke-blue-500", label="" }) {
  if (!data?.length) return (
    <div className="flex h-24 items-center justify-center text-xs text-slate-400">No data yet</div>
  );
  const vals = data.map(d=>d.count);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max-min||1;
  const W=300, H=80, PAD=6;
  const pts = vals.map((v,i)=>{
    const x = PAD + (i/(vals.length-1||1))*(W-PAD*2);
    const y = PAD + (1-(v-min)/range)*(H-PAD*2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div>
      {label && <p className="mb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
          <polyline points={pts} fill="none" className={`${color} opacity-80`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
          {vals.map((v,i)=>{
            const x=PAD+(i/(vals.length-1||1))*(W-PAD*2);
            const y=PAD+(1-(v-min)/range)*(H-PAD*2);
            return <circle key={i} cx={x} cy={y} r="3.5" className="fill-white stroke-current stroke-2" style={{color:color.replace("stroke-","").replace(/-\d+/,v=>v)}}/>;
          })}
        </svg>
        <div className="mt-1 flex justify-between text-xs text-slate-400 overflow-hidden">
          {data.map((d,i)=>(i===0||i===data.length-1||i===Math.floor(data.length/2))&&<span key={i}>{d.label}</span>)}
        </div>
      </div>
    </div>
  );
}

export default function DoctorReputationCenter() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const { t } = useI18n();
  const [error, setError]     = useState(null);
  const { dashboardSyncTick } = useRealtime();
  // BUGFIX (PHASE DOC-05 audit): this page always passed overview={null} to
  // BusinessIntelligenceNav, so its own nav tile ("Rating") permanently
  // showed "—" even though the real figure was one existing call away —
  // the same real endpoint the sibling Reviews/Overview pages already use.
  const [businessOverview, setBusinessOverview] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await publicApi.getReputation();
      setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || t("common.error"));
    } finally { setLoading(false); }
  }, []);

  const loadBusinessOverview = useCallback(async () => {
    try {
      const res = await doctorApi.getBusinessOverview();
      setBusinessOverview(res.data || null);
    } catch {
      setBusinessOverview(null);
    }
  }, []);

  useEffect(()=>{ load(); loadBusinessOverview(); },[load, loadBusinessOverview, dashboardSyncTick]);

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({length:4}).map((_,i)=><div key={i} className="glass-card h-32 rounded-2xl bg-slate-100"/>)}
      </div>
      <div className="glass-card h-64 rounded-2xl bg-slate-100"/>
    </div>
  );

  if (error) {
    return <ErrorState title="Couldn't load reputation data" description={error} onRetry={load} />;
  }

  const { overview, ratingDistribution, monthlyConsultations, monthlyReviews, intelligence } = data;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Reputation Intelligence Center"
        description="Your practice performance and patient satisfaction analytics"
      />

      <BusinessIntelligenceNav overview={businessOverview} active="reputation" />

      {/* Overview stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard icon={Star} label="Average Rating" value={overview.rating>0?`${overview.rating}/5`:"—"} caption={`${overview.totalReviews} reviews`} tone="warning"/>
        <MetricCard icon={Users} label="Total Consultations" value={overview.totalConsultations} caption="completed" tone="info"/>
        <MetricCard icon={MessageSquare} label="Satisfaction Rate" value={overview.totalReviews>0?`${overview.satisfactionRate}%`:"—"} caption="rated 4★ or above" tone="success"/>
        <MetricCard icon={Award} label="Repeat Patients" value={overview.repeatPatients} caption="visited more than once" tone="violet"/>
      </div>

      {/* Reputation Intelligence: composite scores + operational metrics */}
      {intelligence && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard icon={ShieldCheck} label="Business Reputation Score" value={`${intelligence.businessReputationScore}/100`} caption="rating + satisfaction + reliability + response" tone="info"/>
            <MetricCard icon={Users} label="Patient Trust Score" value={`${intelligence.patientTrustScore}/100`} caption="recommendation + repeat rate + response" tone="violet"/>
            <MetricCard icon={CalendarCheck} label="Clinical Reliability" value={`${intelligence.clinicalReliabilityScore}/100`} caption="appointment reliability + rating" tone="success"/>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard icon={MessageSquare} label="Review Response Rate" value={`${intelligence.responseRate}%`} tone="neutral"/>
            <MetricCard icon={CalendarCheck} label="Appointment Reliability" value={`${intelligence.appointmentReliability}%`} caption={`${intelligence.cancellationRate}% cancellation rate`} tone="info"/>
            <MetricCard icon={Award} label="Recommendation Rate" value={`${intelligence.recommendationRate}%`} tone="warning"/>
            <MetricCard icon={Repeat} label="Repeat Patient Rate" value={`${intelligence.repeatPatientRate}%`} tone="danger"/>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="glass-card rounded-2xl p-5">
              <h3 className="mb-3 text-xs font-black uppercase tracking-widest text-emerald-600">Top Strengths</h3>
              <ul className="space-y-2">
                {intelligence.topStrengths.map((s) => (
                  <li key={s} className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">{s}</li>
                ))}
              </ul>
            </div>
            <div className="glass-card rounded-2xl p-5">
              <h3 className="mb-3 text-xs font-black uppercase tracking-widest text-amber-600">Improvement Opportunities</h3>
              <ul className="space-y-2">
                {intelligence.improvementOpportunities.map((s) => (
                  <li key={s} className="rounded-xl bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700">{s}</li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      {/* Overall rating widget */}
      {overview.totalReviews > 0 && (
        <div className="glass-card rounded-2xl p-6">
          <h3 className="mb-5 text-xs font-black uppercase tracking-widest text-slate-400">Rating Breakdown</h3>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="flex-shrink-0 text-center">
              <p className="text-6xl font-black text-slate-950">{overview.rating}</p>
              <StarRating rating={overview.rating} size={20}/>
              <p className="mt-1 text-xs text-slate-400">{overview.totalReviews} reviews</p>
            </div>
            <div className="flex-1 space-y-2.5">
              {[5,4,3,2,1].map(s=>(
                <RatingBar key={s} stars={s} count={ratingDistribution?.[s]||0} total={overview.totalReviews}/>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Trends */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="glass-card rounded-2xl p-5">
          <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-slate-400">Consultation Trend (6 months)</h3>
          <SparkLine data={monthlyConsultations} color="stroke-blue-500"/>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-slate-400">Review Trend (6 months)</h3>
          <SparkLine data={monthlyReviews} color="stroke-amber-500"/>
        </div>
      </div>

      <AIDraftPanel
        title="AI Reputation Advisor"
        actionLabel="Get Reputation Advice"
        onGenerate={() => aiAssistApi.getReputationAdvisor()}
        compact
      />

      {/* Empty state */}
      {overview.totalConsultations === 0 && (
        <div className="glass-card flex flex-col items-center rounded-2xl py-12 text-center">
          <TrendingUp size={36} className="mb-3 text-slate-300"/>
          <p className="font-black text-slate-950">No analytics yet</p>
          <p className="mt-1 text-sm text-slate-400">Reputation data will appear once you complete your first consultation.</p>
        </div>
      )}
    </div>
  );
}
