import { serializeDoctorPublicProfile } from "./doctorPublicSerializer.js";

const absoluteUrl = (value, req) => {
  if (!value) return "";
  const stringValue = String(value);
  if (/^https?:\/\//i.test(stringValue)) return stringValue;
  if (!req) return stringValue.startsWith("/") ? stringValue : `/${stringValue}`;
  const protocol = req.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || req.protocol;
  return `${protocol}://${req.get("host")}${stringValue.startsWith("/") ? stringValue : `/${stringValue}`}`;
};

const localized = (value, locale) => {
  const source = value || {};
  if (locale && locale !== "en" && source[locale] && typeof source[locale] === "object") return source[locale];
  return {};
};

export const serializeServicePublic = (service, req, locale = "en") => {
  const local = localized(service.localizedContent, locale);
  return {
    id: service._id,
    title: local.title || service.title,
    slug: service.slug || String(service.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    shortDescription: local.shortDescription || service.shortDescription || service.description,
    description: local.description || service.description,
    benefits: Array.isArray(local.benefits) && local.benefits.length ? local.benefits : service.benefits || [],
    eligibility: local.eligibility || service.eligibility || "",
    preparation: local.preparation || service.preparation || "",
    procedureInformation: local.procedureInformation || service.procedureInformation || "",
    duration: local.duration || service.duration || "",
    consultationModes: service.consultationModes || [],
    price: service.price,
    category: service.category,
    relatedSpecialties: service.relatedSpecialties || [],
    relatedDoctors: (service.relatedDoctors || []).map((doctor) => {
      const profile = serializeDoctorPublicProfile(doctor, req);
      return { id: profile.id, name: profile.name, specialization: profile.specialization, qualification: profile.qualification, city: profile.city, state: profile.state, profilePhoto: profile.profilePhoto };
    }),
    relatedServices: (service.relatedServices || []).map((item) => ({ id: item._id, title: item.title, slug: item.slug || "" })),
    image: absoluteUrl(service.image, req),
    icon: service.icon || "",
    featured: Boolean(service.featured),
    seo: {
      title: service.seo?.title || local.title || service.title,
      description: service.seo?.description || local.description || service.description,
      canonical: service.seo?.canonical || `/services/${service.slug || ""}`,
      robots: service.seo?.robots || "index,follow",
    },
    createdAt: service.createdAt || null,
    updatedAt: service.updatedAt || null,
  };
};
