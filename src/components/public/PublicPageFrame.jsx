export default function PublicPageFrame({ children, className = "", glow = true }) {
  return (
    <div className={`public-page relative min-h-screen overflow-hidden bg-slate-50 text-slate-900 ${className}`}>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.035)_1px,transparent_1px)] bg-[size:54px_54px] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />
      {glow && (
        <>
          <div className="pointer-events-none absolute -left-40 top-20 h-96 w-96 rounded-full bg-orange-400/10 blur-3xl" />
          <div className="pointer-events-none absolute right-[-10rem] top-80 h-[34rem] w-[34rem] rounded-full bg-blue-400/10 blur-3xl" />
        </>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function PublicSection({ eyebrow, title, description, children, className = "" }) {
  return (
    <section className={`public-shell py-14 sm:py-16 lg:py-20 ${className}`}>
      {(eyebrow || title || description) && (
        <div className="mb-10 max-w-3xl">
          {eyebrow && <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">{eyebrow}</p>}
          {title && <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">{title}</h2>}
          {description && <p className="mt-4 text-base leading-8 text-slate-600 sm:text-lg">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PublicCard({ children, className = "" }) {
  return (
    <div className={`rounded-[1.25rem] border border-slate-200 bg-white shadow-[0_12px_36px_-24px_rgba(15,23,42,0.35)] ${className}`}>
      {children}
    </div>
  );
}
