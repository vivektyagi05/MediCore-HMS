import { Calendar, LogIn, ShieldCheck, Star, Clock, UserPlus, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import { useI18n } from "../../i18n/I18nContext";
import { useAuth } from "../../context/AuthContext";
import { buildBookingReturnPath } from "../../utils/bookingIntent";

export default function BookingAuthGate({
  isOpen,
  onClose,
  doctorId,
  doctorName,
  specialization,
  consultationMode,
  date,
  timeSlot,
}) {
  const { t } = useI18n();
  const { isAuthenticated, role, logout } = useAuth();
  const navigate = useNavigate();
  const returnPath = buildBookingReturnPath({ doctorId, consultationMode, date, timeSlot });
  const hasNonPatientSession = isAuthenticated && role !== "patient";

  const continueAsPatient = (target = "/login") => {
    if (hasNonPatientSession) logout();
    onClose?.();
    navigate(`${target}?redirect=${encodeURIComponent(returnPath)}`, { replace: true });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={hasNonPatientSession ? t("p12.bookingGate.roleTitle") : t("p12.bookingGate.title")}>
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-black text-white">
            {doctorName ? doctorName.split(" ").map((n) => n[0]).join("").slice(0, 2) : t("p12.bookingGate.doctor")}
          </span>
          <div>
            <p className="font-bold text-slate-950">{doctorName || t("p12.bookingGate.doctor")}</p>
            {specialization && <p className="text-xs text-slate-500">{specialization}</p>}
          </div>
          <Calendar size={18} className="ml-auto shrink-0 text-blue-400" />
        </div>

        {hasNonPatientSession ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex gap-3">
              <LogOut size={17} className="mt-0.5 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-bold text-amber-900">{t("p12.bookingGate.roleMessage", { role: t(`p12.roles.${role}`, role) })}</p>
                <p className="mt-1 text-xs leading-5 text-amber-800">{t("p12.bookingGate.roleDescription")}</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {[
                [ShieldCheck, t("p12.bookingGate.trust.verified")],
                [Star, t("p12.bookingGate.trust.reviews")],
                [Clock, t("p12.bookingGate.trust.cancel")],
              ].map(([Icon, text]) => (
                <div key={text} className="flex items-center gap-2 text-sm text-slate-600">
                  <Icon size={14} className="shrink-0 text-blue-500" />
                  {text}
                </div>
              ))}
            </div>
            <p className="border-t border-slate-200/60 pt-4 text-center text-sm font-semibold text-slate-600">
              {t("p12.bookingGate.signInPrompt")}
            </p>
          </>
        )}

        <div className="space-y-3">
          <Button onClick={() => continueAsPatient("/login")} className="w-full justify-center">
            {hasNonPatientSession ? <LogOut size={16} /> : <LogIn size={16} />}
            {hasNonPatientSession ? t("p12.bookingGate.continueAsPatient") : t("p12.bookingGate.login")}
          </Button>
          <Button onClick={() => continueAsPatient("/register")} variant="secondary" className="w-full justify-center">
            <UserPlus size={16} /> {t("p12.bookingGate.register")}
          </Button>
        </div>

        <p className="text-center text-xs text-slate-400">{t("p12.bookingGate.terms")}</p>
      </div>
    </Modal>
  );
}
