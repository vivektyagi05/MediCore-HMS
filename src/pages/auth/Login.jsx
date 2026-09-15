import { Eye, EyeOff, LogIn } from "lucide-react";
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

const initialForm = { email: "", password: "" };

function validateForm(form, t) {
  const errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = t("p14.login.invalidEmail");
  if (!form.password) errors.password = t("p14.login.passwordRequired");
  return errors;
}

function Login() {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isClearingNonPatientSession, setIsClearingNonPatientSession] = useState(false);
  const { login, logout, isAuthenticated, role } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const passwordId = useId();
  const { t } = useI18n();

  const redirectTo = (() => {
    const params = new URLSearchParams(location.search);
    const qRedirect = params.get("redirect");
    const stateFrom = location.state?.from;
    const stateRedirect = stateFrom?.pathname
      ? `${stateFrom.pathname}${stateFrom.search || ""}${stateFrom.hash || ""}`
      : null;
    return getSafeRedirectTarget(qRedirect || stateRedirect);
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
      const user = await login({ email: form.email.trim(), password: form.password });
      if (bookingIntent && user.role !== "patient") {
        logout();
        const message = t("p14.login.roleBookingError");
        setServerError(message);
        toast.error(message);
        return;
      }
      toast.success(t("auth.login.success"));
      navigate(redirectTo || roleDashboardPath(user.role), { replace: true });
    } catch (error) {
      const message = getAuthErrorMessage(error, t, "login");
      setServerError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <SEOMeta title={t("p14.seo.loginTitle")} description={t("p14.seo.loginDescription")} canonical="/login" noIndex />
      <AuthPageFrame mode="login" bookingIntent={bookingIntent}>
        <div>
          <p className="text-sm font-bold text-orange-600">{t("p14.login.eyebrow")}</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{t("p14.login.title")}</h2>
          <p className="mt-3 text-base leading-7 text-slate-600">{t("p14.login.subtitle")}</p>
        </div>

        {bookingIntent && <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold leading-6 text-sky-900" role="status">{t("p14.login.bookingNote")}</div>}

        <form className="mt-6 grid gap-5" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} aria-describedby={serverError ? "auth-error" : undefined}>
          <Input label={t("p14.login.emailLabel")} name="email" type="email" inputMode="email" autoComplete="email" placeholder={t("p14.login.emailPlaceholder")} value={form.email} onChange={updateField} error={errors.email} required />
          <div className="relative">
            <Input id={passwordId} label={t("p14.login.passwordLabel")} name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder={t("p14.login.passwordPlaceholder")} value={form.password} onChange={updateField} error={errors.password} required />
            <button type="button" aria-label={showPassword ? t("p14.login.hidePassword") : t("p14.login.showPassword")} aria-controls={passwordId} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-[34px] rounded-lg p-2 text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-4 focus-visible:ring-orange-500/20">
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>

          <div className="-mt-2 text-right">
            <Link className="text-sm font-bold text-orange-600 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/20" to="/forgot-password">
              {t("p15.login.forgotPassword")}
            </Link>
          </div>

          {serverError && <div id="auth-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-700" role="alert" aria-live="assertive">{serverError}</div>}

          <Button type="submit" className="w-full !rounded-xl !bg-orange-500 !text-slate-950 hover:!bg-orange-600" isLoading={isSubmitting} aria-describedby={serverError ? "auth-error" : undefined}>
            <LogIn size={18} aria-hidden="true" />
            {isSubmitting ? t("p14.login.submitting") : t("p14.login.submit")}
          </Button>
        </form>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <p className="text-sm text-slate-600">{t("p14.login.noAccount")} {" "}<Link className="font-bold text-orange-600 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/20" to={`/register${location.search}`}>{t("p14.login.createAccount")}</Link></p>
          <p className="mt-3 text-sm leading-6 text-slate-500">{t("p14.login.secureNote")}</p>
        </div>
      </AuthPageFrame>
    </>
  );
}

export default Login;
