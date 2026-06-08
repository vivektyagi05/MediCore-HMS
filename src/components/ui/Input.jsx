function Input({ label, error, className = "", id, ...props }) {
  const inputId = id || props.name;

  return (
    <label htmlFor={inputId} className="block">
      {label && (
        <span className="mb-2 block text-sm font-semibold text-slate-700">
          {label}
        </span>
      )}
      <input
        id={inputId}
        className={`w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10 ${error ? "border-red-500 focus:border-red-500 focus:ring-red-500/10" : ""} ${className}`}
        {...props}
      />
      {error && <span className="mt-2 block text-xs font-medium text-red-600">{error}</span>}
    </label>
  );
}

export default Input;
