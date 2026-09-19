import { useI18n } from "../../i18n/I18nContext";
import SEOMeta, { buildDoctorListJsonLd } from "../../components/shared/SEOMeta";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, BadgeCheck, Bookmark, BookmarkCheck, Calendar, Filter, History, MapPin, Search, ShieldCheck, SlidersHorizontal, Star, X } from "lucide-react";
import { publicApi } from "../../api/publicApi";
import { masterDataApi } from "../../api/masterDataApi";
import { useAuth } from "../../context/AuthContext";
import BookingAuthGate from "../../components/public/BookingAuthGate";
import PublicPageFrame, { PublicCard, PublicSection } from "../../components/public/PublicPageFrame";
import { getRecentlyViewed } from "../../utils/recentlyViewed";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import CoverageMap from "../../components/public/CoverageMap";

const DEFAULTS = { specialization: "", city: "", state: "", mode: "", language: "", minExp: "", maxFees: "", minRating: "", hospital: "", availableToday: "", availableTomorrow: "", weekend: "", emergency: "" };
const SORTS = [["rating", "p13.search.highestRated"], ["experience", "p13.search.mostExperienced"], ["fees_asc", "p13.search.lowestFees"], ["fees_desc", "p13.search.highestFees"], ["reviews", "p13.search.mostReviewed"], ["newest", "p13.search.recentlyVerified"]];

