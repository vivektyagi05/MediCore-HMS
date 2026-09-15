// Consistent page-section heading: eyebrow -> title -> description, per
// the typography hierarchy rule (no ad-hoc huge headings per page).
function SectionHeader({ eyebrow, title, description, action, className = "" }) {
  return (
    <div className={`mb-5 flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div>
        {eyebrow && (
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-royal-600">{eyebrow}</p>
        )}
        <h2 className="text-lg font-bold text-slate-950">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export default SectionHeader;
