// `id` is additive — lets a Card be an anchor-link target (e.g. dashboard
// "Open" jump-links) without every caller needing to wrap it in an extra
// <div id=...>. No existing caller passes id today, so this changes
// nothing for them.
function Card({ children, className = "", title, action, id }) {
  return (
    <section id={id} className={`glass-card rounded-card p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          {title && <h2 className="text-lg font-bold text-slate-950">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export default Card;
