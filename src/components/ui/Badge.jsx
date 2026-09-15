// Shared status/tone pill. Before this component existed, at least three
// files (DoctorDiscoveryUI, DoctorEarnings, AdminRefunds) each hardcoded
// their own status -> Tailwind class map, and the shade weights had drifted
// (some used *-100/*-700, others *-100/*-800) so the "same" status color
// rendered slightly differently depending on which page you were on. This
// is the single place that mapping lives now.
const TONES = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-blue-100 text-blue-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-rose-100 text-rose-700",
  violet: "bg-violet-100 text-violet-700",
  teal: "bg-teal-100 text-teal-700",
  sky: "bg-sky-100 text-sky-700",
  // Restrained premium accent — reserve for AI/high-value insight labels
  // and executive-tier indicators, never as a default status color.
  premium: "bg-gold-100 text-gold-600",
};

function Badge({ tone = "neutral", children, className = "", icon: Icon }) {
  const toneClass = TONES[tone] || TONES.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${toneClass} ${className}`}
    >
      {Icon && <Icon size={13} />}
      {children}
    </span>
  );
}

export default Badge;
export { TONES as BADGE_TONES };
