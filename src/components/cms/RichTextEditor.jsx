function RichTextEditor({ value, onChange, error }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700">Content</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`min-h-56 w-full resize-y rounded-xl border bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10 ${
          error ? "border-red-500" : "border-slate-200"
        }`}
        placeholder="Write rich page content. Script tags and inline event handlers are stripped on the backend."
      />
      {error && <span className="mt-2 block text-xs font-medium text-red-600">{error}</span>}
    </label>
  );
}

export default RichTextEditor;
