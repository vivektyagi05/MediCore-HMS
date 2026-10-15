import { useEffect, useId, useState } from "react";
import { ArrowRight, CheckCircle2, Copy, Mail, MapPin, Phone, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/I18nContext";
import { publicApi } from "../../api/publicApi";
import { leadApi } from "../../api/leadApi";
import { getApiErrorMessage } from "../../api/axios";
import SEOMeta from "../../components/shared/SEOMeta";
import PublicPageFrame, { PublicCard, PublicSection } from "../../components/public/PublicPageFrame";

const initial = { name: "", email: "", phone: "", inquiryType: "general", subject: "", message: "", preferredContactMethod: "either", consent: false };
const requiredFields = ["name", "email", "inquiryType", "subject", "message", "consent"];
const publicContactValue = (value) => {
  const normalized = String(value || "").trim();
  return normalized && !normalized.includes(".example") ? normalized : "";
};

export default function Contact() {
  const { t } = useI18n();
  const formId = useId();
  const [form, setForm] = useState(initial);
  const [state, setState] = useState({ loading: false, success: null, emailNotification: null, error: "" });
  const [hospital, setHospital] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { publicApi.getHospitalInfo().then((r) => setHospital(r.data || null)).catch(() => setHospital(null)); }, []);
  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (state.loading) return;
    const missing = requiredFields.some((key) => !form[key] || (typeof form[key] === "string" && !form[key].trim()));
    if (missing || (form.preferredContactMethod === "phone" && !form.phone.trim())) { setState({ loading: false, success: null, error: t("p17.contact.invalid") }); return; }
    setState({ loading: true, success: null, error: "" });
    try {
      const response = await leadApi.create(form);
      if (!response?.success || !response?.data?.referenceId) throw new Error("Invalid lead creation response");
      setState({ loading: false, success: response.data.referenceId, emailNotification: response.data.emailNotification?.status || "unknown", error: "" });
      setForm(initial);
    } catch (error) {
      setState({ loading: false, success: null, error: error.response?.status === 429 ? t("p16.common.unavailable") : getApiErrorMessage(error) || t("p17.contact.network") });
    }
  };

  const copyReference = async () => { if (!state.success) return; try { await navigator.clipboard.writeText(state.success); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); } };
  const field = (key) => `${formId}-${key}`;

  return <PublicPageFrame>
    <SEOMeta title={t("p17.contact.eyebrow")} description={t("p17.contact.intro")} canonical="/contact" />
    <section className="public-shell px-4 pb-10 pt-16 sm:px-6 lg:px-8 lg:pt-24"><div className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[0.22em] text-orange-600">{t("p17.contact.eyebrow")}</p><h1 className="mt-5 text-5xl font-black leading-[0.98] tracking-[-0.04em] text-slate-950 sm:text-7xl">{t("p17.contact.title")}<span className="text-orange-600">{t("p17.contact.accent")}</span></h1><p className="mt-6 text-base leading-8 text-slate-600">{t("p17.contact.intro")}</p></div></section>
    <PublicSection className="pt-4"><div className="grid gap-5 lg:grid-cols-[0.75fr_1.25fr]">
      <div className="space-y-3"><PublicCard className="p-5"><p className="text-xs font-black uppercase tracking-[0.2em] text-slate-600">{t("p17.contact.channels")}</p><div className="mt-5 space-y-3">
        {[[Mail,"email",publicContactValue(hospital?.supportEmail)],[Phone,"phone",publicContactValue(hospital?.phone)],[MapPin,"timezone",publicContactValue(hospital?.timezone)]].map(([Icon,label,value]) => <div key={label} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-orange-600"><Icon size={15}/></span><div><p className="text-xs font-black uppercase tracking-wider text-slate-600">{t(`p13.contact.${label}`)}</p><p className="mt-1 text-xs font-bold text-slate-500">{value || t("p17.contact.notConfigured")}</p></div></div>)}
      </div></PublicCard><PublicCard className="p-5"><div className="flex gap-3"><ShieldAlert className="shrink-0 text-orange-500" size={18}/><div><p className="text-xs font-black text-slate-950">{t("p17.contact.sensitiveTitle")}</p><p className="mt-1 text-xs leading-5 text-slate-600">{t("p17.contact.sensitive")}</p><p className="mt-3 text-xs leading-5 text-slate-600">{t("p17.contact.privacyRedirect")} <Link to="/data-rights" className="font-bold text-orange-700 underline-offset-4 hover:underline">{t("p17.contact.dataRights")}</Link>.</p></div></div></PublicCard></div>
      <PublicCard className="p-5 sm:p-7"><div className="mb-6"><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">{t("p17.contact.formEyebrow")}</p><h2 className="mt-2 text-2xl font-black text-slate-950">{t("p17.contact.formTitle")}</h2></div>
        {state.error && <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{state.error}</div>}
        {state.success && <div role="status" aria-live="polite" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0" size={18}/><div className="min-w-0"><p className="font-black">{t("p17.contact.success")}</p><p className="mt-2 text-xs"><span className="font-bold">{t("p17.contact.reference")}:</span> {state.success}</p><button type="button" onClick={copyReference} className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold underline underline-offset-4">{copied ? t("p17.contact.copied") : t("p17.contact.copy")} <Copy size={12}/></button></div></div></div>}\n        {state.success && state.emailNotification && state.emailNotification !== "delivered" && <div role="status" aria-live="polite" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">Your enquiry was received, but the email acknowledgement service is currently unavailable. Please keep your reference ID for follow-up.</div>}
        <form onSubmit={submit} noValidate className="grid gap-4" aria-describedby={`${formId}-sensitive`}>
          <div className="grid gap-4 sm:grid-cols-2"><label htmlFor={field("name")}><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{t("p17.contact.name")} *</span><input id={field("name")} required maxLength={120} value={form.name} onChange={(e) => update("name", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-950 outline-none focus:border-orange-400/40" /></label><label htmlFor={field("email")}><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{t("p17.contact.email")} *</span><input id={field("email")} required type="email" maxLength={254} value={form.email} onChange={(e) => update("email", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-950 outline-none focus:border-orange-400/40" /></label></div>
          <div className="grid gap-4 sm:grid-cols-2"><label htmlFor={field("phone")}><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{t("p17.contact.phone")}<span className="normal-case tracking-normal text-slate-500">{t("p17.contact.optional")}</span></span><input id={field("phone")} inputMode="tel" maxLength={30} value={form.phone} onChange={(e) => update("phone", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-950 outline-none focus:border-orange-400/40" /></label><label htmlFor={field("inquiryType")}><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{t("p17.contact.inquiry")} *</span><select id={field("inquiryType")} value={form.inquiryType} onChange={(e) => update("inquiryType", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-orange-400/40">{["general","patient_support","doctor_support","hospital_partnership","business","technical","billing","privacy_data_rights","other"].map((v)=><option key={v} value={v}>{t(`p17.contact.types.${v}`)}</option>)}</select></label></div>
          <label htmlFor={field("subject")}><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{t("p17.contact.subject")} *</span><input id={field("subject")} required minLength={3} maxLength={180} value={form.subject} onChange={(e) => update("subject", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-950 outline-none focus:border-orange-400/40" /></label>
          <label htmlFor={field("message")}><span className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{t("p17.contact.message")} *</span><textarea id={field("message")} required minLength={10} maxLength={4000} value={form.message} onChange={(e) => update("message", e.target.value)} className="min-h-40 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-6 text-slate-950 outline-none focus:border-orange-400/40" /></label>
          <fieldset><legend className="mb-2 text-xs font-black uppercase tracking-wider text-slate-600">{t("p17.contact.preferred")}</legend><div className="flex flex-wrap gap-3">{["email","phone","either"].map((v)=><label key={v} className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="radio" name={`${formId}-preferred`} checked={form.preferredContactMethod===v} onChange={()=>update("preferredContactMethod",v)} value={v}/>{t(`p17.contact.methods.${v}`)}</label>)}</div></fieldset>
          <div id={`${formId}-sensitive`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">{t("p17.contact.sensitive")}</div>
          <label htmlFor={field("consent")} className="flex items-start gap-3 text-xs leading-5 text-slate-600"><input id={field("consent")} type="checkbox" checked={form.consent} onChange={(e)=>update("consent",e.target.checked)} className="mt-1"/><span>{t("p17.contact.consent")} <Link to="/privacy-policy" className="font-bold text-orange-700 underline-offset-4 hover:underline">{t("p17.contact.privacy")}</Link>.</span></label>
          <p className="text-xs leading-5 text-slate-500"><Link to="/terms" className="font-bold text-orange-700 underline-offset-4 hover:underline">{t("p17.contact.terms")}</Link> · <Link to="/data-rights" className="font-bold text-orange-700 underline-offset-4 hover:underline">{t("p17.contact.dataRights")}</Link></p>
          <button disabled={state.loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3.5 text-sm font-black text-slate-950 shadow-lg shadow-orange-500/20 disabled:cursor-not-allowed disabled:opacity-50">{state.loading ? t("p17.contact.submitting") : t("p17.contact.submit")}<ArrowRight size={15}/></button>
        </form>
      </PublicCard>
    </div></PublicSection>
  </PublicPageFrame>;
}
