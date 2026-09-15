// New form primitive (see Select.jsx note — same deliberate non-adoption
// this phase).
function Checkbox({ label, className = "", id, ...props }) {
  const checkboxId = id || props.name;
  return (
    <label htmlFor={checkboxId} className={`flex items-center gap-2.5 text-sm font-medium text-slate-700 ${className}`}>
      <input
        id={checkboxId}
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-royal-600 focus:ring-4 focus:ring-royal-600/10 disabled:cursor-not-allowed disabled:opacity-60"
        {...props}
      />
      {label}
    </label>
  );
}

export default Checkbox;
