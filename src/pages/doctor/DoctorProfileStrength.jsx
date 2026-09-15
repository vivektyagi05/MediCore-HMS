import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowRight, BadgeCheck, Building2, CalendarDays, CheckCircle2, Eye, FileCheck2, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { practiceApi } from "../../api/practiceApi";
import PracticeManagementNav from "../../components/practice/PracticeManagementNav";
import { useRealtime } from "../../context/RealtimeContext";
import { useI18n } from "../../i18n/I18nContext";

const CATEGORY_CONFIG = [
  ["identity", "UserRound"],
  ["credentials", "FileCheck2"],
  ["practice", "Building2"],
  ["discoverability", "Eye"],
];

const FIELD_LABEL_KEYS = {
  bio: "bio", profilePhoto: "photo", qualification: "qualification", hospitalName: "hospital",
  city: "city", state: "state", languages: "languages", licenseNumber: "license", medicalCouncil: "council",
  availability: "manageAvailability", documents: "verificationProgress", education: "education",
  experienceEntries: "experience", subSpecialties: "subspecialties", clinics: "clinics", insuranceAccepted: "insurance",
};

const attentionTitle = (p, item) => {
  if (item.key === "verification-pending") return p("verificationPending");
  if (item.key === "verification-rejected") return p("verificationRejected");
  if (item.key === "discoverability") return p("discoverability");
  return p(FIELD_LABEL_KEYS[item.key] || "profileQuality");
};

const attentionDetail = (p, item) => {
  if (item.key === "verification-pending") return p("verificationPendingDetail");
  if (item.key === "verification-rejected") return item.detail || p("verificationRejectedDetail");
  if (item.key === "discoverability") return p("publicLimitedDetail");
  return p("attentionAction"); 
};

const ICONS = { UserRound, FileCheck2, Building2, Eye };

function ScoreBar({ value }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-label={`${value}%`}>
      <div className="h-full rounded-full bg-slate-900 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function ScoreCard({ label, value, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700"><Icon size={16} /> {label}</div>
        <span className="text-sm font-black text-slate-950">{value}%</span>
      </div>
      <div className="mt-3"><ScoreBar value={value} /></div>
    </div>
  );
}

