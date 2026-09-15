import { useI18n } from "../../i18n/I18nContext";
import { useEffect, useState } from "react";
import { ArrowRight, BadgeCheck, HeartPulse, ShieldCheck, Sparkles, Users, Workflow } from "lucide-react";
import { Link } from "react-router-dom";
import SEOMeta from "../../components/shared/SEOMeta";
import { publicApi } from "../../api/publicApi";
import PublicPageFrame, { PublicCard, PublicSection } from "../../components/public/PublicPageFrame";

const stages = [
  ["01", "discover", "discoverText"],
  ["02", "trust", "trustText"],
  ["03", "coordinate", "coordinateText"],
  ["04", "care", "careText"],
  ["05", "continuity", "continuityText"],
];

export default function About() {
  const { t } = useI18n();
  const [stats, setStats] = useState(null);
  useEffect(() => {
    publicApi.getHomeStats().then((r) => setStats(r.data)).catch(() => {});
  }, []);

  return (
    <PublicPageFrame>
      <SEOMeta title={t("p11.about.auto14")} description={t("p11.about.auto18")} canonical="/about" />
      <section className="public-shell px-4 pb-16 pt-16 sm:px-6 lg:px-8 lg:pt-24">
        <div className="grid items-end gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div><p className="text-xs font-black uppercase tracking-[0.22em] text-orange-600">{t("p11.about.auto1")}</p><h1 className="mt-5 max-w-5xl text-5xl font-black leading-[0.98] tracking-[-0.04em] text-slate-950 sm:text-7xl">{t("p11.about.auto2")}<span className="text-orange-600">{t("p11.about.auto3")}</span></h1><p className="mt-6 max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">{t("p11.about.auto4")}</p></div>
          <PublicCard className="p-5"><p className="text-xs font-black uppercase tracking-[0.2em] text-slate-600">{t("p11.about.auto5")}</p><div className="mt-5 grid grid-cols-3 gap-2">{[[stats?.verifiedDoctors ?? "—", t("p13.home.verifiedDoctors")], [stats?.totalConsultations ?? "—", t("p13.home.completedConsultations")], [stats?.totalSpecializations ?? "—", t("p13.home.specializations")]].map(([v,l]) => <div key={l} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-2xl font-black text-slate-950">{typeof v === "number" ? v.toLocaleString() : v}</p><p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-600">{l}</p></div>)}</div></PublicCard>
        </div>
      </section>

      <PublicSection eyebrow={t("p11.about.auto19")} title={t("p11.about.auto15")}><div className="grid gap-4 md:grid-cols-3">{[[ShieldCheck,t("p13.about.trustTitle"),t("p13.about.trustText")],[Workflow,t("p13.about.sourceTitle"),t("p13.about.sourceText")],[HeartPulse,t("p13.about.continuityTitle"),t("p13.about.continuityText")]].map(([Icon,title,desc]) => <PublicCard key={title} className="p-6"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600"><Icon size={19}/></span><h2 className="mt-5 text-base font-black text-slate-950">{title}</h2><p className="mt-2 text-sm leading-7 text-slate-500">{desc}</p></PublicCard>)}</div></PublicSection>

      <PublicSection eyebrow={t("p11.about.auto20")} title={t("p11.about.auto16")} description={t("p11.about.auto21")}><div className="relative overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-5 sm:p-7"><div className="pointer-events-none absolute left-[-5%] right-[-5%] top-1/2 hidden h-20 -translate-y-1/2 md:block"><div className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 rounded-[50%] border-y-2 border-orange-500/50 bg-orange-500/[0.04] shadow-[0_0_35px_rgba(249,115,22,0.12)]"/><div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[repeating-linear-gradient(90deg,rgba(251,146,60,0.8)_0_22px,transparent_22px_42px)]"/></div><div className="relative grid gap-3 md:grid-cols-5">{stages.map(([num,titleKey,descKey], i) => <div key={num} className="relative z-10"><div className="flex items-center gap-3 md:block"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-orange-400/30 bg-white text-xs font-black text-orange-600 shadow-[0_0_25px_rgba(249,115,22,0.16)]">{num}</div><div className="mt-0 rounded-xl border border-slate-200 bg-white p-3 backdrop-blur-xl md:mt-8"><p className="text-xs font-black text-slate-950">{t(`p13.about.${titleKey}`)}</p><p className="mt-1 text-xs leading-5 text-slate-600">{t(`p13.about.${descKey}`)}</p></div></div>{i < stages.length - 1 && <ArrowRight size={14} className="absolute -right-2 top-5 hidden text-orange-500 md:block"/>}</div>)}</div></div></PublicSection>

      <PublicSection eyebrow={t("p11.about.auto22")} title={t("p11.about.auto17")}><div className="grid gap-4 lg:grid-cols-2"><PublicCard className="p-7"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700"><Users size={19}/></span><div><p className="text-sm font-black text-slate-950">{t("p11.about.auto6")}</p><p className="text-xs text-slate-600">{t("p11.about.auto7")}</p></div></div><div className="mt-6 grid gap-2 sm:grid-cols-2">{Array.from({ length: 6 }, (_, i) => t(`p13.about.patient${i + 1}`)).map((x) => <div key={x} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600"><BadgeCheck size={13} className="mt-0.5 shrink-0 text-emerald-400"/>{x}</div>)}</div></PublicCard><PublicCard className="p-7"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300"><Sparkles size={19}/></span><div><p className="text-sm font-black text-slate-950">{t("p11.about.auto8")}</p><p className="text-xs text-slate-600">{t("p11.about.auto9")}</p></div></div><div className="mt-6 grid gap-2 sm:grid-cols-2">{Array.from({ length: 6 }, (_, i) => t(`p13.about.platform${i + 1}`)).map((x) => <div key={x} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600"><BadgeCheck size={13} className="mt-0.5 shrink-0 text-emerald-400"/>{x}</div>)}</div></PublicCard></div></PublicSection>

      <section className="public-shell px-4 pb-20 sm:px-6 lg:px-8"><div className="rounded-[1.7rem] border border-slate-200 bg-white p-8 sm:p-10"><div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">{t("p11.about.auto10")}</p><h2 className="mt-2 text-2xl font-black text-slate-950">{t("p11.about.auto11")}</h2></div><div className="flex gap-2"><Link to="/doctors" className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-xs font-black text-slate-950">{t("p11.about.auto12")}<ArrowRight size={14}/></Link><Link to="/contact" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-500">{t("p11.about.auto13")}</Link></div></div></div></section>
    </PublicPageFrame>
  );
}