function DoctorCard({ doctor, selected, saved, availability, onSave, onCompare, onBook }) {
  const { t, locale } = useI18n();
  const initials = (doctor.name || t("p13.home.doctor")).split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return <PublicCard className="group p-5 transition hover:-translate-y-1 hover:border-orange-400/25"><div className="relative flex items-start gap-4"><div className="absolute right-0 top-0 flex items-center gap-1.5">{onSave && <button type="button" onClick={() => onSave(doctor.id)} title={saved ? t("p13.search.removeSaved") : t("p13.search.saveDoctor")} className={`flex h-8 w-8 items-center justify-center rounded-lg border ${saved ? "border-orange-400/30 bg-orange-500/10 text-orange-600" : "border-slate-200 bg-slate-50 text-slate-600 hover:text-orange-600"}`}>{saved ? <BookmarkCheck size={14}/> : <Bookmark size={14}/>}</button>}</div><Link to={`/doctors/${doctor.id}`} className="shrink-0">{doctor.profilePhoto ? <><img src={doctor.profilePhoto} alt={doctor.name} className="h-16 w-16 rounded-2xl object-cover" onError={(e) => { e.currentTarget.style.display = "none"; if (e.currentTarget.nextElementSibling) e.currentTarget.nextElementSibling.style.display = "flex"; }}/><span className="hidden h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/20 to-blue-500/10 text-sm font-black text-orange-600" style={{ display: "none" }}>{initials}</span></> : <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/20 to-blue-500/10 text-sm font-black text-orange-600">{initials}</span>}</Link><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><Link to={`/doctors/${doctor.id}`} className="truncate text-sm font-black text-slate-950 hover:text-orange-600">{doctor.name}</Link>{doctor.isVerified && <BadgeCheck size={14} className="shrink-0 text-sky-400"/>}</div><p className="mt-1 text-xs font-semibold text-orange-600">{doctor.specialization}</p><p className="mt-1 text-xs text-slate-600">{doctor.qualification || t("p13.home.yearsExperience", { count: doctor.experience || 0 })}</p></div></div><div className="mt-4 flex flex-wrap gap-1.5">{(doctor.consultationMode || []).map((m) => <span key={m} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-500">{m === "home_visit" ? t("p13.home.homeVisit") : m === "online" ? t("p13.home.online") : m === "offline" ? t("p13.home.offline") : m}</span>)}{doctor.city && <span className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-500"><MapPin size={9}/>{doctor.city}{doctor.district ? `, ${doctor.district}` : ""}{doctor.state ? `, ${doctor.state}` : ""}</span>}</div><div className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-200 py-3"><div><p className="text-xs uppercase tracking-wider text-slate-500">{t("p11.doctor_search.auto1")}</p><p className="mt-1 flex items-center gap-1 text-xs font-black text-slate-950"><Star size={11} className="fill-amber-400 text-amber-400"/>{Number(doctor.rating || 0).toFixed(1)}</p></div><div><p className="text-xs uppercase tracking-wider text-slate-500">{t("p11.doctor_search.auto2")}</p><p className="mt-1 text-xs font-black text-slate-950">{doctor.experience} {t("p13.search.yearsShort")}</p></div><div><p className="text-xs uppercase tracking-wider text-slate-500">{t("p11.doctor_search.auto3")}</p><p className="mt-1 text-xs font-black text-slate-950">₹{doctor.fees}</p></div></div><div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{t("p12.availability.nextTitle")}</p>{availability?.nextSlot && availability?.date ? <p className="mt-1 text-xs font-black text-slate-950">{new Date(`${availability.date}T00:00:00`).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" })} · <span className="text-emerald-700">{availability.nextSlot}</span></p> : <p className="mt-1 text-xs font-semibold text-slate-500">{t("p12.availability.none")}</p>}</div><div className="mt-4 flex items-center justify-between gap-3"><button onClick={() => onCompare(doctor.id)} className={`rounded-lg border px-2.5 py-2 text-xs font-black uppercase tracking-wider ${selected ? "border-orange-400/30 bg-orange-500/10 text-orange-600" : "border-slate-200 text-slate-600 hover:text-slate-500"}`}>{selected ? t("p12.search.addedToCompare") : t("p12.search.compare")}</button><div className="flex items-center gap-2"><Link to={`/doctors/${doctor.id}`} className="rounded-lg px-2 py-2 text-xs font-black uppercase tracking-wider text-slate-500 hover:text-slate-950">{t("p11.doctor_search.auto4")}</Link><button onClick={() => onBook(doctor)} className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-xs font-black uppercase tracking-wider text-slate-950">{t("p11.doctor_search.auto5")}<ArrowRight size={11}/></button></div></div></PublicCard>;
}

export default function DoctorSearch() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [doctors, setDoctors] = useState([]);
  const [meta, setMeta] = useState({ languages: [] });
  const [master, setMaster] = useState({ specializations: [], states: [], districts: [], cities: [] });
  const [coverage, setCoverage] = useState({ states: [], districts: [], cities: [], totalDoctors: 0 });
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metaError, setMetaError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [compare, setCompare] = useState([]);
  const [savedIds, setSavedIds] = useState([]);
  const [availability, setAvailability] = useState({});
  const [showMap, setShowMap] = useState(false);
  const requestId = useRef(0);
  const coverageRequestId = useRef(0);
  const [authGate, setAuthGate] = useState({ open: false, doctor: null });
  const [recent] = useState(() => getRecentlyViewed());
  const debounce = useRef(null);

  const filters = useMemo(() => Object.keys(DEFAULTS).reduce((acc, key) => { acc[key] = params.get(key) || ""; return acc; }, {}), [params]);
  const name = params.get("name") || "";
  const sort = params.get("sort") || "rating";
  const page = Number(params.get("page") || 1);
  const activeCount = Object.values(filters).filter(Boolean).length + (name ? 1 : 0);

  const findMasterId = useCallback((items, value) => {
    if (!value) return "";
    return items.find((item) => String(item.name || "").toLowerCase() === String(value).toLowerCase())?._id || "";
  }, []);

  const fetchDoctors = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true); setError("");
    try {
      const params = { ...filters, name: name || undefined, sort, page, limit: 12 };
      const specializationId = findMasterId(master.specializations, filters.specialization);
      const stateId = findMasterId(master.states, filters.state);
      const districtId = findMasterId(master.districts, filters.district);
      const cityId = findMasterId(master.cities, filters.city);
      if (specializationId) { params.specializationMasterId = specializationId; delete params.specialization; }
      if (stateId) { params.stateMasterId = stateId; delete params.state; }
      if (districtId) { params.districtMasterId = districtId; delete params.district; }
      if (cityId) { params.cityMasterId = cityId; delete params.city; }
      const res = await publicApi.searchDoctors(params);
      if (currentRequest !== requestId.current) return;
      setDoctors(res.data?.doctors || []);
      setPagination(res.data?.pagination || { page: 1, total: 0, pages: 1 });
    } catch {
      if (currentRequest === requestId.current) setError(t("p11.shared.doctorsLoadError"));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [filters, name, sort, page, t, master, findMasterId]);

  useEffect(() => {
    let active = true;
    Promise.all([publicApi.getSearchMeta({ masterData: "false" }), masterDataApi.getSpecializations(), masterDataApi.getStates()])
      .then(([metaResponse, specializations, states]) => {
        if (!active) return;
        setMeta({ languages: metaResponse.data?.languages || [] });
        setMaster((current) => ({ ...current, specializations, states }));
        setMetaError("");
      })
      .catch(() => { if (active) setMetaError(t("p11.shared.filtersLoadError")); });
    if (user?.role === "patient") {
      patientWorkflowApi.getSavedDoctors()
        .then((r) => { if (active) setSavedIds((r.data?.savedDoctors || []).map((item) => String(item.doctorId?._id || item.doctorId?.id || item.doctorId))); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [user?.role, t]);

  useEffect(() => {
    let active = true;
    const stateId = findMasterId(master.states, filters.state);
    if (!stateId) {
      setMaster((current) => ({ ...current, districts: [], cities: [] }));
      return undefined;
    }
    masterDataApi.getDistricts(stateId)
      .then((districts) => { if (active) setMaster((current) => ({ ...current, districts, cities: [] })); })
      .catch(() => { if (active) setMetaError(t("p11.shared.filtersLoadError")); });
    return () => { active = false; };
  }, [filters.state, master.states, findMasterId, t]);

  useEffect(() => {
    let active = true;
    const districtId = findMasterId(master.districts, filters.district);
    if (!districtId) {
      setMaster((current) => ({ ...current, cities: [] }));
      return undefined;
    }
    masterDataApi.getCities(districtId)
      .then((cities) => { if (active) setMaster((current) => ({ ...current, cities })); })
      .catch(() => { if (active) setMetaError(t("p11.shared.filtersLoadError")); });
    return () => { active = false; };
  }, [filters.district, master.districts, findMasterId, t]);

  useEffect(() => {
    const currentRequest = ++coverageRequestId.current;
    const coverageFilters = { ...filters, state: undefined, district: undefined, name: name || undefined };
    publicApi.getDoctorCoverage(coverageFilters)
      .then((r) => { if (currentRequest === coverageRequestId.current) setCoverage(r.data || {}); })
      .catch(() => {});
  }, [filters, name]);
  useEffect(() => {
    fetchDoctors().then(() => {});
  }, [fetchDoctors]);

  useEffect(() => {
    if (!doctors.length) { setAvailability({}); return undefined; }
    let active = true;
    publicApi.getDoctorAvailability(doctors.map((doctor) => doctor.id)).then((res) => {
      if (active) setAvailability(res.data || {});
    }).catch(() => { if (active) setAvailability({}); });
    return () => { active = false; };
  }, [doctors]);

  const update = (key, value) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete("page"); setParams(next); };
  const updateName = (value) => { clearTimeout(debounce.current); setSearchValue(value); debounce.current = setTimeout(() => update("name", value), 350); };
  const [searchValue, setSearchValue] = useState(name);
  useEffect(() => setSearchValue(name), [name]);
  const reset = () => setParams(new URLSearchParams());
  const toggleCompare = (id) => setCompare((current) => current.includes(id) ? current.filter((x) => x !== id) : current.length < 4 ? [...current, id] : current);
  const book = (doctor) => { if (user?.role === "patient") window.location.href = `/patient/appointments/book?doctorId=${doctor.id}`; else setAuthGate({ open: true, doctor }); };
  const toggleSave = async (doctorId) => { if (user?.role !== "patient") return; const key = String(doctorId); try { if (savedIds.includes(key)) { await patientWorkflowApi.removeSavedDoctor(doctorId); setSavedIds((ids) => ids.filter((x) => x !== key)); } else { await patientWorkflowApi.saveDoctor({ doctorId }); setSavedIds((ids) => [...ids, key]); } } catch { /* keep current UI state when the server rejects the mutation */ } };
  const selectedDistrict = filters.district;
  const stateDistricts = master.districts;
  const locationCities = master.cities;

  const updateLocation = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === "state") { next.delete("district"); next.delete("city"); }
    if (key === "district") next.delete("city");
    next.delete("page");
    setParams(next);
  };

  return <PublicPageFrame>
    <SEOMeta title={t("p11.doctor_search.auto36")} description={t("p11.doctor_search.auto38")} canonical={params.toString() ? `/doctors?${params.toString()}` : "/doctors"} robots={params.toString() ? "noindex,follow" : "index,follow"} jsonLd={!params.toString() && doctors.length ? buildDoctorListJsonLd(doctors) : undefined} />
    <section className="public-shell px-4 pb-7 pt-12 sm:px-6 lg:px-8 lg:pt-16"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-orange-600">{t("p11.doctor_search.auto7")}</p><h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-slate-950 sm:text-5xl">{t("p11.doctor_search.auto8")}<span className="text-orange-600">{t("p11.doctor_search.auto9")}</span></h1><p className="mt-3 text-sm text-slate-500">{loading ? t("p12.search.searching") : t("p12.search.resultSummary", { count: pagination.total })}</p></div><div className="flex items-center gap-2"><div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 sm:flex"><ShieldCheck size={13} className="text-emerald-400"/>{t("p11.doctor_search.auto10")}</div><button onClick={() => setFiltersOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-500 lg:hidden"><SlidersHorizontal size={14} /> {t("p14.public.filters")} {activeCount ? `(${activeCount})` : ""}</button></div></div></section>

    <section className="public-shell px-4 sm:px-6 lg:px-8"><div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <aside className={`${filtersOpen ? "block" : "hidden"} lg:block`}><PublicCard className="sticky top-24 p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Filter size={14} className="text-orange-600"/><p className="text-xs font-black text-slate-950">{t("p11.doctor_search.auto11")}</p></div><button onClick={reset} className="text-xs font-black uppercase tracking-wider text-slate-600 hover:text-orange-600">{t("p11.doctor_search.auto12")}</button></div><div className="mt-5 space-y-4">{[["specialization",t("p12.search.specialization"),master.specializations.map((item) => item.name)],["state",t("p12.search.state"),master.states.map((item) => item.name)],["district",t("p12.search.district"),stateDistricts.map((item) => item.name)],["city",t("p12.search.city"),locationCities.map((item) => item.name)],["language",t("p12.search.language"),meta.languages]].map(([key,label,options]) => <label key={key} className="block"><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{label}</span><select value={filters[key]} disabled={(key === "district" && !filters.state) || (key === "city" && !filters.district)} onChange={(e) => key === "state" || key === "district" ? updateLocation(key, e.target.value) : update(key, e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-950 outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"><option value="" className="bg-white">{t("p12.search.all")} {label.toLowerCase()}s</option>{(options || []).map((x) => <option key={x} value={x} className="bg-white">{x}</option>)}</select></label>)}<label className="block"><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{t("p11.doctor_search.auto13")}</span><select value={filters.mode} onChange={(e) => update("mode", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-950 outline-none"><option value="" className="bg-white">{t("p11.doctor_search.auto14")}</option><option value="online" className="bg-white">{t("p11.doctor_search.auto15")}</option><option value="offline" className="bg-white">{t("p11.doctor_search.auto16")}</option><option value="home_visit" className="bg-white">{t("p11.doctor_search.auto17")}</option></select></label><label className="block"><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{t("p11.doctor_search.auto18")}</span><select value={filters.minExp} onChange={(e) => update("minExp", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-950 outline-none"><option value="" className="bg-white">{t("p11.doctor_search.auto19")}</option>{[5,10,15,20].map((x) => <option key={x} value={x} className="bg-white">{x}+ {t("p12.search.years")}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{t("p11.doctor_search.auto20")}</span><select value={filters.maxFees} onChange={(e) => update("maxFees", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-950 outline-none"><option value="" className="bg-white">{t("p11.doctor_search.auto21")}</option>{[500,1000,1500,2500,5000].map((x) => <option key={x} value={x} className="bg-white">{t("p12.search.upTo")} ₹{x}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{t("p11.doctor_search.auto22")}</span><div className="grid grid-cols-4 gap-1">{[3,3.5,4,4.5].map((x) => <button type="button" key={x} onClick={() => update("minRating", filters.minRating === String(x) ? "" : String(x))} className={`rounded-lg py-2 text-xs font-black ${filters.minRating === String(x) ? "bg-amber-500 text-slate-950" : "bg-slate-50 text-slate-600"}`}>{x}+</button>)}</div></label><div className="space-y-2 border-t border-slate-200 pt-4">{[["availableToday",t("p12.search.availableToday")],["availableTomorrow",t("p12.search.availableTomorrow")],["weekend",t("p12.search.weekend")],["emergency",t("p12.search.emergency")]].map(([key,label]) => <label key={key} className="flex items-center gap-2 text-xs font-semibold text-slate-500"><input type="checkbox" checked={filters[key] === "true"} onChange={() => update(key, filters[key] === "true" ? "" : "true")} className="accent-orange-500"/>{label}</label>)}</div></div></PublicCard></aside>

      <div className="min-w-0">{metaError && <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">{metaError}</div>}<div className="flex flex-col gap-2 sm:flex-row"><label className="relative flex-1"><Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600"/><input value={searchValue} onChange={(e) => updateName(e.target.value)} placeholder={t("p11.doctor_search.auto37")} className="w-full rounded-xl border border-slate-200 bg-white py-3.5 pl-10 pr-10 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-500 focus:border-orange-400/30"/>{searchValue && <button onClick={() => updateName("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600"><X size={14}/></button>}</label><select value={sort} onChange={(e) => update("sort", e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-3.5 text-xs font-bold text-slate-500 outline-none sm:w-48">{SORTS.map(([value,labelKey]) => <option key={value} value={value} className="bg-white">{t(labelKey)}</option>)}</select></div>
        {recent.length > 0 && <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1"><History size={13} className="shrink-0 text-slate-500"/>{recent.slice(0, 4).map((d) => <Link key={d.id} to={`/doctors/${d.id}`} className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:text-orange-600">{d.name}</Link>)}</div>}
        {error && <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-xs font-semibold text-rose-700">{error}</div>}
        <div className="mt-5 grid gap-4 xl:grid-cols-2">{loading ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white"/>) : doctors.map((doctor) => <DoctorCard key={doctor.id} doctor={doctor} selected={compare.includes(doctor.id)} saved={savedIds.includes(String(doctor.id))} availability={availability[String(doctor.id)]} onSave={user?.role === "patient" ? toggleSave : null} onCompare={toggleCompare} onBook={book}/>)}{!loading && !doctors.length && <div className="col-span-full rounded-2xl border border-dashed border-slate-200 p-14 text-center"><Search size={28} className="mx-auto text-slate-500"/><p className="mt-3 text-sm font-black text-slate-500">{t("p11.doctor_search.auto23")}</p><p className="mt-1 text-xs text-slate-600">{t("p11.doctor_search.auto24")}</p><button onClick={reset} className="mt-5 rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-950">{t("p11.doctor_search.auto25")}</button></div>}</div>
        {pagination.pages > 1 && <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold text-slate-600">{t("p13.search.pageOf", { page: pagination.page, pages: pagination.pages })}</p><div className="flex gap-2"><button disabled={page <= 1} onClick={() => update("page", String(page - 1))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-500 disabled:opacity-30">{t("p11.doctor_search.auto26")}</button><button disabled={page >= pagination.pages} onClick={() => update("page", String(page + 1))} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-30">{t("p11.doctor_search.auto27")}</button></div></div>}
      </div>
    </div></section>

    <section className="public-shell px-4 pt-8 sm:px-6 lg:px-8"><button type="button" onClick={() => setShowMap((value) => !value)} aria-expanded={showMap} aria-controls="doctor-discovery-map" className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 lg:hidden">{showMap ? t("p12.coverage.hideMap") : t("p12.coverage.showMap")}</button><div id="doctor-discovery-map" className={showMap ? "block" : "hidden lg:block"}><CoverageMap coverage={coverage} selectedState={filters.state} selectedDistrict={selectedDistrict} onSelectState={(value) => updateLocation("state", value)} onSelectDistrict={(value) => updateLocation("district", value)} /></div></section>

    {compare.length >= 2 && <div className="fixed inset-x-0 bottom-4 z-40 px-4"><div className="mx-auto flex max-w-3xl items-center justify-between gap-4 rounded-2xl border border-orange-400/25 bg-white px-4 py-3 shadow-2xl backdrop-blur-xl"><div><p className="text-xs font-black text-slate-950">{t("p12.search.compareReady", { count: compare.length })}</p><p className="mt-1 text-xs text-slate-600">{t("p11.doctor_search.auto28")}</p></div><Link to={`/doctors/compare?ids=${compare.join(",")}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-black text-slate-950">{t("p11.doctor_search.auto29")}<ArrowRight size={13}/></Link></div></div>}
    <BookingAuthGate isOpen={authGate.open} onClose={() => setAuthGate({ open: false, doctor: null })} doctorId={authGate.doctor?.id} doctorName={authGate.doctor?.name} specialization={authGate.doctor?.specialization}/>
    <PublicSection className="pt-10"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-4"><ShieldCheck size={16} className="text-emerald-400"/><p className="mt-3 text-xs font-black text-slate-950">{t("p11.doctor_search.auto30")}</p><p className="mt-1 text-xs leading-5 text-slate-600">{t("p11.doctor_search.auto31")}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><Calendar size={16} className="text-orange-600"/><p className="mt-3 text-xs font-black text-slate-950">{t("p11.doctor_search.auto32")}</p><p className="mt-1 text-xs leading-5 text-slate-600">{t("p11.doctor_search.auto33")}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><MapPin size={16} className="text-sky-700"/><p className="mt-3 text-xs font-black text-slate-950">{t("p11.doctor_search.auto34")}</p><p className="mt-1 text-xs leading-5 text-slate-600">{t("p11.doctor_search.auto35")}</p></div></div></PublicSection>
  </PublicPageFrame>;
}
