/**
 * AppointmentStatusTracker
 * Shows the patient their current status, what it means, what to do next,
 * and why an action may be blocked. Never leaves the patient confused.
 */
import { useI18n } from "../../i18n/I18nContext";
import { Link } from "react-router-dom";
import {
  Clock, CheckCircle2, XCircle, CreditCard, Stethoscope,
  Star, AlertCircle, RefreshCw, ArrowRight, Info
} from "lucide-react";

const useStatusConfig = () => {
  const { t } = useI18n();
  return {
    pending:               { label: t("appointmentStatus.labels.pending"),               icon: Clock,         color: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-200",   step: 1, message: t("appointmentStatus.messages.pending"),               nextAction: t("appointmentStatus.nextActions.pending"),               actionType: "info" },
    approved:              { label: t("appointmentStatus.labels.approved"),              icon: CheckCircle2,  color: "text-blue-600",    bg: "bg-blue-50",    border: "border-blue-200",    step: 2, message: t("appointmentStatus.messages.approved"),              nextAction: t("appointmentStatus.nextActions.approved"),              actionType: "payment", urgent: true },
    payment_pending:       { label: t("appointmentStatus.labels.payment_pending"),       icon: CreditCard,    color: "text-orange-600",  bg: "bg-orange-50",  border: "border-orange-200",  step: 2, message: t("appointmentStatus.messages.payment_pending"),       nextAction: t("appointmentStatus.nextActions.payment_pending"),       actionType: "payment", urgent: true },
    payment_completed:     { label: t("appointmentStatus.labels.payment_completed"),     icon: CheckCircle2,  color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", step: 3, message: t("appointmentStatus.messages.payment_completed"),     nextAction: t("appointmentStatus.nextActions.payment_completed"),     actionType: "info" },
    consultation_started:  { label: t("appointmentStatus.labels.consultation_started"),  icon: Stethoscope,   color: "text-violet-600",  bg: "bg-violet-50",  border: "border-violet-200",  step: 4, message: t("appointmentStatus.messages.consultation_started"),  nextAction: t("appointmentStatus.nextActions.consultation_started"),  actionType: "info" },
    consultation_completed:{ label: t("appointmentStatus.labels.consultation_completed"),icon: CheckCircle2,  color: "text-teal-600",    bg: "bg-teal-50",    border: "border-teal-200",    step: 5, message: t("appointmentStatus.messages.consultation_completed"),nextAction: t("appointmentStatus.nextActions.consultation_completed"),actionType: "info" },
    completed:             { label: t("appointmentStatus.labels.completed"),             icon: CheckCircle2,  color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", step: 6, message: t("appointmentStatus.messages.completed"),             nextAction: t("appointmentStatus.nextActions.completed"),             actionType: "review" },
    review_eligible:       { label: t("appointmentStatus.labels.review_eligible"),       icon: Star,          color: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-200",   step: 6, message: t("appointmentStatus.messages.review_eligible"),       nextAction: t("appointmentStatus.nextActions.review_eligible"),       actionType: "review", urgent: true },
    cancelled:             { label: t("appointmentStatus.labels.cancelled"),             icon: XCircle,       color: "text-red-600",     bg: "bg-red-50",     border: "border-red-200",     step: 0, message: t("appointmentStatus.messages.cancelled"),             nextAction: null,                                                     actionType: "cancelled" },
  };
};

const useSteps = () => {
  const { t } = useI18n();
  return [
    { key:"pending",              label: t("appointmentStatus.steps.requested") },
    { key:"approved",             label: t("appointmentStatus.steps.approved") },
    { key:"payment_completed",    label: t("appointmentStatus.steps.paid") },
    { key:"consultation_started", label: t("appointmentStatus.steps.inSession") },
    { key:"completed",            label: t("appointmentStatus.steps.done") },
  ];
};

function ProgressBar({ cfg }) {
  const STEPS = useSteps();
  if (!cfg || cfg.step === 0) return null;

  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const isActive = cfg.step > idx;
        const isCurrent = cfg.step === idx+1;
        return (
          <div key={step.key} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-black transition-all
                ${isActive ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
                  : isCurrent ? "border-2 border-blue-600 bg-white text-blue-600"
                  : "border-2 border-slate-200 bg-white text-slate-300"}`}>
                {isActive ? "✓" : idx+1}
              </div>
              {idx < STEPS.length-1 && (
                <div className={`h-0.5 flex-1 transition-all ${cfg.step > idx+1 ? "bg-blue-600" : "bg-slate-200"}`}/>
              )}
            </div>
            <p className={`mt-1.5 text-center text-xs font-semibold ${isActive ? "text-blue-600" : "text-slate-400"}`}>
              {step.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default function AppointmentStatusTracker({ appointment, onPayNow, onReview }) {
  const STATUS_CONFIG = useStatusConfig();
  if (!appointment) return null;

  const cfg = STATUS_CONFIG[appointment.status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;

  // Refund state override
  // BUGFIX: refundStatus lives on the Payment document (appointment.paymentId),
  // not on the Appointment itself — reading appointment.refundStatus directly
  // meant this banner could never appear, even when a refund was in progress.
  const refundStatus = appointment.paymentId?.refundStatus || appointment.refundStatus;
  const hasRefund = refundStatus === "pending" || refundStatus === "processing";

  return (
    <div className={`rounded-2xl border ${cfg.border} ${cfg.bg} p-5`}>
      {/* Current status badge */}
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
          <Icon size={20}/>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-black ${cfg.color}`}>{cfg.label}</span>
            {cfg.urgent && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-amber-600 shadow-sm border border-amber-200">
                <AlertCircle size={10}/> Action required
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">{cfg.message}</p>
        </div>
      </div>

      {/* Refund override */}
      {hasRefund && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <RefreshCw size={14} className="text-sky-600 flex-shrink-0"/>
          <p className="text-sm font-semibold text-sky-700">
            Your refund request is under review. Processing takes 5–7 business days.
          </p>
        </div>
      )}

      {/* Next action */}
      {cfg.nextAction && !hasRefund && (
        <div className="mt-4">
          {cfg.actionType === "payment" && onPayNow && (
            <button onClick={onPayNow}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition hover:-translate-y-0.5 hover:bg-blue-700">
              <CreditCard size={15}/> {cfg.nextAction} <ArrowRight size={14}/>
            </button>
          )}
          {cfg.actionType === "review" && onReview && (
            <button onClick={onReview}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition hover:-translate-y-0.5 hover:bg-amber-600">
              <Star size={15}/> {cfg.nextAction} <ArrowRight size={14}/>
            </button>
          )}
          {cfg.actionType === "info" && (
            <div className="flex items-center gap-2 rounded-xl bg-white/70 px-4 py-3 border border-white/50">
              <Info size={14} className={`flex-shrink-0 ${cfg.color}`}/>
              <p className="text-xs font-medium text-slate-600">{cfg.nextAction}</p>
            </div>
          )}
        </div>
      )}

      {/* Progress bar */}
      {appointment.status !== "cancelled" && (
        <div className="mt-5 border-t border-white/50 pt-5">
          <ProgressBar cfg={cfg}/>
        </div>
      )}
    </div>
  );
}
