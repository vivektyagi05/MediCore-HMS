import { serializeDoctorPublicProfile } from "./doctorPublicSerializer.js";
import { sanitizePlainContent } from "./contentHelpers.js";
import { serializeServicePublic } from "./servicePublicSerializer.js";

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
  return locale && locale !== "en" && source[locale] && typeof source[locale] === "object" ? source[locale] : {};
};

export const serializeArticlePublic = (article, req, locale = "en", { includeContent = false } = {}) => {
  const local = localized(article.localizedContent, locale);
  const body = sanitizePlainContent(local.content || article.content || "");
  const result = {
    id: article._id,
    slug: article.slug,
    title: local.title || article.title,
    excerpt: local.excerpt || article.excerpt || body.slice(0, 180),
    category: article.category || "",
    tags: article.tags || [],
    author: article.author && typeof article.author === "object" ? { id: article.author._id, name: article.author.name || "" } : null,
    bannerImage: absoluteUrl(article.bannerImage, req),
    publishedAt: article.publishedAt || null,
    updatedAt: article.updatedAt || null,
    readingTime: Math.max(1, Math.ceil(body.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length / 200)),
    relatedServices: (article.relatedServices || []).filter((service) => service?.status === "published" && service?.visibility === "public").map((service) => serializeServicePublic(service, req, locale)).filter(Boolean),
    relatedSpecialties: article.relatedSpecialties || [],
    relatedDoctors: (article.relatedDoctors || []).filter((doctor) => doctor?.verificationStatus === "approved" && doctor?.isActive !== false).map((doctor) => {
      const profile = serializeDoctorPublicProfile(doctor, req);
      return { id: profile.id, name: profile.name, specialization: profile.specialization, qualification: profile.qualification, city: profile.city, state: profile.state, profilePhoto: profile.profilePhoto };
    }),
    seo: {
      title: article.seo?.title || local.title || article.title,
      description: article.seo?.description || local.description || article.excerpt || body.slice(0, 160),
      canonical: article.seo?.canonical || `/articles/${article.slug}`,
      robots: article.seo?.robots || "index,follow",
    },
  };
  if (includeContent) result.content = body;
  return result;
};
