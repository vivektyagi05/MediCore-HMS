import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useId, useState } from "react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import SEOMeta from "../../components/shared/SEOMeta";
import AuthPageFrame from "../../components/public/AuthPageFrame";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../api/authApi";
import { useI18n } from "../../i18n/I18nContext";
import { useToast } from "../../context/ToastContext";

function validateForm(form, t) {
  const errors = {};
  if (form.newPassword.length < 8) errors.newPassword = t("p15.resetPassword.passwordShort");
  if (form.confirmPassword !== form.newPassword) errors.confirmPassword = t("p15.resetPassword.passwordMismatch");
  return errors;
}

function ResetPassword() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const { t } = useI18n();
  const passwordId = useId();
  const confirmPasswordId = useId();

  const resetToken = location.state?.resetToken || "";
  const returnSearch = location.state?.returnSearch || "";
  const [form, setForm] = useState({ newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;
  // No resetToken means this page was opened without completing OTP
  // verification (refresh, bookmark, tampering) — never accept a password
  // change here without one.
  if (!resetToken) return <Navigate to="/forgot-password" replace />;

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
      await authApi.resetPassword({ resetToken, newPassword: form.newPassword });
      setIsDone(true);
      toast.success(t("p15.resetPassword.success"));
    } catch {
      // Covers expired/already-used/invalid reset session uniformly — the
      // backend never distinguishes these to the client (see backend
      // CHANGELOG "Reset authorization is not the OTP").
      setServerError(t("p15.resetPassword.invalidSession"));
      toast.error(t("p15.resetPassword.invalidSession"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <SEOMeta title={t("p15.seo.resetPasswordTitle")} description={t("p15.seo.resetPasswordDescription")} canonical="/reset-password" noIndex />
      <AuthPageFrame mode="recovery">
        {isDone ? (
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <KeyRound size={22} aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-950">{t("p15.resetPassword.doneTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t("p15.resetPassword.doneSubtitle")}</p>
            <Button to={`/login${returnSearch}`} className="mt-6 w-full !rounded-xl !bg-orange-500 !text-slate-950 hover:!bg-orange-600">
              {t("p15.resetPassword.returnToLogin")}
            </Button>
          </div>
        ) : (
          <>
            <div>
              <p className="text-sm font-bold text-orange-600">{t("p15.resetPassword.eyebrow")}</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{t("p15.resetPassword.title")}</h2>
              <p className="mt-3 text-base leading-7 text-slate-600">{t("p15.resetPassword.subtitle")}</p>
            </div>

            <form className="mt-6 grid gap-5" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} aria-describedby={serverError ? "reset-error" : undefined}>
              <div className="relative">
                <Input
                  id={passwordId}
                  label={t("p15.resetPassword.newPasswordLabel")}
                  name="newPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={t("p15.resetPassword.newPasswordPlaceholder")}
                  value={form.newPassword}
                  onChange={updateField}
                  error={errors.newPassword}
                  required
                />
                <button type="button" aria-label={showPassword ? t("p14.login.hidePassword") : t("p14.login.showPassword")} aria-controls={passwordId} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-[34px] rounded-lg p-2 text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-4 focus-visible:ring-orange-500/20">
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>

              <div className="relative">
                <Input
                  id={confirmPasswordId}
                  label={t("p15.resetPassword.confirmPasswordLabel")}
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={t("p15.resetPassword.confirmPasswordPlaceholder")}
                  value={form.confirmPassword}
                  onChange={updateField}
                  error={errors.confirmPassword}
                  required
                />
                <button type="button" aria-label={showConfirmPassword ? t("p14.login.hidePassword") : t("p14.login.showPassword")} aria-controls={confirmPasswordId} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((value) => !value)} className="absolute right-2 top-[34px] rounded-lg p-2 text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-4 focus-visible:ring-orange-500/20">
                  {showConfirmPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>

              <p className="text-xs leading-5 text-slate-500">{t("p15.resetPassword.requirements")}</p>

              {serverError && (
                <div id="reset-error" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-700" role="alert" aria-live="assertive">
                  {serverError}
                </div>
              )}

              <Button type="submit" className="w-full !rounded-xl !bg-orange-500 !text-slate-950 hover:!bg-orange-600" isLoading={isSubmitting}>
                <KeyRound size={18} aria-hidden="true" />
                {isSubmitting ? t("p15.resetPassword.submitting") : t("p15.resetPassword.submit")}
              </Button>
            </form>

            <div className="mt-6 border-t border-slate-200 pt-5">
              <p className="text-sm text-slate-600">
                <Link to={`/login${returnSearch}`} className="font-bold text-orange-600 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/20">
                  {t("p15.resetPassword.backToLogin")}
                </Link>
              </p>
            </div>
          </>
        )}
      </AuthPageFrame>
    </>
  );
}

export default ResetPassword;
