// New form primitive (see Select.jsx note — same deliberate non-adoption
// this phase).
function Radio({ label, className = "", id, ...props }) {
  const radioId = id || `${props.name}-${props.value}`;
  return (
    <label htmlFor={radioId} className={`flex items-center gap-2.5 text-sm font-medium text-slate-700 ${className}`}>
      <input
        id={radioId}
        type="radio"
        className="h-4 w-4 border-slate-300 text-royal-600 focus:ring-4 focus:ring-royal-600/10 disabled:cursor-not-allowed disabled:opacity-60"
        {...props}
      />
      {label}
    </label>
  );
}

export default Radio;
