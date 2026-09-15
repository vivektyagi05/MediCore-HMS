// Minimal, dependency-free tooltip for icon-only controls (e.g. the
// collapsed sidebar). Pure CSS group-hover/focus-within — no portal, no
// extra JS state, so it can't leak listeners or desync from its trigger.
function Tooltip({ label, children, side = "right", className = "" }) {
  const sideClass = side === "right" ? "left-full ml-2 top-1/2 -translate-y-1/2" : "top-full mt-2 left-1/2 -translate-x-1/2";

  return (
    <span className={`group relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-navy-950 px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-elevated transition duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${sideClass}`}
      >
        {label}
      </span>
    </span>
  );
}

export default Tooltip;
