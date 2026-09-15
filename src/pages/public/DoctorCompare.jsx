import { useI18n } from "../../i18n/I18nContext";
import SEOMeta from "../../components/shared/SEOMeta";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BadgeCheck, MapPin, ShieldCheck, Star, X } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { publicApi } from "../../api/publicApi";
import PublicPageFrame, { PublicCard } from "../../components/public/PublicPageFrame";

const ROW_KEYS = [
  ["specialization", "specialization"], ["qualification", "qualification"], ["experience", "experience", (d, t) => t("p13.compare.years", { count: d.experience || 0 })],
  ["location", "practiceLocation", (d, t) => [d.city, d.district, d.state].filter(Boolean).join(" · ") || t("p13.compare.notAvailable")], ["hospitalName", "hospitalClinic"],
  ["languages", "languages", (d, t) => (d.languages || []).join(", ") || t("p13.compare.notAvailable")], ["consultationMode", "consultationModes", (d, t) => (d.consultationMode || []).map((x) => x === "home_visit" ? t("p13.home.homeVisit") : x === "online" ? t("p13.home.online") : x === "offline" ? t("p13.home.offline") : x).join(", ") || t("p13.compare.notAvailable")],
  ["fees", "consultationFee", (d) => `₹${d.fees}`], ["rating", "rating", (d, t) => t("p13.compare.ratingValue", { value: Number(d.rating || 0).toFixed(1) })], ["totalReviews", "reviews"], ["totalConsultations", "completedConsultations"],
];

export default function DoctorCompare() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ids = useMemo(() => (params.get("ids") || "").split(",").filter(Boolean).slice(0, 4), [params]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { if (ids.length >= 2) { setLoading(true); setError(""); publicApi.compareDoctors(ids).then((r) => setDoctors(r.data?.doctors || [])).catch(() => setError(t("p11.shared.compareLoadError"))).finally(() => setLoading(false)); } else setLoading(false); }, [ids, t]);
  const remove = (id) => { const next = ids.filter((x) => x !== id); navigate(next.length >= 2 ? `/doctors/compare?ids=${next.join(",")}` : "/doctors"); };

  if (ids.length < 2) return <PublicPageFrame><div className="mx-auto max-w-2xl px-4 py-28 text-center"><ShieldCheck size={40} className="mx-auto text-slate-500"/><h1 className="mt-4 text-2xl font-black text-slate-950">{t("p11.doctor_compare.auto1")}</h1><p className="mt-2 text-sm text-slate-600">{t("p11.doctor_compare.auto2")}</p><Link to="/doctors" className="mt-6 inline-flex rounded-xl bg-orange-500 px-4 py-3 text-xs font-black text-slate-950">{t("p11.doctor_compare.auto3")}</Link></div></PublicPageFrame>;
  return <PublicPageFrame><SEOMeta title={t("p11.doctor_compare.auto14")} canonical="/doctors/compare" robots="noindex,follow"/><div className="public-shell px-4 pb-20 pt-12 sm:px-6 lg:px-8"><Link to="/doctors" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-600 hover:text-slate-950"><ArrowLeft size={13}/>{t("p11.doctor_compare.auto4")}</Link><div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">{t("p11.doctor_compare.auto5")}</p><h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">{t("p11.doctor_compare.auto6")}</h1><p className="mt-2 text-xs text-slate-600">{t("p11.doctor_compare.auto7")}</p></div><div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-wider text-slate-600"><BadgeCheck size={12} className="text-sky-400"/>{t("p11.doctor_compare.auto8")}</div></div>
    {loading ? <div className="mt-6 h-96 animate-pulse rounded-2xl border border-slate-200 bg-white"/> : error ? <div role="alert" className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-semibold text-rose-700"><p>{error}</p><button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-white px-3 py-2 text-xs font-black text-slate-900 ring-1 ring-slate-200">{t("p11.doctor_compare.auto10")}</button></div> : <PublicCard className="mt-6 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left"><thead><tr className="border-b border-slate-200 bg-white"><th className="w-44 p-4 text-xs font-black uppercase tracking-wider text-slate-500">{t("p11.doctor_compare.auto11")}</th>{doctors.map((d) => <th key={d.id} className="min-w-[190px] p-4 align-top"><div className="flex items-start justify-between gap-2"><div><Link to={`/doctors/${d.id}`} className="text-sm font-black text-slate-950 hover:text-orange-600">{d.name}</Link><p className="mt-1 flex items-center gap-1 text-xs text-orange-600"><Star size={10} className="fill-amber-400 text-amber-400"/>{Number(d.rating || 0).toFixed(1)} · {d.specialization}</p></div><button onClick={() => remove(d.id)} className="text-slate-500 hover:text-rose-300"><X size={14}/></button></div></th>)}</tr></thead><tbody>{ROW_KEYS.map(([key,labelKey,render]) => <tr key={key} className="border-b border-slate-200 last:border-0"><td className="p-4 text-xs font-black uppercase tracking-wider text-slate-500">{t(`p13.compare.${labelKey}`)}</td>{doctors.map((d) => <td key={d.id} className="p-4 text-xs font-semibold text-slate-600">{render ? render(d, t) : (Array.isArray(d[key]) ? d[key].join(", ") : d[key] || t("p13.compare.notAvailable"))}</td>)}</tr>)}</tbody><tfoot><tr className="border-t border-slate-200 bg-white"><td className="p-4 text-xs font-black uppercase tracking-wider text-slate-500">{t("p11.doctor_compare.auto12")}</td>{doctors.map((d) => <td key={d.id} className="p-4"><Link to={`/doctors/${d.id}`} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-xs font-black uppercase tracking-wider text-slate-950">{t("p11.doctor_compare.auto13")}<MapPin size={11}/></Link></td>)}</tr></tfoot></table></div></PublicCard>}
  </div></PublicPageFrame>;
}
