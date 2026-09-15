/**
 * i18n.js — Zero-dependency i18n engine for MediCore HMS
 *
 * Features:
 * - Nested key access: t("home.hero.badge")
 * - Interpolation:     t("footer.copyright", { year: 2024 })
 * - Pluralization:     t("doctorSearch.subtitle", { count: 5 }) → uses subtitle_plural if count !== 1
 * - Automatic fallback: missing key → English → key path string
 * - RTL-ready: each locale declares `dir: "ltr" | "rtl"`
 */

import en from "./locales/en.js";
import hi from "./locales/hi.js";
import hinglish from "./locales/hinglish.js";

// ─── Registry ────────────────────────────────────────────────────────────────
// Adding a new language = adding ONE entry here. No other code changes needed.
export const LOCALES = {
  en:       { label: "English",   nativeLabel: "English",   translations: en,       dir: "ltr" },
  hi:       { label: "Hindi",     nativeLabel: "हिन्दी",    translations: hi,       dir: "ltr" },
  hinglish: { label: "Hinglish", nativeLabel: "Hinglish",  translations: hinglish, dir: "ltr" },
};

export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = Object.keys(LOCALES);
export const STORAGE_KEY = "medicore_locale";

// ─── Key resolver ────────────────────────────────────────────────────────────

/**
 * Resolve a dot-separated key path from a translations object.
 * Returns undefined if the key is not found.
 */
const resolve = (obj, path) => {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
};

// ─── Interpolation ───────────────────────────────────────────────────────────

/**
 * Replace {{key}} tokens in a string.
 * Example: interpolate("Hello {{name}}", { name: "Priya" }) → "Hello Priya"
 */
const interpolate = (str, params) => {
  if (!params || typeof str !== "string") return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{{${key}}}`,
  );
};

// ─── Core translate function ─────────────────────────────────────────────────

/**
 * t(key, params?, locale?) → translated string
 *
 * Pluralization: if params.count is provided and count !== 1,
 * tries `${key}_plural` before falling back to `${key}`.
 *
 * Fallback chain: requested locale → English → key path itself
 */
export const translate = (key, params, locale = DEFAULT_LOCALE) => {
  const translations = LOCALES[locale]?.translations;
  const fallback     = LOCALES[DEFAULT_LOCALE]?.translations;

  // Pluralization support
  const effectiveKey =
    params?.count !== undefined && params.count !== 1
      ? resolve(translations, `${key}_plural`) !== undefined
        ? `${key}_plural`
        : key
      : key;

  const raw =
    resolve(translations, effectiveKey) ??
    resolve(fallback,     effectiveKey) ??
    resolve(translations, key) ??
    resolve(fallback,     key) ??
    key; // last resort: return the key path itself

  return interpolate(raw, params);
};

// ─── Locale detection ────────────────────────────────────────────────────────

export const detectLocale = () => {
  // 1. Persisted preference
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LOCALES.includes(stored)) return stored;

  // 2. Browser language hint
  const browserLang = navigator.language?.split("-")[0]?.toLowerCase();
  if (browserLang && SUPPORTED_LOCALES.includes(browserLang)) return browserLang;

  return DEFAULT_LOCALE;
};

export const persistLocale = (locale) => {
  localStorage.setItem(STORAGE_KEY, locale);
};
