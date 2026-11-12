import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";
import Textarea from "./Textarea";

// One dialog for every "give a reason / reference, then confirm" admin or doctor action.
//  - fields: [{ name, label, min, max, multiline, placeholder, helperText }]  (all required; trimmed; min/max enforced)
//  - onSubmit(values) must return a promise; if it throws, the message is shown INSIDE the dialog and the typed text is kept
//  - the submit button is disabled while busy, so a double click or Enter-mash cannot submit twice
//  - the form state lives here (not in the caller), so typing never re-renders the caller's page
function ReasonDialog({ isOpen, title, description, fields, confirmLabel = "Confirm", tone = "primary", onSubmit, onClose, errorMessage }) {
  const [values, setValues] = useState({});
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const busyRef = useRef(false);

  // Fresh form each time the dialog opens.
  useEffect(() => {
    if (isOpen) { setValues({}); setTouched({}); setServerError(""); setBusy(false); busyRef.current = false; }
  }, [isOpen]);

  const trimmed = (name) => String(values[name] ?? "").trim();
  const problem = (field) => {
    const v = trimmed(field.name);
    if (!v) return `${field.label} is required`;
    if (field.min && v.length < field.min) return `${field.label} must be at least ${field.min} characters (now ${v.length})`;
    if (field.max && String(values[field.name] ?? "").length > field.max) return `${field.label} must be at most ${field.max} characters`;
    return "";
  };
  const problems = Object.fromEntries((fields || []).map((f) => [f.name, problem(f)]));
  const valid = Object.values(problems).every((p) => !p);

  const submit = async (event) => {
    event?.preventDefault();
    setTouched(Object.fromEntries((fields || []).map((f) => [f.name, true])));
    if (!valid || busyRef.current) return;
    busyRef.current = true; setBusy(true); setServerError("");
    try {
      await onSubmit(Object.fromEntries((fields || []).map((f) => [f.name, trimmed(f.name)])));
    } catch (error) {
      setServerError(errorMessage ? errorMessage(error) : (error?.response?.data?.message || error?.message || "Something went wrong. Nothing was changed."));
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title={title} onClose={busy ? undefined : onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {description && <p className="text-sm leading-6 text-slate-600">{description}</p>}
        {(fields || []).map((field) => {
          const Field = field.multiline ? Textarea : Input;
          const len = String(values[field.name] ?? "").length;
          return (
            <div key={field.name}>
              <Field
                label={field.label} name={`reason-dialog-${field.name}`} required rows={field.multiline ? 3 : undefined}
                value={values[field.name] ?? ""} placeholder={field.placeholder} disabled={busy} autoComplete="off"
                maxLength={field.max ? field.max + 50 : undefined}
                helperText={!touched[field.name] || !problems[field.name] ? field.helperText : undefined}
                error={touched[field.name] ? problems[field.name] : ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                onBlur={() => setTouched((t) => ({ ...t, [field.name]: true }))}
              />
              {(field.min || field.max) && <p className="mt-1 text-right text-xs text-slate-400">{len}{field.max ? ` / ${field.max}` : ""}</p>}
            </div>
          );
        })}
        {serverError && <p role="alert" className="rounded-control border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{serverError}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={tone} isLoading={busy} disabled={busy}>{confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default ReasonDialog;