export default function DoctorProfileStrength() {
  const { t } = useI18n();
  const p = (key) => t(`p18.${key}`);
  const { dashboardSyncTick } = useRealtime();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await practiceApi.getProfileIntelligence();
      if (!res?.success || !res?.data) throw new Error(p("commandCenterRetry"));
      setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || p("commandCenterRetry"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load, dashboardSyncTick]);

  if (loading) return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-48 animate-pulse rounded-3xl bg-slate-100" />
      <div className="grid gap-4 sm:grid-cols-2"><div className="h-28 animate-pulse rounded-2xl bg-slate-100" /><div className="h-28 animate-pulse rounded-2xl bg-slate-100" /></div>
    </div>
  );

  if (error) return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
      <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>
      <button type="button" onClick={load} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-sm">
        <RefreshCw size={14} /> {p("commandCenterRetry")}
      </button>
    </div>
  );

  if (!data) return null;
  const quality = Number(data.profileQualityScore ?? data.profileCompletionPercent ?? 0);
  const publicPath = data.identity?.id ? `/doctors/${data.identity.id}` : null;

  return (
    <div className="space-y-6">
      <PracticeManagementNav active="identity" />

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-950 p-6 text-white sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              {data.identity?.profilePhoto ? (
                <img src={data.identity.profilePhoto} alt={data.identity?.name || p("commandCenterTitle")} className="h-20 w-20 rounded-2xl object-cover ring-2 ring-white/20" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10"><UserRound size={30} /></div>
              )}
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-300">{p("commandCenterTitle")}</p>
                <h1 className="mt-1 text-2xl font-black">{data.identity?.name || p("title")}</h1>
                <p className="mt-1 text-sm text-slate-300">{[data.identity?.qualification, data.identity?.specialization].filter(Boolean).join(" · ") || p("editProfile")}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/doctor/profile/edit" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-slate-950"><UserRound size={15} /> {p("editProfile")}</Link>
              {publicPath && <Link to={publicPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2.5 text-sm font-bold text-white"><Eye size={15} /> {p("previewPublic")}</Link>}
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-6 sm:grid-cols-[1fr_220px] sm:p-8">
          <div>
            <div className="flex items-end justify-between gap-4">
              <div><p className="text-sm font-black text-slate-950">{p("profileQuality")}</p><p className="mt-1 text-xs text-slate-500">{p("realData")}</p></div>
              <span className="text-4xl font-black text-slate-950">{quality}<span className="text-lg text-slate-400">/100</span></span>
            </div>
            <div className="mt-4"><ScoreBar value={quality} /></div>
            <p className="mt-3 text-xs font-semibold text-slate-500">{p("savedState")}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-black text-slate-800"><ShieldCheck size={16} /> {p("trustScore")}</div>
            <p className="mt-2 text-3xl font-black text-slate-950">{data.trustScore}/100</p>
            <p className="mt-1 text-xs text-slate-500">{p("verificationProgress")}: {data.verificationProgressPercent}%</p>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3"><h2 className="text-lg font-black text-slate-950">{p("qualityScore")}</h2></div>
        <div className="grid gap-4 sm:grid-cols-2">
          {CATEGORY_CONFIG.map(([key, iconName]) => <ScoreCard key={key} label={p(`category${key[0].toUpperCase()}${key.slice(1)}`)} value={data.categories?.[key] ?? 0} icon={ICONS[iconName]} />)}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.3fr_.7fr]">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2"><AlertCircle size={17} className="text-amber-700" /><h2 className="text-sm font-black text-slate-950">{p("needsAttention")}</h2></div>
          {data.attention?.length ? (
            <div className="mt-4 space-y-2">
              {data.attention.slice(0, 6).map((item) => (
                <Link key={item.key} to={item.action || "/doctor/profile/edit"} className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-white p-3 transition hover:border-amber-400">
                  <div><p className="text-sm font-bold text-slate-900">{attentionTitle(p, item)}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{attentionDetail(p, item)}</p></div>
                  <ArrowRight size={15} className="shrink-0 text-slate-400" />
                </Link>
              ))}
            </div>
          ) : <p className="mt-4 text-sm font-semibold text-emerald-700">{p("allClear")}</p>}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-black text-slate-950">{p("publicPresence")}</h2>
          <div className={`mt-4 rounded-xl border p-4 ${data.publicReadiness?.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-center gap-2">
              {data.publicReadiness?.ready ? <CheckCircle2 size={17} className="text-emerald-600" /> : <AlertCircle size={17} className="text-amber-600" />}
              <p className="text-sm font-bold text-slate-900">{data.publicReadiness?.ready ? p("publicLive") : p("publicLimited")}</p>
            </div>
            {!data.publicReadiness?.ready && <ul className="mt-3 space-y-1 text-xs text-slate-600">{(data.publicReadiness?.blockers || []).map((x) => <li key={x}>• {x === "ACCOUNT_INACTIVE" ? p("accountInactive") : p("verificationNotApproved")}</li>)}</ul>}
          </div>
          <div className="mt-4 grid gap-2">
            <Link to="/doctor/profile/edit" className="inline-flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-700"><span className="flex items-center gap-2"><UserRound size={14} /> {p("editProfile")}</span><ArrowRight size={14} /></Link>
            <Link to="/doctor/schedule" className="inline-flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-700"><span className="flex items-center gap-2"><CalendarDays size={14} /> {p("manageAvailability")}</span><ArrowRight size={14} /></Link>
            <Link to="/doctor/practice" className="inline-flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-700"><span className="flex items-center gap-2"><Building2 size={14} /> {p("managePractice")}</span><ArrowRight size={14} /></Link>
            <Link to="/doctor/verification" className="inline-flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-700"><span className="flex items-center gap-2"><BadgeCheck size={14} /> {p("openVerification")}</span><ArrowRight size={14} /></Link>
          </div>
        </div>
      </section>
    </div>
  );
}
