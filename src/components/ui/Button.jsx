import { Link } from "react-router-dom";

const variants = {
  primary:
    "bg-blue-600 text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-600/30",
  secondary:
    "border border-slate-300 bg-white/60 text-slate-900 shadow-lg hover:border-slate-950 hover:bg-white",
  dark:
    "bg-slate-950 text-white shadow-lg hover:bg-slate-800 hover:shadow-xl",
};

function Button({
  children,
  className = "",
  disabled = false,
  isLoading = false,
  variant = "primary",
  to,
  type = "button",
  ...props
}) {
  const classes = `inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition duration-200 hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${variants[variant]} ${className}`;

  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} disabled={disabled || isLoading} {...props}>
      {isLoading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

export default Button;
