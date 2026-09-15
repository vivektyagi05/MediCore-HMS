/**
 * Canonical frontend SEO abstraction.
 *
 * One component owns document title, metadata, canonical URL and JSON-LD.
 * It is intentionally dependency-free so every public route uses the same
 * head-management contract.
 */
import { useEffect } from "react";
import { buildAssetUrl, buildPublicUrl } from "../../config/seo";

const DEFAULT = {
  title: "MediCore",
  description: "MediCore public healthcare discovery and appointment platform.",
};

const removeMeta = (name, prop = false) => {
  const attr = prop ? "property" : "name";
  document.querySelectorAll(`meta[${attr}="${name}"]`).forEach((el) => el.remove());
};

const setMeta = (name, content, prop = false) => {
  if (content === undefined || content === null || content === "") {
    removeMeta(name, prop);
    return;
  }
  const attr = prop ? "property" : "name";
  const matches = document.querySelectorAll(`meta[${attr}="${name}"]`);
  const el = matches[0] || document.createElement("meta");
  matches.forEach((node, index) => { if (index > 0) node.remove(); });
  if (!el.parentNode) document.head.appendChild(el);
  el.setAttribute(attr, name);
  el.setAttribute("content", String(content));
};

const setCanonical = (href) => {
  document.querySelectorAll('link[rel="canonical"]').forEach((el, index) => {
    if (index > 0) el.remove();
  });
  if (!href) {
    document.querySelectorAll('link[rel="canonical"]').forEach((el) => el.remove());
    return;
  }
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};

const setJsonLd = (data) => {
  const id = "medicore-jsonld";
  let el = document.getElementById(id);
  if (!data) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("script");
    el.id = id;
    el.setAttribute("type", "application/ld+json");
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
};

const normalizeRobots = ({ noIndex, robots }) => {
  if (robots) return robots;
  return noIndex ? "noindex,follow" : "index,follow";
};

const resolveCanonical = (canonical) => {
  if (!canonical) return buildPublicUrl(typeof window !== "undefined" ? window.location.pathname : "/");
  if (/^https?:\/\//i.test(canonical)) return canonical;
  return buildPublicUrl(canonical);
};

export default function SEOMeta({
  title,
  description,
  canonical,
  image,
  imageAlt,
  type = "website",
  robots,
  noIndex = false,
  locale,
  alternateLocales = [],
  jsonLd,
}) {
  const fullTitle = title || DEFAULT.title;
  const desc = description || DEFAULT.description;
  const url = resolveCanonical(canonical);
  const img = buildAssetUrl(image);
  const robotValue = normalizeRobots({ noIndex, robots });

  useEffect(() => {
    document.title = fullTitle;
    setMeta("description", desc);
    setCanonical(url);

    setMeta("robots", robotValue);
    setMeta("og:title", fullTitle, true);
    setMeta("og:description", desc, true);
    setMeta("og:url", url, true);
    setMeta("og:type", type, true);
    setMeta("og:image", img, true);
    setMeta("og:image:alt", imageAlt || fullTitle, true);
    setMeta("og:site_name", "MediCore", true);

    setMeta("twitter:card", img ? "summary_large_image" : "summary");
    setMeta("twitter:title", fullTitle);
    setMeta("twitter:description", desc);
    setMeta("twitter:image", img);
    setMeta("twitter:image:alt", imageAlt || fullTitle);

    if (locale) setMeta("og:locale", locale.replace("-", "_"), true);
    else removeMeta("og:locale", true);

    const alternates = Array.isArray(alternateLocales) ? alternateLocales : [];
    document.querySelectorAll('link[data-medicore-hreflang="true"]').forEach((el) => el.remove());
    alternates.filter((item) => item?.href && item?.hreflang).forEach(({ href, hreflang }) => {
      const link = document.createElement("link");
      link.rel = "alternate";
      link.hreflang = hreflang;
      link.href = href;
      link.dataset.medicoreHreflang = "true";
      document.head.appendChild(link);
    });

    if (jsonLd) {
      const values = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
      const cleaned = values.filter(Boolean).map((item) => ({ "@context": "https://schema.org", ...item }));
      setJsonLd(cleaned.length === 1 ? cleaned[0] : cleaned);
    } else {
      setJsonLd(null);
    }

    return () => {
      document.querySelectorAll('link[data-medicore-hreflang="true"]').forEach((el) => el.remove());
    };
  }, [fullTitle, desc, url, img, imageAlt, type, robotValue, locale, alternateLocales, jsonLd]);

  return null;
};

export const buildOrganizationJsonLd = ({ name = "MediCore", url, logo, description, contactPoint, sameAs } = {}) => ({
  "@type": "Organization",
  name,
  ...(url ? { url } : {}),
  ...(logo ? { logo } : {}),
  ...(description ? { description } : {}),
  ...(contactPoint ? { contactPoint } : {}),
  ...(Array.isArray(sameAs) && sameAs.length ? { sameAs } : {}),
});

export const buildWebSiteJsonLd = ({ url, searchPath } = {}) => ({
  "@type": "WebSite",
  name: "MediCore",
  ...(url ? { url } : {}),
  ...(searchPath && url ? {
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${url}${searchPath}{search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  } : {}),
});

export const buildBreadcrumbJsonLd = (items = []) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.filter((item) => item?.name && item?.url).map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: /^https?:\/\//i.test(item.url) ? item.url : buildPublicUrl(item.url),
  })),
});

export const buildDoctorJsonLd = (doctor) => {
  const result = {
    "@type": "Physician",
    name: doctor.name,
    ...(doctor.profilePhoto ? { image: doctor.profilePhoto } : {}),
    ...(doctor.bio ? { description: doctor.bio } : {}),
    ...(doctor.specialization ? { medicalSpecialty: doctor.specialization } : {}),
    ...(doctor.city || doctor.state ? {
      address: {
        "@type": "PostalAddress",
        ...(doctor.city ? { addressLocality: doctor.city } : {}),
        ...(doctor.state ? { addressRegion: doctor.state } : {}),
        addressCountry: "IN",
      },
    } : {}),
    ...(doctor.hospitalName ? { worksFor: { "@type": "Hospital", name: doctor.hospitalName } } : {}),
    ...(doctor.id ? { url: buildPublicUrl(`/doctors/${doctor.id}`) } : {}),
  };
  return result;
};

export const buildDoctorListJsonLd = (doctors = []) => ({
  "@type": "ItemList",
  name: "Verified Doctors on MediCore",
  itemListElement: doctors.slice(0, 10).map((doctor, index) => ({
    "@type": "ListItem",
    position: index + 1,
    item: {
      "@type": "Physician",
      name: doctor.name,
      ...(doctor.specialization ? { medicalSpecialty: doctor.specialization } : {}),
      ...(doctor.id ? { url: buildPublicUrl(`/doctors/${doctor.id}`) } : {}),
    },
  })),
});
