import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import {
  Search, SlidersHorizontal, X, ChevronDown, Stethoscope, RefreshCw,
  Scale, History, HelpCircle, Bookmark, TrendingUp,
} from "lucide-react";

import { publicApi } from "../../api/publicApi";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";
import { matchConcerns } from "../../utils/concernMap";
import { getRecentlyViewed } from "../../utils/recentlyViewed";
import {
  DoctorCard, FilterPanel, SkeletonCard,
  SORT_OPTIONS, DEFAULT_FILTERS,
} from "../../components/doctors/DoctorDiscoveryUI";

const MAX_COMPARE = 4;

export default function PatientDoctorsDirectory() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [doctors, setDoctors] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [meta, setMeta] = useState({ specializations: [], cities: [], states: [], languages: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [nameSearch, setNameSearch] = useState(searchParams.get("name") || "");
  const nameDebounce = useRef(null);
  const [compareIds, setCompareIds] = useState([]);
  const [recentlyViewed] = useState(() => getRecentlyViewed());

  const [savedDoctors, setSavedDoctors] = useState([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [recommended, setRecommended] = useState([]);

  const savedIds = useMemo(
    () => new Set(savedDoctors.map((item) => String(item?.doctorId?._id || item?.doctorId))),
    [savedDoctors],
  );

  const filtersFromParams = () => ({
    specialization: searchParams.get("specialization") || "",
    city: searchParams.get("city") || "",
    state: searchParams.get("state") || "",
    mode: searchParams.get("mode") || "",
    language: searchParams.get("language") || "",
    minExp: searchParams.get("minExp") || "",
    maxFees: searchParams.get("maxFees") || "",
    minRating: searchParams.get("minRating") || "",
    hospital: searchParams.get("hospital") || "",
    availableToday: searchParams.get("availableToday") || "",
    availableTomorrow: searchParams.get("availableTomorrow") || "",
    weekend: searchParams.get("weekend") || "",
    emergency: searchParams.get("emergency") || "",
  });

  const [filters, setFilters] = useState(filtersFromParams);
  const sort = searchParams.get("sort") || "rating";
  const page = Number(searchParams.get("page") || 1);
  const hasActiveFilters = Object.values(filters).some(Boolean);

  const decisionSupportConcerns = useMemo(
    () => matchConcerns(meta.specializations || []),
    [meta.specializations],
  );

  const fetchMeta = useCallback(async () => {
    try {
      const res = await publicApi.getSearchMeta();
      setMeta(res.data);
    } catch (err) {
      console.error("Failed to load doctor search meta", err);
    }
  }, []);

  const fetchSavedDoctors = useCallback(async () => {
    try {
      const res = await patientWorkflowApi.getSavedDoctors();
      setSavedDoctors(res?.data?.savedDoctors || []);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  }, [toast]);

  const fetchDoctors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { sort, page, limit: 12, ...filters };
      if (nameSearch) params.name = nameSearch;
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      const res = await publicApi.searchDoctors(params);
      setDoctors(res.data.doctors);
      setPagination(res.data.pagination);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load doctors. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [sort, page, filters, nameSearch]);

  // Popular/trending doctors — reuses the exact same authoritative sort the
  // public search page offers (bookings), just fetched once for a "Popular
  // near you" rail. No separate recommendation model, no fabricated scoring.
  const fetchRecommended = useCallback(async () => {
    try {
      const res = await publicApi.searchDoctors({ sort: "bookings", limit: 6 });
      setRecommended(res.data.doctors || []);
    } catch {
      // Non-critical rail — silently omit rather than surface a second error banner.
    }
  }, []);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);
  useEffect(() => { fetchSavedDoctors(); }, [fetchSavedDoctors]);
  useEffect(() => { fetchDoctors(); }, [fetchDoctors]);
  useEffect(() => { fetchRecommended(); }, [fetchRecommended]);

  const updateParam = (key, val) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val); else next.delete(key);
    next.delete("page");
    setSearchParams(next);
  };

  const handleFilterChange = (key, val) => {
    const next = { ...filters, [key]: val };
    setFilters(next);
    const sp = new URLSearchParams(searchParams);
    if (val) sp.set(key, val); else sp.delete(key);
    sp.delete("page");
    setSearchParams(sp);
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setNameSearch("");
    setSavedOnly(false);
    setSearchParams(new URLSearchParams());
  };

  const handleNameChange = (v) => {
    setNameSearch(v);
    clearTimeout(nameDebounce.current);
    nameDebounce.current = setTimeout(() => {
      const sp = new URLSearchParams(searchParams);
      if (v) sp.set("name", v); else sp.delete("name");
      sp.delete("page");
      setSearchParams(sp);
    }, 400);
  };

  const toggleCompare = (id) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  };

  const toggleSave = async (doctorId) => {
    try {
      if (savedIds.has(String(doctorId))) {
        await patientWorkflowApi.removeSavedDoctor(doctorId);
        toast.success(t("ui.doctorRemoved"));
      } else {
        await patientWorkflowApi.saveDoctor({ doctorId });
        toast.success(t("ui.doctorSaved"));
      }
      fetchSavedDoctors();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  // Book directly — the patient is already authenticated, so this always
  // continues straight into the existing multi-step booking wizard rather
  // than showing an auth gate (that's the public-page-only concern).
  const handleBook = (doctor) => {
    navigate(`/patient/appointments/book?doctorId=${doctor.id}`);
  };

  const visibleDoctors = savedOnly
    ? doctors.filter((d) => savedIds.has(String(d.id)))
    : doctors;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl">

        <div className="mb-6">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Doctor Discovery</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
            {t("doctorSearch.heading")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {loading ? t("doctorSearch.subtitle_loading") : t("doctorSearch.subtitle", { count: pagination.total })}
          </p>
        </div>

        {/* Recently viewed */}
        {recentlyViewed.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-slate-400">
              <History size={13} /> {t("doctorSearch.recentlyViewed")}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recentlyViewed.map((d) => (
                <Link key={d.id} to={`/doctors/${d.id}`}
                  className="flex flex-shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-300 hover:text-blue-700">
                  {d.name} <span className="text-slate-400">· {d.specialization}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Popular / trending — AI-lite "recommended for you" rail */}
        {recommended.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-emerald-600">
              <TrendingUp size={13} /> Popular with patients like you
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recommended.slice(0, 6).map((d) => (
                <Link key={d.id} to={`/doctors/${d.id}`}
                  className="flex flex-shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700">
                  {d.name} <span className="text-slate-400">· {d.specialization}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Decision support */}
        {decisionSupportConcerns.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-violet-500">
              <HelpCircle size={13} /> {t("doctorSearch.decisionSupport")}
            </div>
            <div className="flex flex-wrap gap-2">
              {decisionSupportConcerns.map(({ key, specialization }) => (
                <button key={key} onClick={() => handleFilterChange("specialization", specialization)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${filters.specialization === specialization ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-700"}`}>
                  {t(`home.decisionSupport.concerns.${key}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search bar + sort + saved toggle */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input type="text" placeholder={t("doctorSearch.searchPlaceholder")}
              value={nameSearch} onChange={(e) => handleNameChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-9 pr-9 text-sm font-medium text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10" />
            {nameSearch && (
              <button onClick={() => handleNameChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                <X size={15} />
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={() => setSavedOnly((v) => !v)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition ${savedOnly ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
              <Bookmark size={16} /> Saved
            </button>

            <button onClick={() => setShowFilters((f) => !f)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition lg:hidden ${showFilters || hasActiveFilters ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
              <SlidersHorizontal size={16} />
              Filters
              {hasActiveFilters && <span className="ml-1 rounded-full bg-white/30 px-1.5 text-xs">{Object.values(filters).filter(Boolean).length}</span>}
            </button>

            <div className="relative">
              <select value={sort} onChange={(e) => updateParam("sort", e.target.value)}
                className="appearance-none rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-8 text-sm font-semibold text-slate-700 shadow-sm outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10">
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          <aside className="hidden w-72 flex-shrink-0 lg:block">
            <FilterPanel meta={meta} filters={filters} onChange={handleFilterChange} onReset={handleReset} hasActive={hasActiveFilters} />
          </aside>

          {showFilters && (
            <div className="fixed inset-0 z-50 flex lg:hidden">
              <div className="absolute inset-0 bg-black/50" onClick={() => setShowFilters(false)} />
              <div className="relative ml-auto h-full w-80 overflow-y-auto bg-slate-100 p-4 shadow-2xl">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-black text-slate-950">Filters</span>
                  <button onClick={() => setShowFilters(false)} className="rounded-lg p-2 hover:bg-slate-200">
                    <X size={18} />
                  </button>
                </div>
                <FilterPanel meta={meta} filters={filters} onChange={handleFilterChange} onReset={handleReset} hasActive={hasActiveFilters} />
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0">
            {hasActiveFilters && (
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.entries(filters).filter(([, v]) => v).map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1 rounded-xl bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                    {v}
                    <button onClick={() => handleFilterChange(k, "")} className="ml-1 hover:text-blue-900"><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}

            {error && (
              <div className="mb-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
                <div className="flex-1 text-sm font-semibold text-red-700">{error}</div>
                <button onClick={fetchDoctors} className="flex items-center gap-1 text-xs font-bold text-red-600 hover:text-red-800">
                  <RefreshCw size={13} /> Retry
                </button>
              </div>
            )}

            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : visibleDoctors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100">
                  <Stethoscope size={36} className="text-slate-300" />
                </div>
                <p className="mt-4 font-black text-slate-950">
                  {savedOnly ? "No saved doctors match these filters" : t("doctorSearch.empty.heading")}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {savedOnly ? "Save doctors you like and they'll show up here." : t("doctorSearch.empty.sub")}
                </p>
                {(hasActiveFilters || savedOnly) && (
                  <button onClick={handleReset}
                    className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700">
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleDoctors.map((d) => (
                    <DoctorCard key={d.id} doctor={d} onBook={handleBook}
                      compareChecked={compareIds.includes(d.id)}
                      onToggleCompare={toggleCompare}
                      compareDisabled={compareIds.length >= MAX_COMPARE}
                      saved={savedIds.has(String(d.id))}
                      onToggleSave={toggleSave}
                    />
                  ))}
                </div>

                {!savedOnly && pagination.pages > 1 && (
                  <div className="mt-8 flex items-center justify-center gap-2">
                    <button disabled={page <= 1} onClick={() => updateParam("page", page - 1)}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">
                      Previous
                    </button>
                    <div className="flex gap-1">
                      {Array.from({ length: Math.min(pagination.pages, 7) }, (_, i) => {
                        const p = i + 1;
                        return (
                          <button key={p} onClick={() => updateParam("page", p)}
                            className={`h-9 w-9 rounded-xl text-sm font-bold transition ${p === page ? "bg-blue-600 text-white shadow-lg" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                            {p}
                          </button>
                        );
                      })}
                    </div>
                    <button disabled={page >= pagination.pages} onClick={() => updateParam("page", page + 1)}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {compareIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Scale size={16} className="text-blue-600" />
              {t("doctorSearch.compare.selected", { count: compareIds.length, max: MAX_COMPARE })}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setCompareIds([])} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                {t("doctorSearch.compare.clear")}
              </button>
              <button disabled={compareIds.length < 2}
                onClick={() => navigate(`/doctors/compare?ids=${compareIds.join(",")}`)}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40">
                {t("doctorSearch.compare.cta")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
