// New form primitive (see Select.jsx note — same deliberate non-adoption
// this phase).
function Textarea({ label, error, helperText, required, className = "", id, rows = 4, ...props }) {
  const textareaId = id || props.name;
  const describedBy = error ? `${textareaId}-error` : helperText ? `${textareaId}-helper` : undefined;

  return (
    <label htmlFor={textareaId} className="block">
      {label && (
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">
          {label}
          {required && <span className="ml-1 text-rose-600">*</span>}
        </span>
      )}
      <textarea
        id={textareaId}
        rows={rows}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        required={required}
        className={`w-full resize-y rounded-control border bg-white px-3.5 py-2.5 text-sm text-slate-950 shadow-sm outline-none transition duration-150 placeholder:text-slate-400 focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${error ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500/10" : "border-slate-300 focus:border-royal-600 focus:ring-royal-600/10"} ${className}`}
        {...props}
      />
      {error ? (
        <span id={`${textareaId}-error`} className="mt-1.5 block text-xs font-medium text-rose-600">{error}</span>
      ) : helperText ? (
        <span id={`${textareaId}-helper`} className="mt-1.5 block text-xs font-medium text-slate-500">{helperText}</span>
      ) : null}
    </label>
  );
}

export default Textarea;
