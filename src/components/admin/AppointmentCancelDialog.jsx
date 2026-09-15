import { adminApi } from "../../api/adminApi";
import CancelAppointmentDialog from "../shared/CancelAppointmentDialog";

// Phase DOC-04: now a thin wrapper over the shared
// shared/CancelAppointmentDialog.jsx (previously this file WAS the modal —
// extracted so the doctor-facing cancel flow doesn't duplicate the same
// modal markup). Public props (appointment/mode/onClose/onDone) are
// unchanged, so AdminAppointments.jsx and AppointmentDetailWorkspace.jsx
// need no changes.
function AppointmentCancelDialog({ appointment, mode = "cancel", onClose, onDone }) {
  return (
    <CancelAppointmentDialog
      appointment={appointment}
      mode={mode}
      onClose={onClose}
      onConfirm={async (reason) => {
        const res = await adminApi.cancelAppointmentAdmin(appointment._id, reason);
        onDone?.();
        return res;
      }}
    />
  );
}

export default AppointmentCancelDialog;
