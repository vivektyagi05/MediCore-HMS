import { Mail, SendHorizonal } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import SEOMeta from "../../components/shared/SEOMeta";
import AuthPageFrame from "../../components/public/AuthPageFrame";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../api/authApi";
import { useI18n } from "../../i18n/I18nContext";
import { useToast } from "../../context/ToastContext";
import { getSafeRedirectTarget, isBookingIntent } from "../../utils/bookingIntent";

function validateEmail(email, t) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return t("p15.forgotPassword.invalidEmail");
  return undefined;
}

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();

  const redirectTo = getSafeRedirectTarget(new URLSearchParams(location.search).get("redirect"));
  const bookingIntent = isBookingIntent(redirectTo);
  const safeReturnSearch = bookingIntent ? `?redirect=${encodeURIComponent(redirectTo)}` : "";

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationError = validateEmail(email, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSubmitting(true);
    setServerError("");
    try {
      const response = await authApi.forgotPassword({ email: email.trim() });
      const recovery = response.data;
      if (!response.success || !recovery?.recoveryId) {
        setServerError(t("p15.forgotPassword.codeSent"));
        toast.success(t("p15.forgotPassword.codeSent"));
        return;
      }
      toast.success(t("p15.forgotPassword.codeSent"));
      navigate("/verify-otp", {
        replace: true,
        state: { recoveryId: recovery.recoveryId, email: email.trim(), expiresInSeconds: recovery.expiresInSeconds, returnSearch: safeReturnSearch },
      });
    } catch (submitError) {
      const code = submitError.response?.data?.code;
      const status = submitError.response?.status;
      let messageKey = "p15.forgotPassword.networkError";

      if (code === "EMAIL_PROVIDER_CREDENTIAL_ERROR") {
        messageKey = "p15.forgotPassword.emailProviderCredentialError";
      } else if (code === "EMAIL_PROVIDER_RATE_LIMITED") {
        messageKey = "p15.forgotPassword.emailProviderRateLimited";
      } else if (code === "EMAIL_PROVIDER_UNREACHABLE") {
        messageKey = "p15.forgotPassword.emailProviderUnreachable";
      } else if (code === "EMAIL_PROVIDER_UNAVAILABLE" || code === "PASSWORD_RECOVERY_UNAVAILABLE") {
        messageKey = "p15.forgotPassword.recoveryUnavailable";
      } else if (status === 429) {
        messageKey = "p15.forgotPassword.tooManyRequests";
      } else if (status === 400) {
        messageKey = "p15.forgotPassword.invalidRequest";
      }

      setServerError(t(messageKey));
      toast.error(t(messageKey));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <SEOMeta title={t("p15.seo.forgotPasswordTitle")} description={t("p15.seo.forgotPasswordDescription")} canonical="/forgot-password" noIndex />
      <AuthPageFrame mode="recovery">
        <div>
          <p className="text-sm font-bold text-orange-600">{t("p15.forgotPassword.eyebrow")}</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{t("p15.forgotPassword.title")}</h2>
          <p className="mt-3 text-base leading-7 text-slate-600">{t("p15.forgotPassword.subtitle")}</p>
        </div>

        <form className="mt-6 grid gap-5" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} aria-describedby={serverError ? "recovery-error" : undefined}>
          <Input
            label={t("p15.forgotPassword.emailLabel")}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t("p15.forgotPassword.emailPlaceholder")}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError("");
              setServerError("");
            }}
            error={error}
            required
          />

          {serverError && (
            <div id="recovery-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-700" role="alert" aria-live="assertive">
              {serverError}
            </div>
          )}

          <Button type="submit" className="w-full !rounded-xl !bg-orange-500 !text-slate-950 hover:!bg-orange-600" isLoading={isSubmitting}>
            {isSubmitting ? <Mail size={18} aria-hidden="true" /> : <SendHorizonal size={18} aria-hidden="true" />}
            {isSubmitting ? t("p15.forgotPassword.submitting") : t("p15.forgotPassword.submit")}
          </Button>
        </form>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <p className="text-sm text-slate-600">
            <Link className="font-bold text-orange-600 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/20" to="/login">
              {t("p15.forgotPassword.backToLogin")}
            </Link>
          </p>
        </div>
      </AuthPageFrame>
    </>
  );
}

export default ForgotPassword;
