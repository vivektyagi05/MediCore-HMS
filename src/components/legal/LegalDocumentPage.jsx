import { ArrowLeft, ChevronRight, ExternalLink, ShieldCheck } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import SEOMeta from "../shared/SEOMeta";
import PublicPageFrame, { PublicCard, PublicSection } from "../public/PublicPageFrame";
import { useI18n } from "../../i18n/I18nContext";
import { LEGAL_DOCUMENTS } from "../../../shared/legalDocuments";

const SECTION_KEYS = {
  privacy: ["scope","identity","provide","usage","health","purpose","sharing","retention","security","rights","requests","export","consent","contact","law","changes","disclaimer"],
  terms: ["service","account","doctors","appointments","payments","content","health","third","availability","ip","responsibility","law","changes","contact"],
  medicalDisclaimer: ["platform","provider","emergency","information","nooutcome","notadvice","privacy","links"],
  cookie: ["cookies","storage","tracking","thirdparty","maps","preferences","contact"],
  dataRights: ["available","access","correction","deletion","consent","grievance","security","limitations","contact"],
};

const labels = {
  privacy: "p16.docs.privacy",
  terms: "p16.docs.terms",
  medicalDisclaimer: "p16.docs.medicalDisclaimer",
  cookie: "p16.docs.cookie",
  dataRights: "p16.docs.dataRights",
};

export default function LegalDocumentPage({ documentKey }) {
  const { t, locale } = useI18n();
  const meta = LEGAL_DOCUMENTS[documentKey];
  const base = labels[documentKey];
  const sectionKeys = SECTION_KEYS[documentKey];

  if (!meta || !base || !Array.isArray(sectionKeys)) {
    return <Navigate to="/privacy-policy" replace />;
  }

  return (
    <PublicPageFrame>
      <SEOMeta
        title={t(`${base}.title`)}
        description={t(`${base}.intro`)}
        canonical={meta.route}
      />
      <PublicSection className="pt-12 sm:pt-16">
        <div className="mx-auto max-w-6xl">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-950 focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/20">
            <ArrowLeft size={15} aria-hidden="true" /> {t("p16.common.back")}
          </Link>

          <div className="mt-8 grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)]">
            <aside className="h-max lg:sticky lg:top-24">
              <PublicCard className="p-4">
                <div className="flex items-center gap-2 text-sm font-black text-slate-950">
                  <ShieldCheck size={17} className="text-emerald-600" aria-hidden="true" />
                  {t("p16.common.contents")}
                </div>
                <nav aria-label={t("p16.common.contents")} className="mt-3 space-y-1">
                  {sectionKeys.map((key) => (
                    <a key={key} href={`#${documentKey}-${key}`} className="flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                      <span>{t(`${base}.sections.${key}.0`)}</span><ChevronRight size={12} aria-hidden="true" />
                    </a>
                  ))}
                </nav>
              </PublicCard>
            </aside>

            <article className="min-w-0">
              <PublicCard className="p-6 sm:p-9">
                <div className="border-b border-slate-200 pb-7">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">{t("p16.nav."+documentKey)}</p>
                  <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{t(`${base}.title`)}</h1>
                  <p className="mt-5 max-w-3xl text-base leading-8 text-slate-600">{t(`${base}.intro`)}</p>
                  {locale !== "en" && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{t("p16.common.translationNotice")}</p>}
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-slate-500">
                    <span>{t("p16.common.effective")}: {meta.effectiveDate}</span>
                    <span>{t("p16.common.updated")}: {meta.updatedDate}</span>
                    <span>{t("p16.common.version")}: {meta.version}</span>
                  </div>
                </div>

                <div className="mt-8 space-y-9">
                  {sectionKeys.map((key) => {
                    const title = t(`${base}.sections.${key}.0`);
                    const body = t(`${base}.sections.${key}.1`);
                    if (!title || !body || title.includes(".sections.") || body.includes(".sections.")) return null;
                    return (
                      <section key={key} id={`${documentKey}-${key}`} className="scroll-mt-28">
                        <h2 className="text-xl font-black text-slate-950 sm:text-2xl">{title}</h2>
                        <p className="mt-3 text-sm leading-7 text-slate-600">{body}</p>
                      </section>
                    );
                  })}
                </div>

                {documentKey === "privacy" && (
                  <div className="mt-10 border-t border-slate-200 pt-7">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{t("p16.common.officialReference")}</p>
                    <div className="mt-3 flex flex-col gap-2 text-sm">
                      <a className="inline-flex items-center gap-2 font-bold text-orange-700 hover:underline" href="https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf" target="_blank" rel="noopener noreferrer">Digital Personal Data Protection Act, 2023 <ExternalLink size={13} aria-hidden="true" /></a>
                      <a className="inline-flex items-center gap-2 font-bold text-orange-700 hover:underline" href="https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa" target="_blank" rel="noopener noreferrer">Digital Personal Data Protection Rules, 2025 <ExternalLink size={13} aria-hidden="true" /></a>
                      <a className="inline-flex items-center gap-2 font-bold text-orange-700 hover:underline" href="https://www.indiacode.nic.in/handle/123456789/1999" target="_blank" rel="noopener noreferrer">Information Technology Act, 2000 <ExternalLink size={13} aria-hidden="true" /></a>
                      <a className="inline-flex items-center gap-2 font-bold text-orange-700 hover:underline" href="https://www.indiacode.nic.in/indiacode/handle/123456789/16939?view_type=browse" target="_blank" rel="noopener noreferrer">Consumer Protection Act, 2019 <ExternalLink size={13} aria-hidden="true" /></a>
                    </div>
                  </div>
                )}
              </PublicCard>
            </article>
          </div>
        </div>
      </PublicSection>
    </PublicPageFrame>
  );
}
