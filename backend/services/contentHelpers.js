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

// A-17: a URL attribute is judged the way a browser reads it: HTML entities decoded, and the ASCII tab/newline/control
// characters browsers drop inside a scheme removed (`java&#x73;cript:` and `java\tscript:` are both `javascript:`).
const NAMED_ENTITIES = { colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")" };
const decodeEntities = (text) =>
  text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi, (match, hex, dec, name) => {
    if (hex || dec) {
      const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[String(name).toLowerCase()] ?? match;
  });
// Drops every ASCII control character and space (code <= 0x20) plus DEL, as browsers do inside a URL scheme.
const urlProbe = (url) => Array.from(decodeEntities(url)).filter((ch) => ch.charCodeAt(0) > 0x20 && ch.charCodeAt(0) !== 0x7f).join("");
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

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
      const probe = urlProbe(url);
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(probe)?.[1]?.toLowerCase();
      if (scheme && !SAFE_SCHEMES.has(scheme)) return ""; // javascript:, vbscript:, data:, file:, anything not allow-listed
      if (attr.toLowerCase() === "src" && !/^(?:https?:|\/)/i.test(probe)) return "";
      return ` ${attr}="${url.replace(/"/g, "&quot;")}"`;
    })
    .replace(/<(?!\/?(?:h1|h2|h3|h4|h5|h6|p|br|ul|ol|li|strong|em|b|i|u|blockquote|a|div|span)(?:\s|\/?>))/gi, "&lt;");
};

export const effectivePublished = (doc) => {
  if (!doc) return false;
  if (doc.status) return doc.status === "published" && doc.visibility !== "private";
  return Boolean(doc.isActive ?? doc.isPublished);
};
