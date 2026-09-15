import { CheckCircle2, LockKeyhole, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { privacyApi } from "../../api/privacyApi";
import { getApiErrorMessage } from "../../api/axios";
import SEOMeta from "../../components/shared/SEOMeta";
import PublicPageFrame, { PublicCard, PublicSection } from "../../components/public/PublicPageFrame";

export default function PrivacyPreferences() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [state, setState] = useState({ loading: isAuthenticated, saving: false, error: "", success: "" });

  useEffect(() => {
    if (!isAuthenticated) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    let cancelled = false;
    privacyApi.getPreferences()
      .then((response) => {
        if (cancelled) return;
        setData(response.data);
        setDraft({
          analytics: Boolean(response.data.analytics),
          personalization: Boolean(response.data.personalization),
          communications: Boolean(response.data.communications),
        });
      })
      .catch((error) => {
        if (!cancelled) setState((s) => ({ ...s, error: getApiErrorMessage(error) }));
      })
      .finally(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const save = async (event) => {
    event.preventDefault();
    setState((s) => ({ ...s, saving: true, error: "", success: "" }));
    try {
      const response = await privacyApi.updatePreferences(draft);
      setData(response.data);
      setDraft({
        analytics: Boolean(response.data.analytics),
        personalization: Boolean(response.data.personalization),
        communications: Boolean(response.data.communications),
      });
      setState((s) => ({ ...s, saving: false, success: t("p16.common.saved") }));
    } catch (error) {
      setState((s) => ({ ...s, saving: false, error: getApiErrorMessage(error) }));
    }
  };

  return (
    <PublicPageFrame>
      <SEOMeta title={t("p16.nav.preferences")} description={t("p16.docs.cookie.intro")} canonical="/privacy-preferences" noIndex />
      <PublicSection className="pt-12 sm:pt-16">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-700"><SlidersHorizontal size={20} /></span>
            <div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">{t("p16.nav.preferences")}</p><h1 className="mt-1 text-3xl font-black text-slate-950 sm:text-4xl">{t("p16.nav.preferences")}</h1></div>
          </div>

          {!isAuthenticated ? (
            <PublicCard className="mt-8 p-6 sm:p-8">
              <LockKeyhole className="text-slate-700" size={24} />
              <h2 className="mt-4 text-xl font-black text-slate-950">{t("p16.common.login")}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600">{t("p16.common.preferencesAuthDesc")}</p>
              <Link to="/login?redirect=/privacy-preferences" className="mt-5 inline-flex rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-slate-950">{t("p16.common.logIn")}</Link>
            </PublicCard>
          ) : state.loading ? (
            <PublicCard className="mt-8 p-6" role="status">{t("p16.common.loading")}</PublicCard>
          ) : (
            <form onSubmit={save} className="mt-8 space-y-5">
              <PublicCard className="p-6 sm:p-8">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 shrink-0 text-emerald-600" size={22} />
                  <div><h2 className="text-xl font-black text-slate-950">{t("p16.common.essentialTitle")}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t("p16.common.essentialDesc")}</p></div>
                  <span className="ml-auto shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">{t("p16.common.enabled")}</span>
                </div>
              </PublicCard>

              <PublicCard className="p-6 sm:p-8">
                <h2 className="text-xl font-black text-slate-950">{t("p16.common.optionalTitle")}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{t("p16.common.optionalDesc")}</p>
                <div className="mt-5 space-y-3">
                  {(data?.optionalCategoriesImplemented || []).length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">{t("p16.common.notActive")}: {t("p16.common.noOptional")}</div>
                  ) : data.optionalCategoriesImplemented.map((key) => (
                    <label key={key} className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
                      <span><span className="block text-sm font-black text-slate-950">{t(`p16.common.categories.${key}.title`)}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{t(`p16.common.categories.${key}.description`)}</span></span>
                      <input type="checkbox" checked={Boolean(draft[key])} onChange={(e) => setDraft((v) => ({ ...v, [key]: e.target.checked }))} className="h-5 w-5 accent-orange-600" />
                    </label>
                  ))}
                </div>

                {state.error && <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{state.error}</div>}
                {state.success && <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700" role="status">{state.success}</div>}
                {(data?.optionalCategoriesImplemented || []).length > 0 && <button disabled={state.saving} className="mt-5 rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50">{state.saving ? t("p16.common.saving") : t("p16.common.save")}</button>}
              </PublicCard>

              <PublicCard className="p-6">
                <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-slate-500" size={18}/><p className="text-sm leading-6 text-slate-600">Policy version: <strong>{data?.policyVersion}</strong>{data?.updatedAt ? ` · updated ${new Date(data.updatedAt).toLocaleString()}` : ""}. See the <Link className="font-bold text-orange-700 underline-offset-4 hover:underline" to="/privacy-policy">Privacy Policy</Link> and <Link className="font-bold text-orange-700 underline-offset-4 hover:underline" to="/cookie-policy">Cookie Policy</Link>.</p></div>
              </PublicCard>
            </form>
          )}
        </div>
      </PublicSection>
    </PublicPageFrame>
  );
}
