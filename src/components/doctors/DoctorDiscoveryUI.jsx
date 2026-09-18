import { Link } from "react-router-dom";
import { Star, MapPin, BadgeCheck, Calendar, Bookmark, BookmarkCheck, X } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import { normalizeDoctorConsultationModes } from "../../utils/consultationMode.js";

export const MODE_CLS = {
  online: "bg-sky-100 text-sky-700",
  offline: "bg-emerald-100 text-emerald-700",
  home_visit: "bg-violet-100 text-violet-700",
};

export const MODE_STYLES = {
  online: { label: "Online" },
  offline: { label: "In-Clinic" },
  home_visit: { label: "Home Visit" },
};

export const SORT_OPTIONS = [
  { value: "rating", label: "Highest Rated" },
  { value: "experience", label: "Most Experienced" },
  { value: "fees_asc", label: "Lowest Fees" },
  { value: "fees_desc", label: "Highest Fees" },
  { value: "reviews", label: "Most Reviewed" },
  { value: "bookings", label: "Most Booked" },
  { value: "availability", label: "Highest Availability" },
  { value: "newest", label: "Recently Verified" },
];

export const DEFAULT_FILTERS = {
  specialization: "", city: "", state: "", mode: "", language: "",
  minExp: "", maxFees: "", minRating: "", hospital: "",
  availableToday: "", availableTomorrow: "", weekend: "", emergency: "",
};

export const StarRating = ({ rating, size = 13 }) => (
  <span className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} size={size}
        className={i <= Math.floor(rating)
          ? "fill-amber-400 text-amber-400"
          : i === Math.floor(rating) + 1 && rating % 1 >= 0.5
            ? "fill-amber-200 text-amber-400"
            : "text-slate-300"} />
    ))}
  </span>
);

export const SkeletonCard = () => (
  <div className="glass-card animate-pulse rounded-2xl p-5">
    <div className="flex gap-4">
      <div className="h-16 w-16 flex-shrink-0 rounded-2xl bg-slate-200" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-4 w-36 rounded bg-slate-200" />
        <div className="h-3 w-24 rounded bg-slate-200" />
        <div className="h-3 w-20 rounded bg-slate-200" />
      </div>
    </div>
    <div className="mt-4 flex gap-2">
      <div className="h-5 w-16 rounded-lg bg-slate-200" />
      <div className="h-5 w-20 rounded-lg bg-slate-200" />
    </div>
    <div className="mt-4 h-px bg-slate-200" />
    <div className="mt-3 flex justify-between">
      <div className="h-3 w-24 rounded bg-slate-200" />
      <div className="h-4 w-16 rounded bg-slate-200" />
    </div>
  </div>
);

/**
 * Doctor result card used by both the public search page and the
 * authenticated patient discovery page.
 *
 * Compare checkbox is shown when `onToggleCompare` is passed.
 * Save/bookmark button is shown when `onToggleSave` is passed (patient-only —
 * the public page never passes it, so its rendering is unaffected).
 */
