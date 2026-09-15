// Enterprise metric primitive — a single real number with a label,
// optional trend, and optional source/context caption. Per the finance/AI
// UI truthfulness rules, this component never invents a value: callers
// must pass the value they actually computed from a real backend field.
// `caption` should name the source/time-range when the number needs one
// (e.g. "Last 30 days · live").
// Icon tone -> classes. Mirrors Badge.jsx's semantic tone vocabulary so a
// tone name means the same thing everywhere in the app; kept as its own map
// (rather than importing BADGE_TONES) because this needs -100/-600 pairs for
// an icon chip, not the -100/-700 text-pill pairs Badge uses.
// NOTE: "info" and "warning" were already being passed by existing consumers
// (AdminDoctors.jsx, RefundDetailWorkspace.jsx, PaymentDetailWorkspace.jsx)
// before this map defined them, so those call sites were silently falling
// through to the neutral/royal look. Adding them here is additive — it only
// changes rendering for tone values that had no defined look before.
const ICON_TONE_CLASSES = {
  neutral: "bg-royal-100 text-royal-600",
  premium: "bg-gold-100 text-gold-600",
  danger: "bg-rose-100 text-rose-600",
  success: "bg-emerald-100 text-emerald-600",
  warning: "bg-amber-100 text-amber-600",
  info: "bg-blue-100 text-blue-600",
  violet: "bg-violet-100 text-violet-600",
};

function MetricCard({ label, value, caption, trend, tone = "neutral", icon: Icon, className = "" }) {
  const trendClass =
    trend == null ? "" : trend > 0 ? "text-emerald-600" : trend < 0 ? "text-rose-600" : "text-slate-500";

  const iconToneClass = ICON_TONE_CLASSES[tone] || ICON_TONE_CLASSES.neutral;

  return (
    <div className={`glass-card rounded-card p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        </div>
        {Icon && (
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control ${iconToneClass}`}>
            <Icon size={18} />
          </span>
        )}
      </div>
      {(caption || trend != null) && (
        <div className="mt-3 flex items-center gap-2 text-xs font-semibold">
          {trend != null && (
            <span className={trendClass}>
              {trend > 0 ? "+" : ""}
              {trend}%
            </span>
          )}
          {caption && <span className="text-slate-400">{caption}</span>}
        </div>
      )}
    </div>
  );
}

export default MetricCard;
