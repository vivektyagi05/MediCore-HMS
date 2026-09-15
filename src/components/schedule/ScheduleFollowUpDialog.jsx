import { CalendarPlus } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import Textarea from "../ui/Textarea";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";

function toInputDate(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Phase DOC-07 final pass — Follow-up → Real Scheduling.
// This is the ONE place a follow-up gets turned into a real appointment:
// Follow-up Queue (dashboard) and the Patient Profile's Follow-up Status
// card both open this same dialog rather than each growing their own
// booking logic. Slots come from GET /doctor/schedule/day — the exact same
// buildDayCapacity engine the Today/Week/Month views and patient booking
// all read from — so a slot offered here can never be rejected by the
// backend for "not actually available".
function ScheduleFollowUpDialog({ target, onClose, onScheduled }) {
  const toast = useToast();
  const [date, setDate] = useState(() => toInputDate(new Date()));
  const [timeSlot, setTimeSlot] = useState("");
  const [reason, setReason] = useState("");
  const [day, setDay] = useState(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) {
      setDate(toInputDate(new Date()));
      setTimeSlot("");
      setReason(target.diagnosis ? `Follow-up: ${target.diagnosis}` : "Follow-up consultation");
    }
  }, [target]);

  useEffect(() => {
    if (!target || !date) return;
    setDayLoading(true);
    setDayError("");
    setTimeSlot("");
    doctorWorkflowApi
      .getScheduleDay(date)
      .then((res) => setDay(res.data))
      .catch((err) => setDayError(getApiErrorMessage(err)))
      .finally(() => setDayLoading(false));
  }, [target, date]);

  const availableSlots = (day?.timeline || []).filter((t) => t.status === "available").map((t) => t.slot);

  const unavailableMessage = day?.unavailableReason
    ? day.unavailableReason === "blocked_date"
      ? "This date is blocked on your calendar."
      : day.unavailableReason === "on_leave"
        ? "You are on approved leave this day."
        : "Not a configured working day."
    : null;

  const handleConfirm = async () => {
    if (!date || !timeSlot) {
      toast.error("Pick a date and an open time slot");
      return;
    }
    setSubmitting(true);
    try {
      const res = await doctorWorkflowApi.scheduleFollowUp(target.patientId, {
        date,
        timeSlot,
        reason: reason.trim() || "Follow-up consultation",
        prescriptionId: target.prescriptionId,
      });
      toast.success(res.message || "Follow-up appointment scheduled");
      onScheduled?.(res.data?.appointment);
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Could not schedule this follow-up.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={Boolean(target)} title="Schedule follow-up" onClose={onClose}>
      {target && (
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm text-slate-600">
            <CalendarPlus size={16} className="mt-0.5 shrink-0 text-royal-600" />
            Booking a real follow-up appointment for <strong>{target.patientName}</strong>. It will appear on your
            schedule and the patient will be notified immediately.
          </p>

          <label className="block text-sm font-semibold text-slate-700">
            Date
            <input
              type="date"
              value={date}
              min={toInputDate(new Date())}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1.5 w-full rounded-control border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-royal-600 focus:ring-4 focus:ring-royal-600/10"
            />
          </label>

          <Select
            label="Time slot"
            value={timeSlot}
            onChange={(e) => setTimeSlot(e.target.value)}
            disabled={dayLoading || Boolean(dayError) || Boolean(unavailableMessage)}
            helperText={
              dayLoading
                ? "Loading your real availability for this date..."
                : dayError
                  ? undefined
                  : unavailableMessage
                    ? unavailableMessage
                    : availableSlots.length === 0
                      ? "No open slots left on this date — try another day."
                      : undefined
            }
            error={dayError || undefined}
          >
            <option value="">{dayLoading ? "Loading..." : "Select a time slot"}</option>
            {availableSlots.map((slot) => (
              <option key={slot} value={slot}>
                {slot}
              </option>
            ))}
          </Select>

          <Textarea
            label="Reason / notes"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this follow-up is needed..."
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" disabled={submitting} onClick={onClose}>
              Cancel
            </Button>
            <Button isLoading={submitting} disabled={!timeSlot} onClick={handleConfirm}>
              Confirm Appointment
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default ScheduleFollowUpDialog;
