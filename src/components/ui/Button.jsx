import { Link } from "react-router-dom";

// Centralized button variant map — the design-system contract every
// enterprise surface (sidebar, header, tables, dialogs) reuses instead of
// each page inventing its own color combination. Tokens come from the
// @theme block in src/index.css (royal/navy/gold + Tailwind's semantic
// emerald/rose scale for success/danger).
const variants = {
  primary:
    "bg-royal-600 text-white shadow-sm hover:bg-royal-700 focus-visible:ring-royal-600/25",
  secondary:
    "border border-slate-300 bg-white text-slate-900 shadow-sm hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-slate-400/25",
  tertiary:
    "bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400/25",
  dark:
    "bg-navy-950 text-white shadow-sm hover:bg-navy-800 focus-visible:ring-navy-900/30",
  danger:
    "bg-rose-600 text-white shadow-sm hover:bg-rose-700 focus-visible:ring-rose-600/25",
  success:
    "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus-visible:ring-emerald-600/25",
  link:
    "bg-transparent text-royal-600 underline-offset-4 hover:underline focus-visible:ring-royal-600/20 shadow-none px-0 py-0",
};

const sizes = {
  md: "px-4 py-2.5 text-sm",
  sm: "px-3 py-2 text-xs",
  icon: "p-2.5",
};

function Button({
  children,
  className = "",
  disabled = false,
  isLoading = false,
  variant = "primary",
  size = "md",
  to,
  type = "button",
  ...props
}) {
  const sizeClass = variant === "link" ? "" : sizes[size] || sizes.md;
  const classes = `inline-flex items-center justify-center gap-2 rounded-control font-semibold transition duration-150 ease-standard focus:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${sizeClass} ${variants[variant] || variants.primary} ${className}`;

  if (to) {
    return (
      <Link to={to} className={classes} aria-disabled={disabled || undefined} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} disabled={disabled || isLoading} {...props}>
      {isLoading && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

export default Button;
