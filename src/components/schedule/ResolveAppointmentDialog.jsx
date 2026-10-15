import { useState } from "react";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Textarea from "../ui/Textarea";

const OUTCOMES = [
  { value: "attended", label: "The consultation took place", hint: "Records it as consultation completed. Add documentation afterwards. Requires a paid appointment." },
  { value: "patient_no_show", label: "Patient did not attend", hint: "Closes the appointment. No penalty or automatic refund is applied." },
  { value: "doctor_no_show", label: "I was unable to attend", hint: "Closes the appointment and raises a refund request for the patient." },
  { value: "cancelled", label: "Cancel this appointment", hint: "Closes the appointment and raises a refund request if it was paid." },
];

/** Explicit "Resolve missed appointment" workflow. The backend decides whether each outcome is allowed. */
export default function ResolveAppointmentDialog({ item, onClose, onDone }) {
  const [outcome, setOutcome] = useState("attended");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!item) return null;
  const submit = async () => {
    if (!note.trim()) { setError("Please add a short note explaining the resolution."); return; }
    setBusy(true); setError("");
    try { await appointmentApi.resolveAppointment(item.appointmentId, { outcome, note: note.trim() }); onDone?.(); }
    catch (err) { setError(getApiErrorMessage(err)); }
    finally { setBusy(false); }
  };
  const selected = OUTCOMES.find((o) => o.value === outcome);

  return (
    <Modal isOpen onClose={onClose} title="Resolve missed appointment">
      <p className="text-sm text-slate-600">{item.patientName} · {new Date(item.date).toLocaleDateString()} · {item.timeSlot}</p>
      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">Outcome</legend>
        {OUTCOMES.map((o) => (
          <label key={o.value} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${outcome === o.value ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>
            <input type="radio" name="outcome" className="mt-1" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
            <span><span className="font-bold text-slate-900">{o.label}</span></span>
          </label>
        ))}
      </fieldset>
      {selected && <p className="mt-2 text-xs text-slate-500">{selected.hint}</p>}
      <div className="mt-4"><Textarea label="Note (required)" name="resolutionNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
        <Button onClick={submit} disabled={busy}>{busy ? "Resolving…" : "Resolve"}</Button>
      </div>
    </Modal>
  );
}
