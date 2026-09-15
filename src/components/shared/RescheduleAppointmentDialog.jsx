import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import Textarea from "../ui/Textarea";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";

function toInputDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

// Phase DOC-04: rescheduling didn't exist anywhere in the codebase before
// this phase (audited — no model field, no endpoint, no UI). Real slots
// only — reuses the exact same getAvailableSlots endpoint the booking flow
// uses, so a doctor can never propose a slot the backend would reject.
function RescheduleAppointmentDialog({ appointment, onClose, onDone }) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [reason, setReason] = useState("");
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (appointment) {
      setDate(toInputDate(appointment.date));
      setTimeSlot("");
      setReason("");
    }
  }, [appointment]);

  const fetchSlotsForDate = (targetDate) => {
    if (!appointment || !targetDate) return;
    setSlotsLoading(true);
    setSlotsError("");
    return appointmentApi
      .getAvailableSlots(appointment.doctorId?._id || appointment.doctorId, targetDate)
      .then((res) => {
        // The appointment's own current slot is still "taken" by itself in
        // this query (it's an active appointment), so it correctly won't
        // appear unless the doctor picks a different date — that's the
        // right behavior, not a bug: picking the same slot on the same day
        // isn't a reschedule.
        setSlots(res.data?.slots || []);
      })
      .catch((err) => setSlotsError(getApiErrorMessage(err)))
      .finally(() => setSlotsLoading(false));
  };

  useEffect(() => {
    fetchSlotsForDate(date);
  }, [appointment, date]);

  const handleConfirm = async () => {
    if (!date || !timeSlot) {
      toast.error("Pick a new date and time slot");
      return;
    }
    setSubmitting(true);
    try {
      const res = await appointmentApi.rescheduleAppointment(appointment._id, { date, timeSlot, reason: reason.trim() });
      toast.success(res.message || "Appointment rescheduled");
      onDone?.();
    } catch (err) {
      // BUGFIX (Phase P4 audit, brief §10): a lost double-booking race here
      // used to be a dead-end toast — the stale slot list stayed on screen
      // and the now-conflicting slot stayed selected, so resubmitting would
      // just fail again. Mirrors BookAppointment.jsx's existing SLOT_CONFLICT
      // recovery: refresh real availability for the same date and clear the
      // selection so the doctor can immediately pick a slot that's actually
      // still open, instead of having to close and reopen the dialog.
      if (err?.response?.data?.details?.code === "SLOT_CONFLICT") {
        toast.error(getApiErrorMessage(err));
        setTimeSlot("");
        await fetchSlotsForDate(date);
        return;
      }
      toast.error(getApiErrorMessage(err) || "Could not reschedule this appointment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={Boolean(appointment)} title="Reschedule appointment" onClose={onClose}>
      {appointment && (
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm text-slate-600">
            <CalendarClock size={16} className="mt-0.5 shrink-0 text-royal-600" />
            Currently {new Date(appointment.date).toLocaleDateString()} at {appointment.timeSlot}. The patient will be
            notified of the new time.
          </p>

          <label className="block text-sm font-semibold text-slate-700">
            New date
            <input
              type="date"
              value={date}
              min={toInputDate(new Date())}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1.5 w-full rounded-control border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-royal-600 focus:ring-4 focus:ring-royal-600/10"
            />
          </label>

          <Select
            label="New time slot"
            value={timeSlot}
            onChange={(e) => setTimeSlot(e.target.value)}
            disabled={slotsLoading || Boolean(slotsError)}
            helperText={
              slotsLoading
                ? "Loading real availability for this date..."
                : slotsError
                  ? undefined
                  : slots.length === 0
                    ? "No open slots for this date."
                    : undefined
            }
            error={slotsError || undefined}
          >
            <option value="">{slotsLoading ? "Loading..." : "Select a time slot"}</option>
            {slots.map((slot) => (
              <option key={slot} value={slot}>
                {slot}
              </option>
            ))}
          </Select>

          <Textarea
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Let the patient know why the time is changing..."
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" disabled={submitting} onClick={onClose}>
              Back
            </Button>
            <Button isLoading={submitting} disabled={!timeSlot} onClick={handleConfirm}>
              Confirm New Time
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default RescheduleAppointmentDialog;
