const normalizeOrigin = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return "";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
};

const configuredOrigin = normalizeOrigin(import.meta.env.VITE_SITE_URL);

export const SEO_SITE_ORIGIN = configuredOrigin;

export const getSeoOrigin = () => {
  if (SEO_SITE_ORIGIN) return SEO_SITE_ORIGIN;
  if (typeof window !== "undefined") {
    const runtimeOrigin = normalizeOrigin(window.location.origin);
    if (runtimeOrigin) return runtimeOrigin;
  }
  return "";
};

export const buildPublicUrl = (path = "") => {
  const origin = getSeoOrigin();
  const normalizedPath = String(path || "").trim();
  if (!origin) return "";
  if (!normalizedPath) return `${origin}/`;
  return `${origin}/${normalizedPath.replace(/^\/+/, "")}`;
};

export const buildAssetUrl = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return buildPublicUrl(raw);
};

export const isConfiguredSeoOrigin = () => Boolean(SEO_SITE_ORIGIN);
