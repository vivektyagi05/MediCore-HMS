import { BADGE_TONES } from "./Badge";

// Semantic wrapper over Badge for lifecycle/state pills (e.g. "Active",
// "Pending Approval", "Failed") — a dotted-status variant distinct from a
// plain label pill. Reuses the same TONES map as Badge so status colors
// never drift out of sync with the rest of the design system.
const DOT_TONES = {
  neutral: "bg-slate-400",
  info: "bg-blue-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  sky: "bg-sky-500",
  premium: "bg-gold-500",
};

function StatusBadge({ tone = "neutral", children, className = "" }) {
  const toneClass = BADGE_TONES[tone] || BADGE_TONES.neutral;
  const dotClass = DOT_TONES[tone] || DOT_TONES.neutral;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${toneClass} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export default StatusBadge;
