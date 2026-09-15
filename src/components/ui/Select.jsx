import { ChevronDown } from "lucide-react";

// New form primitive — the "Select" audited-for in the global form system
// requirements. No existing page consumes this yet (they render raw
// <select> elements inline); this is the reusable contract future
// page-level phases should adopt instead of re-inventing select styling
// per page. Left un-adopted here deliberately — this phase does not
// redesign business pages.
function Select({ label, error, helperText, required, className = "", id, children, ...props }) {
  const selectId = id || props.name;
  const describedBy = error ? `${selectId}-error` : helperText ? `${selectId}-helper` : undefined;

  return (
    <label htmlFor={selectId} className="block">
      {label && (
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">
          {label}
          {required && <span className="ml-1 text-rose-600">*</span>}
        </span>
      )}
      <span className="relative block">
        <select
          id={selectId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          required={required}
          className={`w-full appearance-none rounded-control border bg-white px-3.5 py-2.5 pr-9 text-sm text-slate-950 shadow-sm outline-none transition duration-150 focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${error ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500/10" : "border-slate-300 focus:border-royal-600 focus:ring-royal-600/10"} ${className}`}
          {...props}
        >
          {children}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
      </span>
      {error ? (
        <span id={`${selectId}-error`} className="mt-1.5 block text-xs font-medium text-rose-600">{error}</span>
      ) : helperText ? (
        <span id={`${selectId}-helper`} className="mt-1.5 block text-xs font-medium text-slate-500">{helperText}</span>
      ) : null}
    </label>
  );
}

export default Select;
