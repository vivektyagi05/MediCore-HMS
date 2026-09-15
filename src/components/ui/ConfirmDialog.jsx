import Modal from "./Modal";
import Button from "./Button";

// Styled confirmation-dialog primitive for destructive/high-stakes
// actions. This phase establishes the primitive itself; existing
// window.confirm() call sites in business pages (AdminDoctors,
// AdminPatients, AdminReviews, AdminProcessDesigner, AdminCMS,
// PatientRecords, PatientFamily, PatientInsurance) are intentionally left
// untouched here — rewiring each one is page-level work for their
// individual redesign phases, not the global foundation.
function ConfirmDialog({
  isOpen,
  title = "Are you sure?",
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  isLoading = false,
  onConfirm,
  onClose,
}) {
  return (
    <Modal isOpen={isOpen} title={title} onClose={onClose}>
      {description && <p className="text-sm leading-6 text-slate-600">{description}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={isLoading}>
          {cancelLabel}
        </Button>
        <Button variant={tone} onClick={onConfirm} isLoading={isLoading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