export function DoctorCard({
  doctor, onBook, compareChecked, onToggleCompare, compareDisabled,
  saved, onToggleSave, profileHref,
}) {
  const { t } = useI18n();
  const initials = doctor.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const href = profileHref || `/doctors/${doctor.id}`;

  return (
    <div className="glass-card group relative flex flex-col rounded-2xl p-5 transition duration-200 hover:-translate-y-1 hover:shadow-xl">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5">
        {onToggleCompare && (
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur">
            <input type="checkbox" checked={compareChecked} disabled={compareDisabled && !compareChecked}
              onChange={() => onToggleCompare(doctor.id)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
            {t("doctorSearch.compare.add")}
          </label>
        )}
        {onToggleSave && (
          <button
            type="button"
            onClick={() => onToggleSave(doctor.id)}
            title={saved ? "Remove from saved doctors" : "Save doctor"}
            className={`flex h-8 w-8 items-center justify-center rounded-lg shadow-sm backdrop-blur transition ${
              saved ? "bg-blue-600 text-white" : "bg-white/90 text-slate-500 hover:text-blue-600"
            }`}
          >
            {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
          </button>
        )}
      </div>

      <Link to={href} className="flex items-start gap-4 focus:outline-none">
        <div className="relative flex-shrink-0">
          {doctor.profilePhoto
            ? (
              <>
                {/* PHASE 2-D — public asset ENOENT bugfix: fall back to the
                    initials avatar instead of a broken image icon when the
                    stored photo URL no longer resolves to a file on disk. */}
                <img
                  src={doctor.profilePhoto}
                  alt={doctor.name}
                  className="h-16 w-16 rounded-2xl object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    if (e.currentTarget.nextElementSibling) e.currentTarget.nextElementSibling.style.display = "flex";
                  }}
                />
                <span className="hidden h-16 w-16 items-center justify-center rounded-2xl bg-slate-950 text-lg font-black text-white" style={{ display: "none" }}>{initials}</span>
              </>
            )
            : <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-950 text-lg font-black text-white">{initials}</span>
          }
          {doctor.isVerified && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 ring-2 ring-white">
              <BadgeCheck size={12} className="text-white" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-slate-950">{doctor.name}</p>
          <p className="text-sm text-slate-500">{doctor.specialization}</p>
          {doctor.qualification && <p className="truncate text-xs text-slate-400">{doctor.qualification}</p>}
          {(doctor.city || doctor.state) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
              <MapPin size={10} />{[doctor.city, doctor.state].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
      </Link>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {/* Same legacy-data contract as BookAppointment.jsx: never render a
            raw, unrecognized Doctor.consultationMode value (e.g. "both")
            as a badge -- it has no MODE_CLS/i18n entry and would surface
            the raw internal value to patients. */}
        {normalizeDoctorConsultationModes(doctor.consultationMode).slice(0, 3).map((m) => (
          <span key={m} className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${MODE_CLS[m] || "bg-slate-100 text-slate-600"}`}>
            {t(`doctorSearch.modes.${m}`)}
          </span>
        ))}
        {doctor.hospitalName && (
          <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 max-w-[140px] truncate">
            {doctor.hospitalName}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-200/60 pt-4">
        <div className="flex items-center gap-2">
          <StarRating rating={doctor.rating} />
          <span className="text-xs font-bold text-slate-700">{doctor.rating.toFixed(1)}</span>
          {doctor.totalReviews > 0 && <span className="text-xs text-slate-400">{t("doctorSearch.card.reviews", { n: doctor.totalReviews })}</span>}
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Consultation fee</p>
          <p className="font-black text-slate-950">₹{doctor.fees}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-3 text-xs text-slate-500">
          <span>{t("doctorSearch.card.exp", { n: doctor.experience })}</span>
          {doctor.totalConsultations > 0 && <span>{t("doctorSearch.card.consults", { n: doctor.totalConsultations })}</span>}
        </div>
        {onBook && (
          <button
            onClick={() => onBook(doctor)}
            className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Calendar size={11} /> Book
          </button>
        )}
      </div>
    </div>
  );
}

export function FilterPanel({ meta, filters, onChange, onReset, hasActive }) {
  const { t } = useI18n();
  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-black text-slate-950">{t("doctorSearch.filters.heading")}</h3>
        {hasActive && (
          <button onClick={onReset}
            className="flex items-center gap-1 text-xs font-semibold text-red-500 hover:text-red-700">
            <X size={12} /> Reset
          </button>
        )}
      </div>

      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">{t("doctorSearch.filters.specialization")}</label>
          <select value={filters.specialization} onChange={(e) => onChange("specialization", e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10">
            <option value="">All</option>
            {meta.specializations.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">{t("doctorSearch.filters.city")}</label>
          <select value={filters.city} onChange={(e) => onChange("city", e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10">
            <option value="">All cities</option>
            {meta.cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">{t("doctorSearch.filters.state")}</label>
          <select value={filters.state} onChange={(e) => onChange("state", e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10">
            <option value="">All states</option>
            {meta.states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">{t("doctorSearch.filters.hospital")}</label>
          <input type="text" value={filters.hospital} onChange={(e) => onChange("hospital", e.target.value)}
            placeholder={t("doctorSearch.filters.hospitalPlaceholder")}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10" />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">{t("doctorSearch.filters.mode")}</label>
          <div className="space-y-2">
            {["online", "offline", "home_visit"].map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={filters.mode === m}
                  onChange={() => onChange("mode", filters.mode === m ? "" : m)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                <span className="text-sm font-medium text-slate-700">{MODE_STYLES[m].label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">
            Min Experience: {filters.minExp ? `${filters.minExp} yrs` : "Any"}
          </label>
          <input type="range" min="0" max="30" step="1"
            value={filters.minExp || 0}
            onChange={(e) => onChange("minExp", e.target.value === "0" ? "" : e.target.value)}
            className="w-full accent-blue-600" />
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>0</span><span>15</span><span>30+</span>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">Max Fees: {filters.maxFees ? `₹${filters.maxFees}` : "Any"}</label>
          <input type="range" min="100" max="5000" step="100"
            value={filters.maxFees || 5000}
            onChange={(e) => onChange("maxFees", e.target.value === "5000" ? "" : e.target.value)}
            className="w-full accent-blue-600" />
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>₹100</span><span>₹2.5K</span><span>₹5K+</span>
          </div>
        </div>

        {meta.languages?.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">{t("doctorSearch.filters.language")}</label>
            <select value={filters.language} onChange={(e) => onChange("language", e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10">
              <option value="">All languages</option>
              {meta.languages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">{t("doctorSearch.filters.minRating")}</label>
          <div className="flex gap-1">
            {[0, 3, 3.5, 4, 4.5].map((r) => (
              <button key={r} onClick={() => onChange("minRating", filters.minRating == r ? "" : r)}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${filters.minRating == r ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-700"}`}>
                {r === 0 ? t("doctorSearch.filters.any") : `${r}+`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">{t("doctorSearch.filters.availability")}</label>
          <div className="space-y-2">
            {[
              ["availableToday", t("doctorSearch.filters.availableToday")],
              ["availableTomorrow", t("doctorSearch.filters.availableTomorrow")],
              ["weekend", t("doctorSearch.filters.weekend")],
              ["emergency", t("doctorSearch.filters.emergency")],
            ].map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={filters[key] === "true"}
                  onChange={() => onChange(key, filters[key] === "true" ? "" : "true")}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                <span className="text-sm font-medium text-slate-700">{label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
