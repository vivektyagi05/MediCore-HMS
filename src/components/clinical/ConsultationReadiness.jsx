import { useState } from "react";
import { CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import Button from "../ui/Button";
import ConfirmDialog from "../ui/ConfirmDialog";

// PHASE P6 — Consultation Readiness. Every check is real, already-loaded
// state (never a frontend-only percentage): whether a clinical note exists
// for this appointment, whether a prescription exists, and whether a
// follow-up date was actually set on that prescription. "Complete
// Consultation" only appears once the appointment has reached
// consultation_completed (same backend-eligible state the existing
// one-click action already required) — this component adds the confirm
// step and the readiness breakdown, it doesn't change the underlying
// completion rule.
function ConsultationReadiness({ hasNote, hasPrescription, hasFollowUp, onComplete, isCompleting }) {
  const [isConfirming, setIsConfirming] = useState(false);

  const checks = [
    { label: "Findings documented", done: hasNote },
    { label: "Prescription completed", done: hasPrescription },
    { label: "Follow-up addressed", done: hasFollowUp },
  ];
  const doneCount = checks.filter((c) => c.done).length;
  const isReady = doneCount === checks.length;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-2 text-sm">
            {check.done ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Circle size={16} className="text-slate-300" />}
            <span className={check.done ? "text-slate-800" : "text-slate-500"}>{check.label}</span>
          </div>
        ))}
      </div>

      <p className="text-xs font-bold text-slate-500">{doneCount} / {checks.length} complete</p>

      {!isReady && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Complete the remaining items above before finalizing this consultation.</span>
        </div>
      )}

      <Button className="w-full" disabled={!isReady} onClick={() => setIsConfirming(true)}>
        Complete Consultation
      </Button>

      <ConfirmDialog
        isOpen={isConfirming}
        title="Complete Consultation?"
        tone="primary"
        confirmLabel="Complete Consultation"
        isLoading={isCompleting}
        description="Findings, prescription, and follow-up status will be locked into the patient's record as documented. This action reflects MediCore's existing completion rules — it does not introduce a new status transition."
        onClose={() => setIsConfirming(false)}
        onConfirm={async () => {
          await onComplete();
          setIsConfirming(false);
        }}
      />
    </div>
  );
}

export default ConsultationReadiness;
