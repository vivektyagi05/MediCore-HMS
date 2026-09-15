import { Download, FileText, LockKeyhole, MessageSquareWarning, Send, ShieldCheck, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { privacyApi } from "../../api/privacyApi";
import { getApiErrorMessage } from "../../api/axios";
import SEOMeta from "../../components/shared/SEOMeta";
import PublicPageFrame, { PublicCard, PublicSection } from "../../components/public/PublicPageFrame";

const requestTypes = [
  ["access", "requestAccess"],
  ["correction", "requestCorrection"],
  ["deletion", "requestDeletion"],
  ["consent_withdrawal", "requestConsent"],
  ["other", "requestOther"],
];

const statusClass = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  in_review: "bg-sky-50 text-sky-800 border-sky-200",
  resolved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rejected: "bg-rose-50 text-rose-800 border-rose-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function DataRights() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ requestType: "access", description: "", currentPassword: "" });
  const [grievance, setGrievance] = useState({ email: "", description: "" });
  const [state, setState] = useState({ loading: isAuthenticated, submitting: false, exporting: false, error: "", success: "" });
  const [grievanceState, setGrievanceState] = useState({ submitting: false, error: "", success: "" });
  const [contact, setContact] = useState(null);

  const loadRequests = () => {
    if (!isAuthenticated) return;
    setState((s) => ({ ...s, loading: true, error: "" }));
    privacyApi.getRequests()
      .then((response) => setRequests(response.data || []))
      .catch((error) => setState((s) => ({ ...s, error: getApiErrorMessage(error) })))
      .finally(() => setState((s) => ({ ...s, loading: false })));
  };

  useEffect(() => {
    if (isAuthenticated) {
      setState((s) => ({ ...s, loading: true }));
      privacyApi.getRequests()
        .then((response) => setRequests(response.data || []))
        .catch((error) => setState((s) => ({ ...s, error: getApiErrorMessage(error) })))
        .finally(() => setState((s) => ({ ...s, loading: false })));
    } else {
      setState((s) => ({ ...s, loading: false }));
    }
    privacyApi.getPublicConfig().then((response) => setContact(response.data)).catch(() => {});
  }, [isAuthenticated]);

  const submitRequest = async (event) => {
    event.preventDefault();
    setState((s) => ({ ...s, submitting: true, error: "", success: "" }));
    try {
      const response = await privacyApi.createRequest(form);
      setState((s) => ({ ...s, submitting: false, success: `${response.message} · ${response.data.id}` }));
      setForm((v) => ({ ...v, description: "", currentPassword: "" }));
      loadRequests();
    } catch (error) {
      setState((s) => ({ ...s, submitting: false, error: getApiErrorMessage(error) }));
    }
  };

  const exportData = async () => {
    setState((s) => ({ ...s, exporting: true, error: "", success: "" }));
    try {
      const response = await privacyApi.exportData();
      const blob = response.data;
      if (!(blob instanceof Blob) || blob.size === 0 || !String(blob.type || "").toLowerCase().includes("application/json")) {
        throw new Error(t("p16.common.exportInvalid"));
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `medicore-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setState((s) => ({ ...s, exporting: false, success: t("p16.common.exportReady") }));
    } catch (error) {
      setState((s) => ({ ...s, exporting: false, error: getApiErrorMessage(error) }));
    }
  };

  const submitGrievance = async (event) => {
    event.preventDefault();
    setGrievanceState({ submitting: true, error: "", success: "" });
    try {
      const response = await privacyApi.submitGrievance(grievance);
      setGrievance({ email: "", description: "" });
      setGrievanceState({ submitting: false, error: "", success: `${response.message} · ${response.data.id}` });
    } catch (error) {
      setGrievanceState({ submitting: false, error: getApiErrorMessage(error), success: "" });
    }
  };

  return (
    <PublicPageFrame>
      <SEOMeta title={t("p16.nav.rights")} description={t("p16.docs.dataRights.intro")} canonical="/data-rights" noIndex />
      <PublicSection className="pt-12 sm:pt-16">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-700"><ShieldCheck size={20}/></span>
            <div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">{t("p16.nav.rights")}</p><h1 className="mt-1 text-3xl font-black text-slate-950 sm:text-4xl">{t("p16.docs.dataRights.title")}</h1></div>
          </div>
          <p className="mt-5 max-w-3xl text-base leading-8 text-slate-600">{t("p16.docs.dataRights.intro")}</p>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <PublicCard className="p-6">
              <FileText className="text-orange-600" size={22}/>
              <h2 className="mt-4 text-xl font-black text-slate-950">{t("p16.common.accessExport")}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600">{t("p16.docs.dataRights.sections.access.1")}</p>
              {isAuthenticated ? (
                <button type="button" onClick={exportData} disabled={state.exporting} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50"><Download size={16}/>{state.exporting ? t("p16.common.exporting") : t("p16.common.export")}</button>
              ) : <Link to="/login?redirect=/data-rights" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white"><LockKeyhole size={16}/> {t("p16.common.login")}</Link>}
              <p className="mt-4 text-xs leading-5 text-slate-500">{t("p16.common.exportNote")}</p>
            </PublicCard>

            {isAuthenticated ? (
              <PublicCard className="p-6">
                <Trash2 className="text-rose-600" size={22}/>
                <h2 className="mt-4 text-xl font-black text-slate-950">{t("p16.common.submitRequestTitle")}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-600">{t("p16.common.requestBound")}</p>
                <form onSubmit={submitRequest} className="mt-5 space-y-3">
                  <label className="block"><span className="mb-1.5 block text-sm font-bold text-slate-700">{t("p16.common.requestType")}</span><select value={form.requestType} onChange={(e) => setForm((v) => ({ ...v, requestType: e.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm font-semibold text-slate-950">{requestTypes.map(([value,label]) => <option key={value} value={value}>{t(`p16.common.${label}`)}</option>)}</select></label>
                  <label className="block"><span className="mb-1.5 block text-sm font-bold text-slate-700">{t("p16.common.description")}</span><textarea required minLength={5} maxLength={4000} value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} className="min-h-28 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm leading-6 text-slate-950 outline-none focus:border-orange-500" /></label>
                  {form.requestType === "deletion" && <label className="block"><span className="mb-1.5 block text-sm font-bold text-slate-700">{t("p16.common.password")}</span><input required type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm((v) => ({ ...v, currentPassword: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm text-slate-950 outline-none focus:border-orange-500" /></label>}
                  {state.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{state.error}</div>}
                  {state.success && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{state.success}</div>}
                  <button disabled={state.submitting} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50"><Send size={16}/>{state.submitting ? t("p16.common.submitting") : t("p16.common.submit")}</button>
                </form>
              </PublicCard>
            ) : (
              <PublicCard className="p-6">
                <LockKeyhole className="text-slate-700" size={22}/>
                <h2 className="mt-4 text-xl font-black text-slate-950">{t("p16.common.authRequired")}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-600">{t("p16.common.authRequiredDesc")}</p>
                <Link to="/login?redirect=/data-rights" className="mt-5 inline-flex rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-950">{t("p16.common.login")}</Link>
              </PublicCard>
            )}
          </div>

          {isAuthenticated && <PublicCard className="mt-5 p-6">
            <h2 className="text-xl font-black text-slate-950">{t("p16.common.history")}</h2>
            {state.loading ? <p className="mt-4 text-sm text-slate-500" role="status">{t("p16.common.loading")}</p> : requests.length === 0 ? <p className="mt-4 text-sm text-slate-500">{t("p16.common.noRequests")}</p> : <div className="mt-4 space-y-3">{requests.map((request) => <div key={request.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-black text-slate-950">{t(`p16.common.requestTypes.${request.requestType}`)}</span><span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusClass[request.status] || statusClass.pending}`}>{t(`p16.common.statuses.${request.status}`)}</span></div><p className="mt-2 text-sm leading-6 text-slate-600">{request.description}</p><p className="mt-2 text-xs text-slate-500">{new Date(request.requestedAt).toLocaleString()} · {t("p16.common.policyVersion")}: {request.policyVersion}</p></div>)}</div>}
          </PublicCard>}

          <PublicCard className="mt-5 p-6 sm:p-7">
            <div className="flex items-start gap-3"><MessageSquareWarning className="mt-0.5 shrink-0 text-orange-600" size={22}/><div><h2 className="text-xl font-black text-slate-950">{t("p16.common.grievance")}</h2><p className="mt-2 text-sm leading-7 text-slate-600">{t("p16.docs.dataRights.sections.grievance.1")}</p>{contact?.privacyContactEmail && <p className="mt-2 text-sm font-bold text-slate-700">{t("p16.common.privacyContact")}: <a className="text-orange-700 underline-offset-4 hover:underline" href={`mailto:${contact.privacyContactEmail}`}>{contact.privacyContactEmail}</a></p>}
              {contact?.grievanceContactEmail && <p className="mt-1 text-sm font-bold text-slate-700">{t("p16.common.grievanceContact")}: <a className="text-orange-700 underline-offset-4 hover:underline" href={`mailto:${contact.grievanceContactEmail}`}>{contact.grievanceContactEmail}</a></p>}</div></div>
            <form onSubmit={submitGrievance} className="mt-5 grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1.5 block text-sm font-bold text-slate-700">{t("p16.common.email")}</span><input required type="email" value={grievance.email} onChange={(e) => setGrievance((v) => ({ ...v, email: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm text-slate-950 outline-none focus:border-orange-500"/></label>
              <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-bold text-slate-700">{t("p16.common.description")}</span><textarea required minLength={10} maxLength={4000} value={grievance.description} onChange={(e) => setGrievance((v) => ({ ...v, description: e.target.value }))} className="min-h-28 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm leading-6 text-slate-950 outline-none focus:border-orange-500"/></label>
              {grievanceState.error && <div className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{grievanceState.error}</div>}
              {grievanceState.success && <div className="sm:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700" role="status">{grievanceState.success}</div>}
              <button disabled={grievanceState.submitting} className="inline-flex w-fit items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50"><Send size={16}/>{grievanceState.submitting ? t("p16.common.submitting") : t("p16.common.submit")}</button>
            </form>
          </PublicCard>

          <div className="mt-5 flex flex-wrap gap-3 text-sm">
            <Link to="/privacy-policy" className="font-bold text-orange-700 underline-offset-4 hover:underline">{t("p16.nav.privacy")}</Link>
            <Link to="/cookie-policy" className="font-bold text-orange-700 underline-offset-4 hover:underline">{t("p16.nav.cookies")}</Link>
            <Link to="/privacy-preferences" className="font-bold text-orange-700 underline-offset-4 hover:underline">{t("p16.nav.preferences")}</Link>
          </div>
        </div>
      </PublicSection>
    </PublicPageFrame>
  );
}
