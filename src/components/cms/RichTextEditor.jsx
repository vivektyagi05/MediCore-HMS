import { useI18n } from "../../i18n/I18nContext";

const TOOLBAR = [
  ["<h2>", "Heading 2"], ["<strong>", "Bold"], ["<em>", "Italic"],
  ["<ul>", "Bulleted list"], ["<ol>", "Numbered list"], ["<blockquote>", "Quote"],
];

function wrapSelection(textarea, before, after, onChange) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || "text";
  const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
  onChange(next);
  requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + before.length, start + before.length + selected.length); });
}

function RichTextEditor({ value, onChange, error }) {
  const { t } = useI18n();
  return (
    <div className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700">{t("p19.articles.content")}</span>
      <div className="mb-2 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2" aria-label={t("p19.articles.contentTools")}>
        {TOOLBAR.map(([tag, label]) => {
          const pair = {
            "<h2>": ["<h2>", "</h2>"], "<strong>": ["<strong>", "</strong>"], "<em>": ["<em>", "</em>"],
            "<ul>": ["<ul><li>", "</li></ul>"], "<ol>": ["<ol><li>", "</li></ol>"], "<blockquote>": ["<blockquote>", "</blockquote>"],
          }[tag];
          return <button key={tag} type="button" className="rounded-lg border bg-white px-2.5 py-1.5 text-xs font-bold hover:bg-slate-100" onClick={(e) => wrapSelection(e.currentTarget.closest("div").nextElementSibling, pair[0], pair[1], onChange)}>{label}</button>;
        })}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error) || undefined}
        className={`min-h-72 w-full resize-y rounded-xl border bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10 ${error ? "border-red-500" : "border-slate-200"}`}
        placeholder="<p>Write article content…</p>"
      />
      <p className="mt-2 text-xs text-slate-500">{t("p19.articles.contentHint")}</p>
      {error && <span className="mt-2 block text-xs font-medium text-red-600">{error}</span>}
    </div>
  );
}

export default RichTextEditor;
