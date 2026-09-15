import { Eye, EyeOff, UserPlus } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useId, useState } from "react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import SEOMeta from "../../components/shared/SEOMeta";
import AuthPageFrame from "../../components/public/AuthPageFrame";
import { roleDashboardPath, useAuth } from "../../context/AuthContext";
import { getSafeRedirectTarget, isBookingIntent } from "../../utils/bookingIntent";
import { getAuthErrorMessage } from "../../utils/authErrors";
import { useI18n } from "../../i18n/I18nContext";
import { useToast } from "../../context/ToastContext";

const initialForm = { name: "", role: "patient", email: "", password: "", confirmPassword: "", termsAccepted: false };

function validateForm(form, t) {
  const errors = {};
  if (form.name.trim().length < 2) errors.name = t("p14.register.nameShort");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = t("p14.register.invalidEmail");
  if (form.password.length < 8) errors.password = t("p14.register.passwordShort");
  if (form.confirmPassword !== form.password) errors.confirmPassword = t("p14.register.passwordMismatch");
  if (!form.termsAccepted) errors.termsAccepted = t("p16.common.termsRequired");
  return errors;
}

function Register() {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isClearingNonPatientSession, setIsClearingNonPatientSession] = useState(false);
  const { register, logout, isAuthenticated, role } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const passwordId = useId();
  const confirmPasswordId = useId();
  const { t } = useI18n();

  const redirectTo = (() => {
    const params = new URLSearchParams(location.search);
    return getSafeRedirectTarget(params.get("redirect"));
  })();
  const bookingIntent = isBookingIntent(redirectTo);

  useEffect(() => {
    if (!isAuthenticated || !bookingIntent || role === "patient") return;
    setIsClearingNonPatientSession(true);
    logout();
  }, [bookingIntent, isAuthenticated, logout, role]);

  if (isClearingNonPatientSession && isAuthenticated) return null;
  if (isAuthenticated) return <Navigate to={redirectTo || roleDashboardPath(role)} replace />;

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setServerError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationErrors = validateForm(form, t);
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      return;
    }
    setIsSubmitting(true);
    setServerError("");
    try {
      const user = await register({ name: form.name.trim(), email: form.email.trim(), password: form.password, termsAccepted: form.termsAccepted, role: bookingIntent ? "patient" : form.role });
      if (bookingIntent && user.role !== "patient") {
        logout();
        const message = t("p12.bookingGate.patientOnlyRegister");
        setServerError(message);
        toast.error(message);
        return;
      }
      toast.success(t("auth.register.success"));
      navigate(redirectTo || roleDashboardPath(user.role), { replace: true });
    } catch (error) {
      const message = getAuthErrorMessage(error, t, "register");
      setServerError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <SEOMeta title={t("p14.seo.registerTitle")} description={t("p14.seo.registerDescription")} canonical="/register" noIndex />
      <AuthPageFrame mode="register" bookingIntent={bookingIntent}>
        <div>
          <p className="text-sm font-bold text-orange-600">{t("p14.register.eyebrow")}</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{t("p14.register.title")}</h2>
          <p className="mt-3 text-base leading-7 text-slate-600">{t("p14.register.subtitle")}</p>
        </div>

        {bookingIntent && <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold leading-6 text-sky-900" role="status">{t("p14.register.patientBooking")}</div>}

        <form className="mt-6 grid gap-5 sm:grid-cols-2" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} aria-describedby={serverError ? "auth-error" : undefined}>
          <Input label={t("p14.register.nameLabel")} name="name" autoComplete="name" placeholder={t("p14.register.namePlaceholder")} value={form.name} onChange={updateField} error={errors.name} required />
          <div>
            <label className="block" htmlFor={bookingIntent ? undefined : "account-role"}>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("p14.register.roleLabel")}<span className="ml-1 text-rose-600">*</span></span>
              {bookingIntent ? <div className="rounded-control border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm font-semibold text-sky-900">{t("p14.register.rolePatient")}</div> : (
                <select id="account-role" name="role" value={form.role} onChange={updateField} autoComplete="off" aria-describedby="role-help" className="w-full rounded-control border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-950 shadow-sm outline-none transition focus:border-royal-600 focus:ring-4 focus:ring-royal-600/10">
                  <option value="patient">{t("p14.register.rolePatient")}</option>
                  <option value="doctor">{t("p14.register.roleDoctor")}</option>
                </select>
              )}
            </label>
            <p id="role-help" className="mt-1.5 text-sm leading-5 text-slate-500">{t("p14.register.secureNote")}</p>
          </div>
          <div className="sm:col-span-2"><Input label={t("p14.register.emailLabel")} name="email" type="email" inputMode="email" autoComplete="email" placeholder={t("p14.register.emailPlaceholder")} value={form.email} onChange={updateField} error={errors.email} required /></div>
          <div className="relative">
            <Input id={passwordId} label={t("p14.register.passwordLabel")} name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder={t("p14.register.passwordPlaceholder")} value={form.password} onChange={updateField} error={errors.password} required />
            <button type="button" aria-label={showPassword ? t("p14.register.hidePassword") : t("p14.register.showPassword")} aria-controls={passwordId} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-[34px] rounded-lg p-2 text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-4 focus-visible:ring-orange-500/20">
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
          <div className="relative">
            <Input id={confirmPasswordId} label={t("p14.register.confirmPasswordLabel")} name="confirmPassword" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" placeholder={t("p14.register.confirmPasswordPlaceholder")} value={form.confirmPassword} onChange={updateField} error={errors.confirmPassword} required />
            <button type="button" aria-label={showConfirmPassword ? t("p14.register.hidePassword") : t("p14.register.showPassword")} aria-controls={confirmPasswordId} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((value) => !value)} className="absolute right-2 top-[34px] rounded-lg p-2 text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-4 focus-visible:ring-orange-500/20">
              {showConfirmPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-sm leading-6 text-slate-600">
              <input type="checkbox" name="termsAccepted" checked={form.termsAccepted} onChange={(e) => updateField({ target: { name: "termsAccepted", value: e.target.checked } })} className="mt-1 h-4 w-4 shrink-0 accent-orange-600" aria-invalid={Boolean(errors.termsAccepted)} />
              <span>{t("p16.common.termsAcceptance")} <Link to="/terms" className="font-bold text-orange-700 underline-offset-4 hover:underline">{t("p16.common.termsLink")}</Link> · <Link to="/privacy-policy" className="font-bold text-orange-700 underline-offset-4 hover:underline">{t("p16.common.privacyLink")}</Link>.</span>
            </label>
            {errors.termsAccepted && <p className="mt-1.5 text-sm font-semibold text-rose-700" role="alert">{errors.termsAccepted}</p>}
          </div>
          {serverError && <div id="auth-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-700 sm:col-span-2" role="alert" aria-live="assertive">{serverError}</div>}
          <div className="sm:col-span-2"><Button type="submit" className="w-full !rounded-xl !bg-orange-500 !text-slate-950 hover:!bg-orange-600" isLoading={isSubmitting} aria-describedby={serverError ? "auth-error" : undefined}><UserPlus size={18} aria-hidden="true" />{isSubmitting ? t("p14.register.submitting") : t("p14.register.submit")}</Button></div>
        </form>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <p className="text-sm text-slate-600">{t("p14.register.haveAccount")} {" "}<Link className="font-bold text-orange-600 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/20" to={`/login${location.search}`}>{t("p14.register.signIn")}</Link></p>
          <p className="mt-3 text-sm leading-6 text-slate-500">{t("p14.register.doctorNote")}</p>
        </div>
      </AuthPageFrame>
    </>
  );
}

export default Register;
