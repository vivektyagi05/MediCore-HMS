import SEOMeta, { buildOrganizationJsonLd, buildWebSiteJsonLd } from "../../components/shared/SEOMeta";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, ArrowUpRight, BadgeCheck, Calendar, ChevronDown, ChevronUp,
  CircleCheck, Clock3, FileCheck2, HeartPulse, MapPin, MessageSquare,
  Search, ShieldCheck, Sparkles, Star, Stethoscope, Wallet,
} from "lucide-react";
import { publicApi } from "../../api/publicApi";
import CoverageMap from "../../components/public/CoverageMap";
import { useI18n } from "../../i18n/I18nContext";
import PublicPageFrame, { PublicCard, PublicSection } from "../../components/public/PublicPageFrame";
import { matchConcerns } from "../../utils/concernMap";

const StarRating = ({ rating = 0 }) => (
  <span className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={13} className={n <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-slate-500"} />)}
  </span>
);

function DoctorCard({ doctor }) {
  const { t } = useI18n();
  const initials = (doctor.name || t("p13.home.doctor")).split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <Link to={`/doctors/${doctor.id}`} className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:-translate-y-1 hover:border-orange-400/30 hover:bg-slate-50">
      <div className="flex items-start gap-3">
        {doctor.profilePhoto ? <img src={doctor.profilePhoto} alt={doctor.name} className="h-14 w-14 rounded-xl object-cover" /> : <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500/25 to-red-500/20 text-sm font-black text-orange-600">{initials}</span>}
        <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="truncate text-sm font-black text-slate-950">{doctor.name}</p>{doctor.isVerified && <BadgeCheck size={14} className="shrink-0 text-sky-400"/>}</div><p className="mt-1 truncate text-xs font-semibold text-slate-500">{doctor.specialization}</p><p className="mt-1 truncate text-xs text-slate-600">{doctor.qualification || `${doctor.experience || 0} years experience`}</p></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">{(doctor.consultationMode || []).slice(0, 2).map((mode) => <span key={mode} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-600">{mode === "home_visit" ? t("p13.home.homeVisit") : mode === "online" ? t("p13.home.online") : mode === "offline" ? t("p13.home.offline") : mode}</span>)}{doctor.city && <span className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-500"><MapPin size={9}/>{doctor.city}</span>}</div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3"><div className="flex items-center gap-2"><StarRating rating={doctor.rating}/><span className="text-xs font-black text-slate-500">{Number(doctor.rating || 0).toFixed(1)}</span><span className="text-xs text-slate-600">{t("p13.home.reviewCount", { count: doctor.totalReviews || 0 })}</span></div><span className="text-sm font-black text-slate-950">₹{doctor.fees}</span></div>
    </Link>
  );
}

function Faq({ item }) {
  const [open, setOpen] = useState(false);
  return <div className="border-b border-slate-200 last:border-0"><button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 py-5 text-left"><span className="text-sm font-bold text-slate-800">{item.q}</span>{open ? <ChevronUp size={16} className="text-orange-600"/> : <ChevronDown size={16} className="text-slate-600"/>}</button>{open && <p className="pb-5 max-w-3xl text-sm leading-7 text-slate-500">{item.a}</p>}</div>;
}

