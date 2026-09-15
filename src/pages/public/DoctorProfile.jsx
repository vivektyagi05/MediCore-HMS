import { useI18n } from "../../i18n/I18nContext";
import SEOMeta, { buildBreadcrumbJsonLd, buildDoctorJsonLd } from "../../components/shared/SEOMeta";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Award, BadgeCheck, BookOpen, Building2, Calendar, CheckCircle2, Clock3, FileText, HeartPulse, Languages, MapPin, MessageSquare, RefreshCw, ShieldCheck, Star, Users, Wallet } from "lucide-react";
import { publicApi } from "../../api/publicApi";
import { useAuth } from "../../context/AuthContext";
import BookingAuthGate from "../../components/public/BookingAuthGate";
import PublicPageFrame, { PublicCard, PublicSection } from "../../components/public/PublicPageFrame";
import { recordDoctorView } from "../../utils/recentlyViewed";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MODE_LABEL = { online: "p13.profile.online", offline: "p13.profile.offline", home_visit: "p13.profile.homeVisit" };
const stars = [1, 2, 3, 4, 5];

function Rating({ value = 0, size = 14 }) {
  return <span className="flex items-center gap-0.5">{stars.map((n) => <Star key={n} size={size} className={n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-slate-500"}/>)} </span>; }
function Section({ icon: Icon, title, children }) {
  return <PublicCard className="p-5 sm:p-6"><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-orange-600"><Icon size={16}/></span><h2 className="text-sm font-black text-slate-950">{title}</h2></div><div className="mt-5">{children}</div></PublicCard>; }

export default function DoctorProfile() {
  const { t, locale } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [doctor, setDoctor] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [hospital, setHospital] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewPagination, setReviewPagination] = useState({ pages: 1, total: 0 });
  const [state, setState] = useState("loading");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [bookOpen, setBookOpen] = useState(false);
  const [nextAvailability, setNextAvailability] = useState(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const profile = await publicApi.getDoctorProfile(id);
      const d = profile.data?.doctor;
      if (!d) throw new Error(t("p13.profile.doctorUnavailable"));
      setDoctor(d); setReviews(d.recentReviews || []); setReviewPagination({ pages: Math.max(1, Math.ceil((d.totalReviews || 0) / 5)), total: d.totalReviews || 0 }); recordDoctorView(d);
      const [similarRes, hospitalRes] = await Promise.allSettled([publicApi.getSimilarDoctors(id), publicApi.getHospitalInfo()]);
      if (similarRes.status === "fulfilled") setSimilar(similarRes.value.data?.doctors || []);
      if (hospitalRes.status === "fulfilled") setHospital(hospitalRes.value.data);
      setAvailabilityLoading(true);
      publicApi.getNextAvailability(id).then((res) => setNextAvailability(res.data || null)).catch(() => setNextAvailability(null)).finally(() => setAvailabilityLoading(false));
      setState("ready");
    } catch { setState("error"); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const loadReviews = async (page) => {
    setReviewLoading(true);
    setReviewError("");
    try { const res = await publicApi.getDoctorReviews(id, { page, limit: 5 }); setReviews(res.data?.reviews || []); setReviewPagination(res.data?.pagination || { pages: 1, total: 0 }); setReviewPage(page); } catch { setReviewError(t("p11.shared.reviewsLoadError")); } finally { setReviewLoading(false); }
  };

  const weekly = useMemo(() => DAYS.map((day) => ({ day, slots: (doctor?.availability || []).filter((slot) => slot.dayOfWeek === day) })), [doctor]);
  if (state === "loading") return <PublicPageFrame><div className="public-shell px-4 py-16 sm:px-6"><div className="h-24 animate-pulse rounded-2xl bg-slate-50"/><div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]"><div className="space-y-4"><div className="h-64 animate-pulse rounded-2xl bg-slate-50"/><div className="h-80 animate-pulse rounded-2xl bg-slate-50"/></div><div className="h-96 animate-pulse rounded-2xl bg-slate-50"/></div></div></PublicPageFrame>;
  if (state === "error" || !doctor) return <PublicPageFrame><div className="mx-auto max-w-2xl px-4 py-28 text-center"><ShieldCheck size={40} className="mx-auto text-slate-500"/><h1 className="mt-4 text-2xl font-black text-slate-950">{t("p11.doctor_profile.auto1")}</h1><p className="mt-2 text-sm text-slate-600">{t("p11.doctor_profile.auto2")}</p><div className="mt-6 flex justify-center gap-2"><button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-xs font-black text-slate-500"><RefreshCw size={13}/>{t("p11.doctor_profile.auto3")}</button><Link to="/doctors" className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-xs font-black text-slate-950">{t("p11.doctor_profile.auto4")}<ArrowRight size={13}/></Link></div></div></PublicPageFrame>;

  const initials = doctor.name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase();
  const canBook = user?.role === "patient";
  const ratingDist = doctor.ratingDistribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  return <PublicPageFrame>
    <SEOMeta
      title={`${doctor.name}${doctor.specialization ? ` — ${doctor.specialization}` : ""}`}
      description={doctor.bio || [doctor.specialization, doctor.city, doctor.state].filter(Boolean).join(" · ")}
      canonical={`/doctors/${id}`}
      image={doctor.profilePhoto || undefined}
      imageAlt={doctor.name}
      locale={locale}
      jsonLd={[
        buildDoctorJsonLd(doctor),
        buildBreadcrumbJsonLd([
          { name: t("nav.home"), url: "/" },
          { name: t("nav.findDoctors"), url: "/doctors" },
          { name: doctor.name, url: `/doctors/${id}` },
        ]),
      ]}
    />
    <section className="public-shell px-4 pb-8 pt-10 sm:px-6 lg:px-8"><button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-600 hover:text-slate-950"><ArrowLeft size={13}/>{t("p11.doctor_profile.auto5")}</button></section>

    <section className="public-shell px-4 sm:px-6 lg:px-8"><div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <PublicCard className="overflow-hidden"><div className="relative border-b border-slate-200 p-5 sm:p-7"><div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-orange-500/10 blur-3xl"/><div className="relative flex flex-col gap-5 sm:flex-row"><div className="relative shrink-0">{doctor.profilePhoto ? <img src={doctor.profilePhoto} alt={doctor.name} className="h-28 w-28 rounded-2xl object-cover ring-1 ring-slate-200"/> : <span className="flex h-28 w-28 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/20 to-blue-500/10 text-3xl font-black text-orange-600">{initials}</span>}{doctor.isVerified && <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-sky-500 ring-4 ring-white"><BadgeCheck size={14} className="text-slate-950"/></span>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg border border-sky-400/20 bg-sky-400/10 px-2 py-1 text-xs font-black uppercase tracking-wider text-sky-700">{t("p11.doctor_profile.auto6")}</span>{doctor.emergencyAvailability && <span className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-2 py-1 text-xs font-black uppercase tracking-wider text-rose-700">{t("p11.doctor_profile.auto7")}</span>}</div><h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{doctor.name}</h1><p className="mt-2 text-sm font-bold text-orange-600">{doctor.specialization}</p><p className="mt-1 text-xs text-slate-500">{doctor.qualification}{doctor.experience != null ? ` · ${t("p13.home.yearsExperience", { count: doctor.experience })}` : ""}</p><div className="mt-4 flex flex-wrap gap-2">{doctor.city && <span className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-500"><MapPin size={10}/>{doctor.city}{doctor.district ? ` · ${doctor.district}` : ""}{doctor.state ? ` · ${doctor.state}` : ""}</span>}{doctor.location?.coordinates?.length === 2 && <a href={`https://www.openstreetmap.org/?mlat=${doctor.location.coordinates[1]}&mlon=${doctor.location.coordinates[0]}#map=16/${doctor.location.coordinates[1]}/${doctor.location.coordinates[0]}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-bold text-sky-700">{t("p12.coverage.viewLocation")}</a>}{doctor.hospitalName && <span className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-500"><Building2 size={10}/>{doctor.hospitalName}</span>}</div></div></div><div className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">{[[doctor.rating || 0,"rating",Star],[doctor.totalReviews || 0,"reviews",MessageSquare],[doctor.totalConsultations || 0,"consultations",Users],[doctor.experience || 0,"years",Clock3]].map(([v,l,Icon]) => <div key={l} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between"><p className="text-lg font-black text-slate-950">{typeof v === "number" && l === "rating" ? v.toFixed(1) : v}</p><Icon size={13} className="text-slate-500"/></div><p className="mt-1 text-xs font-black uppercase tracking-wider text-slate-600">{t(`p13.profile.${l}`)}</p></div>)}</div></div>

        {doctor.bio && <Section icon={HeartPulse} title={t("p11.doctor_profile.auto28")}><p className="text-sm leading-7 text-slate-600">{doctor.bio}</p>{doctor.subSpecialties?.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{doctor.subSpecialties.map((x) => <span key={x} className="rounded-lg border border-orange-400/15 bg-orange-500/5 px-2.5 py-1.5 text-xs font-bold text-orange-600">{x}</span>)}</div>}</Section>}

        {(doctor.education?.length || doctor.experienceEntries?.length || doctor.awards?.length || doctor.researchPublications?.length || doctor.memberships?.length) ? <Section icon={BookOpen} title={t("p11.doctor_profile.auto29")}><div className="grid gap-5 md:grid-cols-2">{doctor.education?.length > 0 && <div><p className="text-xs font-black uppercase tracking-widest text-slate-600">{t("p11.doctor_profile.auto8")}</p><div className="mt-3 space-y-3">{doctor.education.map((x, i) => <div key={i} className="border-l border-orange-500/30 pl-3"><p className="text-xs font-black text-slate-800">{x.degree}</p><p className="mt-1 text-xs text-slate-600">{x.institution}{x.year ? ` · ${x.year}` : ""}</p></div>)}</div></div>}{doctor.experienceEntries?.length > 0 && <div><p className="text-xs font-black uppercase tracking-widest text-slate-600">{t("p11.doctor_profile.auto9")}</p><div className="mt-3 space-y-3">{doctor.experienceEntries.map((x, i) => <div key={i} className="border-l border-sky-500/30 pl-3"><p className="text-xs font-black text-slate-800">{x.title}</p><p className="mt-1 text-xs text-slate-600">{x.organization}{x.startYear ? ` · ${x.startYear}–${x.endYear || t("p13.profile.present")}` : ""}</p>{x.description && <p className="mt-1 text-xs leading-5 text-slate-500">{x.description}</p>}</div>)}</div></div>}{doctor.awards?.length > 0 && <div><p className="text-xs font-black uppercase tracking-widest text-slate-600">{t("p11.doctor_profile.auto10")}</p><div className="mt-3 space-y-2">{doctor.awards.map((x, i) => <div key={i} className="flex gap-2 text-xs text-slate-600"><Award size={13} className="mt-0.5 text-amber-400"/>{x.title}{x.year ? ` · ${x.year}` : ""}</div>)}</div></div>}{doctor.researchPublications?.length > 0 && <div><p className="text-xs font-black uppercase tracking-widest text-slate-600">{t("p11.doctor_profile.auto11")}</p><div className="mt-3 space-y-2">{doctor.researchPublications.map((x, i) => <div key={i} className="flex gap-2 text-xs text-slate-600"><FileText size={13} className="mt-0.5 text-violet-600"/><span>{x.title}{x.year ? ` · ${x.year}` : ""}</span></div>)}</div></div>}</div></Section> : null}

        {(doctor.clinics?.length || doctor.hospitalName) ? <Section icon={Building2} title={t("p11.doctor_profile.auto30")}><div className="space-y-3">{doctor.hospitalName && <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-black text-slate-950">{doctor.hospitalName}</p><p className="mt-1 text-xs text-slate-600">{t("p13.profile.primaryPractice")} · {[doctor.city, doctor.district, doctor.state].filter(Boolean).join(", ") || t("p13.profile.locationNotSpecified")}</p></div>}{(doctor.clinics || []).map((clinic, i) => <div key={i} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-black text-slate-950">{clinic.name}</p><p className="mt-1 text-xs leading-5 text-slate-600">{[clinic.address, clinic.city, clinic.district, clinic.state].filter(Boolean).join(", ")}</p></div>)}</div></Section> : null}

        {doctor.languages?.length > 0 && <Section icon={Languages} title={t("p13.profile.languages")}><div className="flex flex-wrap gap-2">{doctor.languages.map((language) => <span key={language} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">{language}</span>)}</div></Section>}
        {doctor.insuranceAccepted?.length > 0 && <Section icon={ShieldCheck} title={t("p13.profile.insurance")}><div className="flex flex-wrap gap-2">{doctor.insuranceAccepted.map((provider) => <span key={provider} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">{provider}</span>)}</div></Section>}
        {doctor.memberships?.length > 0 && <Section icon={BadgeCheck} title={t("p11.doctor_profile.auto29")}><div className="grid gap-3 sm:grid-cols-2">{doctor.memberships.map((item, i) => <div key={i} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-black text-slate-900">{item.name}</p>{item.since && <p className="mt-1 text-xs text-slate-500">{t("p18.since")} {item.since}</p>}</div>)}</div></Section>}

        <Section icon={Calendar} title={t("p11.doctor_profile.auto31")}><div className="grid gap-2 sm:grid-cols-2">{weekly.map(({ day, slots }) => <div key={day} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{t(`p13.profile.days.${day}`)}</p>{slots.length ? slots.map((slot, i) => <div key={i} className="mt-2 rounded-lg bg-emerald-500/5 px-2.5 py-2 text-xs font-semibold text-emerald-700">{slot.startTime && slot.endTime ? `${slot.startTime} – ${slot.endTime}` : (slot.timeSlots || []).join(" · ")}{slot.slotDurationMinutes ? ` · ${slot.slotDurationMinutes} ${t("p13.profile.minutes")}` : ""}</div>) : <p className="mt-2 text-xs text-slate-500">{t("p11.doctor_profile.auto12")}</p>}</div>)}</div><p className="mt-4 text-xs text-slate-500">{t("p11.doctor_profile.auto13")}</p></Section>

        <Section icon={MessageSquare} title={t("p13.profile.patientReviews", { count: doctor.totalReviews || 0 })}><div className="grid gap-5 md:grid-cols-[220px_1fr]"><div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><p className="text-3xl font-black text-slate-950">{Number(doctor.rating || 0).toFixed(1)}</p><Rating value={doctor.rating} size={13}/></div><p className="mt-1 text-xs text-slate-600">{t("p13.profile.basedOnReviews", { count: doctor.totalReviews || 0 })}</p><div className="mt-5 space-y-2">{[5,4,3,2,1].map((r) => <div key={r} className="flex items-center gap-2"><span className="w-4 text-xs text-slate-600">{r}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-50"><div className="h-full rounded-full bg-amber-400" style={{ width: `${doctor.totalReviews ? Math.round((ratingDist[r] || 0) / doctor.totalReviews * 100) : 0}%` }}/></div><span className="w-5 text-right text-xs text-slate-500">{ratingDist[r] || 0}</span></div>)}</div></div><div className="space-y-3">{reviews.map((review) => <div key={review.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-slate-800">{review.patientName}</p><p className="mt-1 text-xs text-slate-500">{review.createdAt ? new Date(review.createdAt).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}</p></div><Rating value={review.rating} size={11}/></div>{review.comment && <p className="mt-3 text-xs leading-6 text-slate-500">{review.comment}</p>}{review.doctorReply && <div className="mt-3 rounded-lg border border-sky-400/10 bg-sky-400/5 p-3"><p className="text-xs font-black uppercase tracking-wider text-sky-700">{t("p11.doctor_profile.auto14")}</p><p className="mt-1 text-xs leading-5 text-slate-500">{review.doctorReply.message}</p></div>}</div>)}{reviewError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{reviewError}<button type="button" onClick={() => loadReviews(reviewPage)} className="ml-3 rounded-lg bg-white px-3 py-1.5 text-xs font-black text-slate-900 ring-1 ring-slate-200">{t("p11.doctor_profile.auto15")}</button></div>}{!reviewError && !reviews.length && <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-600">{t("p11.doctor_profile.auto16")}</div>}{reviewPagination.pages > 1 && <div className="flex justify-center gap-2"><button disabled={reviewPage <= 1 || reviewLoading} onClick={() => loadReviews(reviewPage - 1)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-500 disabled:opacity-30">{t("p11.doctor_profile.auto17")}</button><button disabled={reviewPage >= reviewPagination.pages || reviewLoading} onClick={() => loadReviews(reviewPage + 1)} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-30">{reviewLoading ? t("p13.profile.loading") : t("p13.profile.next")}</button></div>}</div></div></Section>
      </PublicCard></div>

      <aside className="space-y-4"><PublicCard className="sticky top-24 p-5"><div className="text-center"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">{t("p11.doctor_profile.auto18")}</p><p className="mt-1 text-4xl font-black text-slate-950">₹{doctor.fees}</p><p className="mt-1 text-xs text-slate-600">{t("p11.doctor_profile.auto19")}</p></div><div className="mt-5 space-y-2">{(doctor.consultationMode || []).map((m) => <div key={m} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5"><span className="h-2 w-2 rounded-full bg-emerald-400"/><span className="text-xs font-bold text-slate-600">{t(MODE_LABEL[m] || m)}</span></div>)}</div>
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-600">{t("p12.availability.nextTitle")}</p>
          {availabilityLoading ? <div className="mt-3 h-8 animate-pulse rounded-lg bg-white"/> : nextAvailability?.nextSlot && nextAvailability?.date ? <><p className="mt-2 text-sm font-black text-slate-950">{new Date(`${nextAvailability.date}T00:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" })}</p><p className="mt-1 text-sm font-bold text-emerald-700">{nextAvailability.nextSlot}</p></> : <p className="mt-2 text-sm leading-6 text-slate-500">{t("p12.availability.none")}</p>}
        </div>
        {canBook ? <><Link to={`/patient/appointments/book?doctorId=${doctor.id}`} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-4 py-3.5 text-sm font-black text-slate-950 shadow-lg shadow-orange-500/20"><Calendar size={15}/>{t("p11.doctor_profile.auto20")}</Link><div className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/5 p-3 text-center text-xs font-bold text-amber-700">{t("p11.doctor_profile.auto22")}</div></> : <button onClick={() => setBookOpen(true)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-4 py-3.5 text-sm font-black text-slate-950 shadow-lg shadow-orange-500/20"><Calendar size={15}/>{t("p11.doctor_profile.auto23")}</button>}<div className="mt-5 grid grid-cols-2 gap-2 border-t border-slate-200 pt-4">{[[doctor.languages?.length || 0,"languages",Languages],[doctor.insuranceAccepted?.length || 0,"insurance",ShieldCheck],[doctor.emergencyAvailability ? t("p13.profile.yes") : t("p13.profile.no"),"emergency",HeartPulse],[doctor.medicalCouncil || "—","medicalCouncil",BadgeCheck]].map(([v,l,Icon]) => <div key={l} className="rounded-xl bg-white p-3"><Icon size={12} className="text-slate-500"/><p className="mt-2 truncate text-xs font-black text-slate-950">{v}</p><p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-500">{t(`p13.profile.${l}`)}</p></div>)}</div></PublicCard>

        <PublicCard className="p-5"><div className="flex gap-3"><ShieldCheck size={16} className="shrink-0 text-emerald-400"/><div><p className="text-xs font-black text-slate-950">{t("p11.doctor_profile.auto24")}</p><p className="mt-1 text-xs leading-5 text-slate-600">{t("p11.doctor_profile.auto25")}</p></div></div>{doctor.verificationHistory?.length > 0 && <div className="mt-5 border-l border-slate-200 pl-4">{doctor.verificationHistory.slice(-4).reverse().map((item, i) => <div key={i} className="relative mb-4 last:mb-0"><span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-emerald-400"/><p className="text-xs font-black uppercase tracking-wider text-slate-500">{item.status}</p><p className="mt-1 text-xs text-slate-500">{item.changedAt ? new Date(item.changedAt).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN") : ""}</p></div>)}</div>}</PublicCard>

        {hospital && <PublicCard className="p-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">{t("p11.doctor_profile.auto26")}</p><div className="mt-4 space-y-3 text-xs leading-5 text-slate-500"><p><Calendar size={12} className="mr-2 inline text-orange-600"/>{t("p13.profile.bookingWindow", { days: hospital.bookingWindowDays })}</p><p><Wallet size={12} className="mr-2 inline text-emerald-700"/>{t("p13.profile.currencyTax", { currency: hospital.currency, taxRate: hospital.taxRate })}</p>{hospital.refundsEnabled && <p><CheckCircle2 size={12} className="mr-2 inline text-sky-700"/>{t("p11.doctor_profile.auto27")}</p>}</div></PublicCard>}
      </aside>
    </div></section>

    {similar.length > 0 && <PublicSection eyebrow={t("p11.doctor_profile.auto33")} title={t("p11.doctor_profile.auto32")} className="pt-10"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{similar.map((d) => <Link key={d.id} to={`/doctors/${d.id}`} className="rounded-xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-orange-400/20"><p className="text-xs font-black text-slate-950">{d.name}</p><p className="mt-1 text-xs text-slate-600">{d.specialization} · {d.experience} yrs</p><div className="mt-3 flex items-center justify-between"><span className="flex items-center gap-1 text-xs font-bold text-slate-600"><Star size={10} className="fill-amber-400 text-amber-400"/>{Number(d.rating || 0).toFixed(1)}</span><span className="text-xs font-black text-slate-950">₹{d.fees}</span></div></Link>)}</div></PublicSection>}
    <BookingAuthGate isOpen={bookOpen} onClose={() => setBookOpen(false)} doctorId={doctor.id} doctorName={doctor.name} specialization={doctor.specialization}/>
  </PublicPageFrame>;
}
