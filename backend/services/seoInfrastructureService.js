import Doctor from "../models/Doctor.js";
import Service from "../models/Service.js";
import CMSPage from "../models/CMSPage.js";
import HospitalSetting from "../models/HospitalSetting.js";
import { serializeDoctorPublicProfile } from "./doctorPublicSerializer.js";
import { serializeServicePublic } from "./servicePublicSerializer.js";
import { serializeArticlePublic } from "./articlePublicSerializer.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const normalizeOrigin = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return "";
    if (LOCAL_HOSTS.has(url.hostname)) return "";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
};

export const getSeoOrigin = (req) => {
  const configured = normalizeOrigin(process.env.SEO_SITE_URL || process.env.FRONTEND_URL || "");
  if (configured) return configured;
  if (req?.headers?.host) {
    const protocol = req.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || req.protocol;
    const runtime = normalizeOrigin(`${protocol}://${req.get("host")}`);
    if (runtime) return runtime;
  }
  return "";
};

export const publicUrl = (origin, path = "") => {
  if (!origin) return "";
  const clean = String(path || "").trim();
  return `${origin}/${clean.replace(/^\/+/, "")}`;
};

const publicServiceFilter = {
  $or: [
    { status: "published", visibility: "public" },
    { status: { $exists: false }, isActive: true },
  ],
};

const publicArticleFilter = {
  $or: [
    { status: "published", visibility: "public", isPublished: true },
    { status: "published", visibility: "public", isPublished: { $exists: false } },
    { status: { $exists: false }, isPublished: true },
  ],
};

const publicDoctorFilter = {
  isVerified: true,
  verificationStatus: "approved",
  isActive: true,
};

const xmlEscape = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

export const buildRobotsTxt = (origin) => {
  const lines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin/",
    "Disallow: /doctor/",
    "Disallow: /patient/",
    "Disallow: /api/",
    "Disallow: /login",
    "Disallow: /register",
    "Disallow: /forgot-password",
    "Disallow: /verify-otp",
    "Disallow: /reset-password",
    "Disallow: /privacy-preferences",
    "Disallow: /data-rights",
    "Disallow: /invoices/",
  ];
  if (origin) lines.push(`Sitemap: ${publicUrl(origin, "/sitemap.xml")}`);
  return `${lines.join("\n")}\n`;
};

const urlEntry = (loc, lastmod) => [
  "  <url>",
  `    <loc>${xmlEscape(loc)}</loc>`,
  lastmod ? `    <lastmod>${new Date(lastmod).toISOString()}</lastmod>` : "",
  "  </url>",
].filter(Boolean).join("\n");

export const buildSitemapXml = async (req) => {
  const origin = getSeoOrigin(req);
  if (!origin) return null;

  const [doctors, services, articles] = await Promise.all([
    Doctor.find(publicDoctorFilter)
      .select("_id userId specialization qualification city state bio hospitalName profilePhoto updatedAt")
      .populate("userId", "name")
      .sort({ _id: 1 })
      .lean(),
    Service.find(publicServiceFilter)
      .select("slug status visibility isActive updatedAt")
      .sort({ slug: 1 })
      .lean(),
    CMSPage.find(publicArticleFilter)
      .select("slug status visibility isPublished updatedAt publishedAt contentType")
      .sort({ slug: 1 })
      .lean(),
  ]);

  const entries = [
    ["/", null],
    ["/doctors", null],
    ["/services", null],
    ["/articles", null],
    ["/about", null],
    ["/contact", null],
    ...doctors.map((doctor) => [`/doctors/${doctor._id}`, doctor.updatedAt]),
    ...services.filter((service) => service.slug).map((service) => [`/services/${service.slug}`, service.updatedAt]),
    ...articles.filter((article) => article.slug && (article.contentType === "article" || article.contentType == null))
      .map((article) => [`/articles/${article.slug}`, article.updatedAt || article.publishedAt]),
  ];

  const unique = new Map(entries.map(([path, lastmod]) => [path, lastmod]));
  const body = [...unique.entries()].map(([path, lastmod]) => urlEntry(publicUrl(origin, path), lastmod)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
};

export const getHomeSeoData = async (req) => {
  const origin = getSeoOrigin(req);
  const settings = await HospitalSetting.findOne({ singletonKey: "global" })
    .select("logoUrl supportEmail phone")
    .lean();

  const usableEmail = settings?.supportEmail && !/\.example$/i.test(settings.supportEmail)
    ? settings.supportEmail
    : "";
  const usablePhone = settings?.phone || "";
  const logo = settings?.logoUrl
    ? (/^https?:\/\//i.test(settings.logoUrl)
      ? settings.logoUrl
      : origin ? publicUrl(origin, settings.logoUrl) : "")
    : "";

  return {
    origin,
    organization: {
      name: "MediCore",
      ...(origin ? { url: origin } : {}),
      ...(logo ? { logo } : {}),
      ...(usableEmail || usablePhone ? {
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          ...(usableEmail ? { email: usableEmail } : {}),
          ...(usablePhone ? { telephone: usablePhone } : {}),
        },
      } : {}),
    },
  };
};

export const serializeSeoResource = (type, document, req, locale = "en") => {
  if (type === "doctor") return serializeDoctorPublicProfile(document, req);
  if (type === "service") return serializeServicePublic(document, req, locale);
  if (type === "article") return serializeArticlePublic(document, req, locale);
  return null;
};
