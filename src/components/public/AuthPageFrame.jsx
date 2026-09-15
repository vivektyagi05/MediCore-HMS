import { Activity, BadgeCheck, CalendarCheck2, Search, ShieldCheck } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";

export default function AuthPageFrame({ children, mode = "login", bookingIntent = false }) {
  const { t } = useI18n();
  const copy = mode === "register"
    ? t("p14.story.registerTitle")
    : mode === "recovery"
      ? t("p15.story.title")
      : t("p14.story.loginTitle");
  const description = mode === "register"
    ? t("p14.story.registerDescription")
    : mode === "recovery"
      ? t("p15.story.description")
      : t("p14.story.loginDescription");

  const signals = [
    [Search, t("p14.story.discover"), t("p14.story.discoverText")],
    [CalendarCheck2, t("p14.story.availability"), t("p14.story.availabilityText")],
    [ShieldCheck, t("p14.story.protected"), t("p14.story.protectedText")],
  ];

  return (
    <section className="auth-page relative isolate min-h-[calc(100vh-81px)] overflow-hidden bg-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.035)_1px,transparent_1px)] bg-[size:54px_54px] [mask-image:linear-gradient(to_bottom,black,transparent_94%)]" />
      <div className="pointer-events-none absolute -left-32 top-12 h-80 w-80 rounded-full bg-orange-400/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-8rem] bottom-0 h-96 w-96 rounded-full bg-sky-400/10 blur-3xl" />

      <div className="public-shell relative grid min-h-[calc(100vh-81px)] items-center gap-10 py-8 sm:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)] lg:gap-16 lg:py-16 xl:gap-24">
        <div className="max-w-3xl py-2 lg:py-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white px-3 py-1.5 text-sm font-bold text-orange-700 shadow-sm">
            <Activity size={15} aria-hidden="true" />
            {t("p14.story.eyebrow")}
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.02] tracking-[-0.04em] text-slate-950 sm:text-5xl lg:text-6xl xl:text-7xl">
            {copy}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
            {description}
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:max-w-4xl">
            {signals.map(([Icon, title, text]) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_12px_36px_-28px_rgba(15,23,42,0.4)]">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600">
                  <Icon size={17} aria-hidden="true" />
                </div>
                <p className="mt-4 text-sm font-black text-slate-950">{title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-3 border-t border-slate-200 pt-5 text-sm text-slate-600">
            <BadgeCheck size={18} className="shrink-0 text-emerald-600" aria-hidden="true" />
            <span>{bookingIntent ? t("p14.story.bookingContext") : t("p14.story.generalContext")}</span>
          </div>
        </div>

        <div className="relative w-full lg:justify-self-end">
          <div className="absolute -inset-2 rounded-[1.7rem] bg-gradient-to-br from-orange-500/10 via-transparent to-sky-500/10 blur-xl" aria-hidden="true" />
          <div className="relative rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_28px_70px_-38px_rgba(15,23,42,0.35)] sm:p-7">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