export default function Home() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [search, setSearch] = useState({ q: "", city: "", mode: "" });
  const [coverageState, setCoverageState] = useState("");
  const [data, setData] = useState({ stats: null, featured: null, meta: null, specialties: [], articles: [], testimonials: [], coverage: null, seo: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      publicApi.getHomeStats(), publicApi.getFeaturedDoctors(), publicApi.getSearchMeta(), publicApi.getHomeSeo(), publicApi.getSpecialties(),
      publicApi.getArticles({ limit: 3 }), publicApi.getTestimonials(), publicApi.getDoctorCoverage(),
    ]).then((results) => {
      if (cancelled) return;
      const [stats, featured, meta, seo, specialties, articles, testimonials, coverage] = results;
      setData({
        stats: stats.status === "fulfilled" ? stats.value.data : null,
        featured: featured.status === "fulfilled" ? featured.value.data : null,
        meta: meta.status === "fulfilled" ? meta.value.data : null,
        seo: seo.status === "fulfilled" ? seo.value.data : null,
        specialties: specialties.status === "fulfilled" ? specialties.value.data?.specialties || [] : [],
        articles: articles.status === "fulfilled" ? articles.value.data?.articles || [] : [],
        testimonials: testimonials.status === "fulfilled" ? testimonials.value.data?.testimonials || [] : [],
        coverage: coverage.status === "fulfilled" ? coverage.value.data : null,
      });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const concerns = useMemo(() => matchConcerns(data.meta?.specializations || []).slice(0, 8), [data.meta]);
  const faqs = [
    ["book", t("p13.home.howBookingWorks"), t("p13.home.howBookingWorksAnswer")],
    ["verified", t("p13.home.verifiedBadge"), t("p13.home.verifiedBadgeAnswer")],
    ["availability", t("p13.home.availabilityQuestion"), t("p13.home.availabilityAnswer")],
    ["reviews", t("p13.home.reviewsQuestion"), t("p13.home.reviewsAnswer")],
    ["privacy", t("p13.home.privacyQuestion"), t("p13.home.privacyAnswer")],
  ].map(([key, q, a]) => ({ key, q, a }));

  const handleSearch = (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (search.q) params.set("name", search.q);
    if (search.city) params.set("city", search.city);
    if (search.mode) params.set("mode", search.mode);
    navigate(`/doctors?${params.toString()}`);
  };

  const stats = [
    [data.stats?.verifiedDoctors ?? "—", t("p13.home.verifiedDoctors")],
    [data.stats?.totalConsultations?.toLocaleString() ?? "—", t("p13.home.completedConsultations")],
    [data.stats?.totalSpecializations ?? "—", t("p13.home.specializations")],
    [data.stats?.totalCities ?? "—", t("p13.home.citiesCovered")],
  ];

  return (
    <PublicPageFrame>
      <SEOMeta
        title={`${t("meta.appName")} — ${t("meta.tagline")}`}
        description={t("meta.description")}
        canonical="/"
        jsonLd={[
          buildOrganizationJsonLd({ ...(data.seo?.organization || {}), url: data.seo?.origin }),
          buildWebSiteJsonLd({ url: data.seo?.origin, searchPath: "/doctors?name=" }),
        ]}
      />

      <section className="relative public-shell px-4 pb-16 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/25 bg-orange-500/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] text-orange-600"><span className="h-1.5 w-1.5 rounded-full bg-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.8)]"/>{t("p11.home.auto1")}</div>
            <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[0.98] tracking-[-0.04em] text-slate-950 sm:text-6xl lg:text-7xl">{t("p11.home.auto2")}<span className="bg-gradient-to-r from-orange-500 via-orange-500 to-red-500 bg-clip-text text-transparent">{t("p11.home.auto3")}</span></h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">{t("p11.home.auto4")}</p>

            <form onSubmit={handleSearch} className="mt-8 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div className="grid gap-2 lg:grid-cols-[1fr_0.55fr_0.45fr_auto]">
                <label className="relative"><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600"/><input value={search.q} onChange={(e) => setSearch((s) => ({ ...s, q: e.target.value }))} placeholder={t("p11.home.auto24")} className="w-full rounded-xl border border-transparent bg-white py-3.5 pl-11 pr-3 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-600 focus:border-slate-200 focus:bg-slate-50" list="home-specialties"/><datalist id="home-specialties">{(data.meta?.specializations || []).map((s) => <option key={s} value={s}/>)}</datalist></label>
                <label className="relative"><MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600"/><select value={search.city} onChange={(e) => setSearch((s) => ({ ...s, city: e.target.value }))} className="w-full appearance-none rounded-xl border border-transparent bg-white py-3.5 pl-11 pr-3 text-sm font-semibold text-slate-950 outline-none focus:border-slate-200"><option value="" className="bg-white">{t("p11.home.auto5")}</option>{(data.meta?.cities || []).map((c) => <option key={c} value={c} className="bg-white">{c}</option>)}</select></label>
                <select value={search.mode} onChange={(e) => setSearch((s) => ({ ...s, mode: e.target.value }))} className="rounded-xl border border-transparent bg-white px-3 py-3.5 text-sm font-semibold text-slate-950 outline-none focus:border-slate-200"><option value="" className="bg-white">{t("p11.home.auto6")}</option><option value="online" className="bg-white">{t("p11.home.auto7")}</option><option value="offline" className="bg-white">{t("p11.home.auto8")}</option><option value="home_visit" className="bg-white">{t("p11.home.auto9")}</option></select>
                <button className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3.5 text-sm font-black text-slate-950 shadow-lg shadow-orange-500/20 transition hover:-translate-y-0.5">{t("p11.home.auto10")}<ArrowRight size={16}/></button>
              </div>
            </form>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600"><span>{t("p11.home.auto11")}</span>{concerns.map(({ key, specialization }) => <button key={key} onClick={() => navigate(`/doctors?specialization=${encodeURIComponent(specialization)}`)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-500 transition hover:border-orange-400/20 hover:text-orange-600">{t(`home.decisionSupport.concerns.${key}`)}</button>)}</div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] bg-orange-500/10 blur-3xl" />
            <PublicCard className="relative overflow-hidden p-5 sm:p-6">
              <div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">{t("p11.home.auto12")}</p><p className="mt-2 text-xl font-black text-slate-950">{t("p11.home.auto13")}</p></div><ShieldCheck className="text-emerald-400"/></div>
              <div className="mt-6 space-y-3">
                {[[BadgeCheck, "verifiedIdentity"], [Calendar, "realScheduling"], [MessageSquare, "consultationReviews"], [ShieldCheck, "privateRecords"]].map(([Icon, key]) => <div key={key} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-orange-600"><Icon size={16}/></span><div><p className="text-xs font-black text-slate-800">{t(`p13.home.trustCards.${key}`)}</p><p className="mt-1 text-xs leading-5 text-slate-600">{t(`p13.home.trustCards.${key}Text`)}</p></div></div>)}
              </div>
              
            </PublicCard>
          </div>
        </div>

        <div className="mt-14 grid overflow-hidden rounded-2xl border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(([value, label]) => <div key={label} className="border-b border-slate-200 p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"><p className="text-2xl font-black text-slate-950">{loading ? "…" : value}</p><p className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-slate-600">{label}</p></div>)}
        </div>
      </section>

      {data.coverage && <PublicSection eyebrow={t("p12.coverage.eyebrow")} title={t("p12.coverage.homeTitle")} description={t("p12.coverage.homeDescription")}>
        <CoverageMap coverage={data.coverage} selectedState={coverageState} onSelectState={(value) => { setCoverageState(value); if (value) navigate(`/doctors?state=${encodeURIComponent(value)}`); }} />
      </PublicSection>}

      <PublicSection eyebrow={t("p11.home.auto32")} title={t("p11.home.auto25")} description={t("p11.home.auto33")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(data.specialties || []).slice(0, 8).map((specialty) => <Link key={specialty.name} to={`/doctors?specialization=${encodeURIComponent(specialty.name)}`} className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-1 hover:border-orange-400/25"><div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600"><Stethoscope size={18}/></span><ArrowUpRight size={15} className="text-slate-500 transition group-hover:text-orange-600"/></div><p className="mt-5 text-sm font-black text-slate-950">{specialty.name}</p><p className="mt-1 text-xs text-slate-600">{t("p13.home.specialtyDoctors", { count: specialty.doctorCount })}</p><div className="mt-4 flex items-center gap-1 text-xs font-bold text-slate-500"><Star size={11} className="fill-amber-400 text-amber-400"/>{t("p13.home.averageRating", { rating: specialty.avgRating || "—" })}</div></Link>)}
          {!data.specialties?.length && <div className="col-span-full rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-600">{t("p11.home.auto14")}</div>}
        </div>
      </PublicSection>


      <PublicSection eyebrow={t("p11.home.auto34")} title={t("p11.home.auto26")} className="pt-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{(data.featured?.topRated || []).slice(0, 6).map((doctor) => <DoctorCard key={doctor.id} doctor={doctor}/>)}{!data.featured?.topRated?.length && <div className="col-span-full rounded-2xl border border-dashed border-slate-200 p-12 text-center text-sm text-slate-600">{t("p11.home.auto15")}</div>}</div>
        <div className="mt-5 text-right"><Link to="/doctors" className="inline-flex items-center gap-2 text-xs font-black text-orange-600">{t("p11.home.auto16")}<ArrowRight size={14}/></Link></div>
      </PublicSection>

      <PublicSection eyebrow={t("p11.home.auto35")} title={t("p11.home.auto27")}>
        <div className="relative grid gap-3 md:grid-cols-5">
          {[['01','discover',Search],['02','verify',BadgeCheck],['03','book',Calendar],['04','consult',HeartPulse],['05','continue',CircleCheck]].map(([num,key,Icon], index) => <div key={key} className="relative rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><span className="text-xs font-black tracking-widest text-orange-600">{num}</span><Icon size={17} className="text-slate-600"/></div><p className="mt-6 text-sm font-black text-slate-950">{t(`p13.home.journey.${key}`)}</p><p className="mt-2 text-xs leading-6 text-slate-600">{t(`p13.home.journey.${key}Text`)}</p>{index < 4 && <ArrowRight size={14} className="absolute -right-2 top-1/2 z-10 hidden text-orange-500 md:block"/>}</div>)}
        </div>
      </PublicSection>

      <PublicSection eyebrow={t("p11.home.auto36")} title={t("p11.home.auto28")}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[[BadgeCheck,'verifiedIdentity'],[Calendar,'realScheduling'],[Wallet,'paymentExpectations'],[FileCheck2,'professionalDepth'],[MessageSquare,'consultationReviews'],[Sparkles,'boundedIntelligence']].map(([Icon,key]) => <PublicCard key={key} className="p-5"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600"><Icon size={18}/></span><h3 className="mt-5 text-sm font-black text-slate-950">{t(`p13.home.trustCards.${key}`)}</h3><p className="mt-2 text-xs leading-6 text-slate-600">{t(`p13.home.trustCards.${key}Text`)}</p></PublicCard>)}
        </div>
      </PublicSection>

      {(data.testimonials || []).length > 0 && <PublicSection eyebrow={t("p11.home.auto37")} title={t("p11.home.auto29")} className="pt-6"><div className="grid gap-4 lg:grid-cols-3">{data.testimonials.slice(0, 3).map((item, i) => <PublicCard key={item.id || i} className="p-5"><div className="flex justify-between"><span className="text-3xl leading-none text-orange-600">“</span><StarRating rating={item.rating || 5}/></div><p className="mt-4 text-sm leading-7 text-slate-500">{item.comment || item.message || t("p13.home.patientExperienceFallback")}</p><div className="mt-6 border-t border-slate-200 pt-4"><p className="text-xs font-black text-slate-950">{item.patientName || item.name || t("p13.home.patient")}</p><p className="mt-1 text-xs text-slate-600">{item.doctorName ? t("p13.home.consultedDoctor", { name: item.doctorName }) : t("p13.home.verifiedPatientExperience")}</p></div></PublicCard>)}</div></PublicSection>}

      <PublicSection eyebrow={t("p11.home.auto38")} title={t("p11.home.auto30")} className="pt-6"><div className="grid gap-4 lg:grid-cols-3">{data.articles.map((article) => <Link key={article.slug} to={`/articles/${article.slug}`} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="h-44 overflow-hidden bg-slate-50">{article.bannerImage ? <img src={article.bannerImage} alt="" className="h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-105"/> : <div className="flex h-full items-center justify-center text-slate-500"><FileCheck2 size={34}/></div>}</div><div className="p-5"><p className="text-sm font-black leading-6 text-slate-950">{article.title}</p><p className="mt-4 inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-orange-600">{t("p11.home.auto17")}<ArrowRight size={12}/></p></div></Link>)}</div>{!data.articles.length && <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-600">{t("p11.home.auto18")}</div>}</PublicSection>

      <PublicSection eyebrow={t("p11.home.auto39")} title={t("p11.home.auto31")}><PublicCard className="px-5 sm:px-7">{faqs.map((item) => <Faq key={item.key} item={item}/>)}</PublicCard></PublicSection>

      <section className="public-shell px-4 pb-20 sm:px-6 lg:px-8"><div className="relative overflow-hidden rounded-[1.7rem] border border-orange-400/20 bg-gradient-to-br from-orange-500/15 via-white/[0.04] to-red-500/10 p-8 sm:p-12"><div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-orange-500/15 blur-3xl"/><div className="relative max-w-3xl"><p className="text-xs font-black uppercase tracking-[0.22em] text-orange-600">{t("p11.home.auto19")}</p><h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">{t("p11.home.auto20")}</h2><p className="mt-4 text-sm leading-7 text-slate-600">{t("p11.home.auto21")}</p><div className="mt-7 flex flex-wrap gap-3"><Link to="/doctors" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-orange-500/20">{t("p11.home.auto22")}<ArrowRight size={15}/></Link><Link to="/about" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-bold text-slate-800">{t("p11.home.auto23")}<ArrowUpRight size={15}/></Link></div></div></div></section>
    </PublicPageFrame>
  );
}
