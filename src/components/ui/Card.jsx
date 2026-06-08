function Card({ children, className = "", title, action }) {
  return (
    <section className={`glass-card rounded-2xl p-6 transition duration-200 hover:-translate-y-1 hover:shadow-xl ${className}`}>
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
