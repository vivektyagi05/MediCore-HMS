import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock,
  IndianRupee,
  Stethoscope,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { publicApi } from "../../api/publicApi";
import { useI18n } from "../../i18n/I18nContext";
import SEOMeta, {
  buildBreadcrumbJsonLd,
} from "../../components/shared/SEOMeta";
import { buildPublicUrl } from "../../config/seo";
import PublicPageFrame, {
  PublicCard,
} from "../../components/public/PublicPageFrame";

export default function ServiceDetail() {
  const { slug } = useParams();
  const { t, locale } = useI18n();

  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setState("loading");

        const response = await publicApi.getService(slug);
        const result = response?.data || null;

        if (!mounted) return;

        setData(result);
        setState(result?.service ? "ready" : "error");
      } catch (error) {
        if (!mounted) return;

        console.error("Failed to load service:", error);
        setData(null);
        setState("error");
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [slug]);

  // Loading
  if (state === "loading") {
    return (
      <PublicPageFrame>
        <div className="public-shell py-24">
          <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />
        </div>
      </PublicPageFrame>
    );
  }

  // Error / Not found
  if (state === "error" || !data?.service) {
    return (
      <PublicPageFrame>
        <div className="public-shell py-28 text-center">
          <h1 className="text-2xl font-black">
            {t("p19.services.empty")}
          </h1>

          <Link
            to="/services"
            className="mt-5 inline-flex rounded-xl bg-orange-500 px-4 py-3 text-sm font-black"
          >
            {t("p19.services.back")}
          </Link>
        </div>
      </PublicPageFrame>
    );
  }

  const s = data.service;

  const canonicalUrl =
    s.seo?.canonical?.startsWith("http")
      ? s.seo.canonical
      : buildPublicUrl(
          s.seo?.canonical || `/services/${s.slug}`
        );

  const contentSections = [
    ["p19.services.overview", s.description],
    ["p19.services.patient", s.eligibility],
    ["p19.services.preparation", s.preparation],
    ["p19.services.procedure", s.procedureInformation],
  ].filter(([, value]) => value);

  return (
    <PublicPageFrame>
      <SEOMeta
        title={s.seo?.title || s.title}
        description={s.seo?.description || s.description}
        canonical={s.seo?.canonical || `/services/${s.slug}`}
        image={s.image || undefined}
        imageAlt={s.title}
        locale={locale}
        robots={s.seo?.robots}
        jsonLd={[
          {
            "@type": "MedicalService",
            name: s.title,
            description: s.description,
            url: canonicalUrl,
          },
          buildBreadcrumbJsonLd([
            {
              name: t("nav.home"),
              url: "/",
            },
            {
              name: t("nav.services"),
              url: "/services",
            },
            {
              name: s.title,
              url: `/services/${s.slug}`,
            },
          ]),
        ]}
      />

      <article className="public-shell pb-24 pt-12">
        {/* Back */}
        <Link
          to="/services"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500"
        >
          <ArrowLeft size={14} />
          {t("p19.services.back")}
        </Link>

        {/* Header */}
        <header className="mt-8 grid gap-8 lg:grid-cols-[1.3fr_.7fr] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[.2em] text-orange-600">
              {s.category}
            </p>

            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">
              {s.title}
            </h1>

            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-600">
              {s.shortDescription || s.description}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/doctors"
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-black text-slate-950"
              >
                <CalendarDays size={16} />
                {t("p13.services.explore")}
              </Link>

              {s.price !== undefined && s.price !== null && (
                <span className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-black">
                  <IndianRupee size={15} />
                  {s.price}
                </span>
              )}

              {s.duration && (
                <span className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-black">
                  <Clock size={15} />
                  {s.duration}
                </span>
              )}
            </div>
          </div>

          {s.image && (
            <img
              src={s.image}
              alt={s.title}
              className="h-72 w-full rounded-3xl object-cover"
            />
          )}
        </header>

        {/* Service Information */}
        {contentSections.length > 0 && (
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {contentSections.map(([key, value]) => (
              <PublicCard key={key} className="p-6">
                <h2 className="text-xl font-black">
                  {t(key)}
                </h2>

                <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-600">
                  {value}
                </p>
              </PublicCard>
            ))}

            {/* Benefits */}
            {Array.isArray(s.benefits) && s.benefits.length > 0 && (
              <PublicCard className="p-6">
                <h2 className="text-xl font-black">
                  {t("p19.services.benefits")}
                </h2>

                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-slate-600">
                  {s.benefits.map((benefit, index) => (
                    <li key={`${benefit}-${index}`}>
                      {benefit}
                    </li>
                  ))}
                </ul>
              </PublicCard>
            )}
          </div>
        )}

        {/* Related Doctors */}
        {Array.isArray(s.relatedDoctors) &&
          s.relatedDoctors.length > 0 && (
            <section className="mt-12">
              <h2 className="text-2xl font-black">
                {t("p19.services.doctors")}
              </h2>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {s.relatedDoctors.map((doctor) => (
                  <PublicCard
                    key={doctor.id}
                    className="p-5"
                  >
                    <div className="flex gap-4">
                      {doctor.profilePhoto ? (
                        <img
                          src={doctor.profilePhoto}
                          alt={doctor.name || ""}
                          className="h-16 w-16 rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                          <Stethoscope />
                        </div>
                      )}

                      <div>
                        <h3 className="font-black">
                          {doctor.name}
                        </h3>

                        <p className="text-sm text-slate-600">
                          {doctor.specialization}
                        </p>

                        <Link
                          to={`/doctors/${doctor.id}`}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-black text-orange-600"
                        >
                          {t("p13.services.explore")}
                          <ArrowRight size={12} />
                        </Link>
                      </div>
                    </div>
                  </PublicCard>
                ))}
              </div>
            </section>
          )}

        {/* Related Services */}
        {Array.isArray(data.relatedServices) &&
          data.relatedServices.length > 0 && (
            <section className="mt-12">
              <h2 className="text-2xl font-black">
                {t("p19.services.relatedServices")}
              </h2>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {data.relatedServices.map((related) => (
                  <Link
                    key={related.id}
                    to={`/services/${related.slug}`}
                    className="rounded-2xl border bg-white p-5 font-black hover:border-orange-300"
                  >
                    {related.title}

                    <ArrowRight
                      size={14}
                      className="mt-3 text-orange-600"
                    />
                  </Link>
                ))}
              </div>
            </section>
          )}
      </article>
    </PublicPageFrame>
  );
}