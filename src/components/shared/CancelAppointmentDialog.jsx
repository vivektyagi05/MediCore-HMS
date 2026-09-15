import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Textarea from "../ui/Textarea";
import { useToast } from "../../context/ToastContext";
import { getApiErrorMessage } from "../../api/axios";

// Phase DOC-04: extracted from admin/AppointmentCancelDialog.jsx so the
// doctor-facing cancel flow (which now genuinely requires a reason, going
// through the same backend cancelAppointmentCore the admin path already
// uses) doesn't duplicate this modal a second time. `onConfirm` is the only
// thing that differs per caller — admin calls adminApi.cancelAppointmentAdmin,
// the doctor pages call appointmentApi.cancelAppointment.
//
// mode: "reject" (pending -> cancelled) or "cancel" (approved+ -> cancelled).
// Both use the exact same backend transition — the wording is the only
// difference, matching the fact that there is only one real transition
// here, not two.
function CancelAppointmentDialog({ appointment, mode = "cancel", onClose, onConfirm, successMessage }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (mode !== "patient" && !reason.trim()) {
      toast.error("A reason is required");
      return;
    }
    setLoading(true);
    try {
      const res = await onConfirm(reason.trim());
      toast.success(res?.message || successMessage || (mode === "reject" ? "Appointment rejected" : "Appointment cancelled"));
      setReason("");
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Appointment could not be cancelled.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={Boolean(appointment)}
      title={mode === "reject" ? "Reject appointment" : "Cancel appointment"}
      onClose={() => {
        setReason("");
        onClose();
      }}
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-slate-600">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
          {mode === "patient" ? "You can cancel this appointment if the current appointment policy allows it." : "The patient will be notified. If payment was already made, a refund request will be created automatically for admin review."}
        </p>
        <Textarea
          label="Reason"
          required={mode !== "patient"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={mode === "patient" ? "Optional reason" : "Explain why this appointment is being cancelled..."}
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => {
              setReason("");
              onClose();
            }}
          >
            Back
          </Button>
          <Button variant="danger" isLoading={loading} onClick={handleConfirm}>
            {mode === "reject" ? "Reject Appointment" : "Cancel Appointment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default CancelAppointmentDialog;
