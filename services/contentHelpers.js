import mongoose from "mongoose";

export const slugify = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 160);

export const stringArray = (value, max = 30) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, max);
};

export const objectIdArray = (value, max = 30) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => mongoose.Types.ObjectId.isValid(item)).map((item) => String(item)))].slice(0, max);
};

export const normalizeSeo = (value = {}) => ({
  title: String(value.title || "").trim().slice(0, 160),
  description: String(value.description || "").trim().slice(0, 320),
  canonical: String(value.canonical || "").trim().slice(0, 500),
  robots: value.robots === "noindex,nofollow" ? "noindex,nofollow" : "index,follow",
});

export const sanitizePlainContent = (value = "") => {
  const input = String(value || "").trim();
  if (!input) return "";

  // CMS content is intentionally constrained to a small allowlist. This keeps
  // the existing textarea/RichTextEditor representation compatible while
  // preventing scripts, event handlers, unsafe URLs, frames and arbitrary
  // embedded markup from reaching the public renderer.
  return input
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|option|meta|link)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_match, attr, dq, sq, bare) => {
      const url = String(dq ?? sq ?? bare ?? "").trim();
      if (/^(?:javascript|vbscript|data):/i.test(url)) return "";
      if (attr.toLowerCase() === "src" && !/^(?:https?:|\/)/i.test(url)) return "";
      return ` ${attr}="${url.replace(/"/g, "&quot;")}"`;
    })
    .replace(/<(?!\/?(?:h1|h2|h3|h4|h5|h6|p|br|ul|ol|li|strong|em|b|i|u|blockquote|a|div|span)(?:\s|\/?>))/gi, "&lt;");
};

export const effectivePublished = (doc) => {
  if (!doc) return false;
  if (doc.status) return doc.status === "published" && doc.visibility !== "private";
  return Boolean(doc.isActive ?? doc.isPublished);
};
