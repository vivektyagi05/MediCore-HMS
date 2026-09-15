import { ShieldCheck } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import Button from "../../components/ui/Button";
import OtpInput from "../../components/auth/OtpInput";
import SEOMeta from "../../components/shared/SEOMeta";
import AuthPageFrame from "../../components/public/AuthPageFrame";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../api/authApi";
import { useI18n } from "../../i18n/I18nContext";
import { useToast } from "../../context/ToastContext";

const RESEND_COOLDOWN_SECONDS = 60;

const maskEmail = (email) => {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return email || "";
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(local.length - 1, 3))}@${domain}`;
};

function VerifyOtp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const { t } = useI18n();

  const [recoveryId, setRecoveryId] = useState(location.state?.recoveryId || "");
  const [email] = useState(location.state?.email || "");
  const [returnSearch] = useState(location.state?.returnSearch || "");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(location.state?.expiresInSeconds || 600);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const tickRef = useRef(null);

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setSecondsLeft((value) => Math.max(value - 1, 0));
      setResendCooldown((value) => Math.max(value - 1, 0));
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, []);

  if (isAuthenticated) return <Navigate to="/" replace />;
  // No recoveryId in state means this page was opened directly (refresh,
  // bookmark) rather than reached via the forgot-password step — send the
  // person back to request a fresh code instead of showing a dead form.
  if (!recoveryId) return <Navigate to="/forgot-password" replace />;

  const expired = secondsLeft <= 0;
  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (otp.length !== 6) {
      setError(t("p15.verifyOtp.invalidLength"));
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const response = await authApi.verifyPasswordResetOtp({ recoveryId, otp });
      toast.success(t("p15.verifyOtp.verified"));
      navigate("/reset-password", {
        replace: true,
        state: { resetToken: response.data.resetToken, returnSearch },
      });
    } catch (submitError) {
      const status = submitError.response?.status;
      if (status === 429) {
        setError(t("p15.verifyOtp.tooManyAttempts"));
      } else if (!submitError.response) {
        setError(t("p15.verifyOtp.networkError"));
      } else if (status === 400) {
        setError(t("p15.verifyOtp.invalidCode"));
      } else {
        setError(t("p15.verifyOtp.serverError"));
      }
      setOtp("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isResending) return;
    setIsResending(true);
    setError("");
    try {
      const response = await authApi.forgotPassword({ email });
      if (!response.success || !response.data?.recoveryId) {
        throw new Error("Recovery session was not created.");
      }
      setRecoveryId(response.data.recoveryId);
      setSecondsLeft(response.data.expiresInSeconds || 600);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setOtp("");
      toast.success(t("p15.verifyOtp.codeResent"));
    } catch (submitError) {
      const code = submitError.response?.data?.code;
      const status = submitError.response?.status;
      if (code === "EMAIL_PROVIDER_CREDENTIAL_ERROR") {
        toast.error(t("p15.verifyOtp.emailProviderCredentialError"));
      } else if (code === "EMAIL_PROVIDER_RATE_LIMITED" || status === 429) {
        toast.error(t("p15.verifyOtp.tooManyRequests"));
      } else if (code === "EMAIL_PROVIDER_UNREACHABLE") {
        toast.error(t("p15.verifyOtp.emailProviderUnreachable"));
      } else if (code === "EMAIL_PROVIDER_UNAVAILABLE" || code === "PASSWORD_RECOVERY_UNAVAILABLE") {
        toast.error(t("p15.verifyOtp.recoveryUnavailable"));
      } else if (!submitError.response) {
        toast.error(t("p15.verifyOtp.networkError"));
      } else {
        toast.error(t("p15.verifyOtp.resendFailed"));
      }
    } finally {
      setIsResending(false);
    }
  };

  return (
    <>
      <SEOMeta title={t("p15.seo.verifyOtpTitle")} description={t("p15.seo.verifyOtpDescription")} canonical="/verify-otp" noIndex />
      <AuthPageFrame mode="recovery">
        <div>
          <p className="text-sm font-bold text-orange-600">{t("p15.verifyOtp.eyebrow")}</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{t("p15.verifyOtp.title")}</h2>
          <p className="mt-3 text-base leading-7 text-slate-600">
            {t("p15.verifyOtp.subtitle")}{email ? ` ${maskEmail(email)}` : ""}
          </p>
        </div>

        <form className="mt-6 grid gap-5" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
          <OtpInput label={t("p15.verifyOtp.codeLabel")} value={otp} onChange={setOtp} error={error} disabled={isSubmitting} />

          <div className="flex items-center justify-between text-sm" role="status" aria-live="polite">
            <span className={expired ? "font-semibold text-rose-600" : "text-slate-500"}>
              {expired ? t("p15.verifyOtp.expired") : `${t("p15.verifyOtp.expiresIn")} ${minutes}:${seconds}`}
            </span>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0 || isResending}
              className="font-bold text-orange-600 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/20 disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
            >
              {isResending
                ? t("p15.verifyOtp.resending")
                : resendCooldown > 0
                  ? `${t("p15.verifyOtp.resendIn")} ${resendCooldown}s`
                  : t("p15.verifyOtp.resend")}
            </button>
          </div>

          <Button type="submit" className="w-full !rounded-xl !bg-orange-500 !text-slate-950 hover:!bg-orange-600" isLoading={isSubmitting} disabled={expired}>
            <ShieldCheck size={18} aria-hidden="true" />
            {isSubmitting ? t("p15.verifyOtp.submitting") : t("p15.verifyOtp.submit")}
          </Button>
        </form>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <p className="text-sm text-slate-600">
            <Link className="font-bold text-orange-600 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/20" to="/forgot-password">
              {t("p15.verifyOtp.useAnotherEmail")}
            </Link>
          </p>
        </div>
      </AuthPageFrame>
    </>
  );
}

export default VerifyOtp;
