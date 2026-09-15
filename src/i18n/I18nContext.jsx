/**
 * I18nContext — React provider for MediCore i18n
 *
 * Provides:
 *   t(key, params?)    — translate a key
 *   locale             — current locale string ("en" | "hi" | "hinglish")
 *   setLocale(locale)  — switch language (persists to localStorage)
 *   dir                — "ltr" | "rtl" (RTL-ready for future Arabic/Urdu)
 *   locales            — all available locales for the switcher
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  LOCALES,
  SUPPORTED_LOCALES,
  detectLocale,
  persistLocale,
  translate,
} from "./i18n.js";

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(detectLocale);

  // Apply dir attribute to <html> element (RTL-ready)
  useEffect(() => {
    const dir = LOCALES[locale]?.dir ?? "ltr";
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", locale);
  }, [locale]);

  const setLocale = useCallback((next) => {
    if (!SUPPORTED_LOCALES.includes(next)) return;
    persistLocale(next);
    setLocaleState(next);
  }, []);

  // Stable translate function bound to current locale
  const t = useCallback(
    (key, params) => translate(key, params, locale),
    [locale],
  );

  const value = useMemo(
    () => ({
      t,
      locale,
      setLocale,
      dir: LOCALES[locale]?.dir ?? "ltr",
      locales: Object.entries(LOCALES).map(([code, meta]) => ({
        code,
        label: meta.label,
        nativeLabel: meta.nativeLabel,
      })),
    }),
    [t, locale, setLocale],
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

/**
 * useI18n — primary hook for all components
 * Usage:
 *   const { t, locale, setLocale } = useI18n();
 *   t("nav.home")                  → "Home" / "होम" / "Home"
 *   t("footer.copyright", {year})  → "© 2025 MediCore HMS..."
 */
export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
};

export default I18nContext;
