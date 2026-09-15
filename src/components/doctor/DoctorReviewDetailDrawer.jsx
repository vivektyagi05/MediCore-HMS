import { ExternalLink, Pin, Star, User } from "lucide-react";
import { useState } from "react";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import StatusBadge from "../ui/StatusBadge";
import Textarea from "../ui/Textarea";

function StarRow({ rating, size = 18 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={size}
          fill={star <= rating ? "currentColor" : "none"}
          className={star <= rating ? "text-amber-500" : "text-slate-300"}
        />
      ))}
    </div>
  );
}

// PHASE DOC-05, Step 6/7/8 — "entering a focused workspace." Renders only
// what the review list already returned (userId/appointmentId are already
// populated by buildDoctorReviewIntelligence) and deep-links to the real
// Patient Relationship Center / Clinical Workspace for anything deeper,
// rather than duplicating them — same convention as
// DoctorAppointmentDetailDrawer. Response composing is real: no fake submit
// state, and once a reply exists it is read-only here because the backend
// itself refuses a second reply (replyToReview, 409) — no edit button is
// shown for a workflow the API cannot perform.
function DoctorReviewDetailDrawer({ review, onClose, onReply, onTogglePin, replyingId, pinningId }) {
  const [draft, setDraft] = useState("");

  if (!review) return null;

  const patient = review.userId;
  const appointment = review.appointmentId;
  const isReplying = replyingId === review._id;
  const isPinning = pinningId === review._id;

  const handleSend = async () => {
    if (!draft.trim()) return;
    await onReply(review._id, draft.trim());
    setDraft("");
  };

  return (
    <Modal isOpen={Boolean(review)} title="Review" onClose={onClose} size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-bold text-slate-950">{patient?.name || "Patient"}</h3>
              {review.isPinned && (
                <span className="flex items-center gap-1 text-xs font-bold text-amber-600">
                  <Pin size={12} className="fill-amber-400" /> Pinned
                </span>
              )}
              {review.rating <= 2 && <StatusBadge tone="danger">Negative</StatusBadge>}
              {!review.doctorReply?.message && <StatusBadge tone="warning">Awaiting reply</StatusBadge>}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {new Date(review.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
              {review.isEdited && " · edited by the patient"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StarRow rating={review.rating} />
            <span className="text-sm font-bold text-slate-700">{review.rating}/5</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {patient?._id && (
            <Button variant="secondary" size="sm" to={`/doctor/patients/${patient._id}`}>
              <User size={14} /> View Patient
            </Button>
          )}
          {patient?._id && (
            <Button variant="secondary" size="sm" to={`/doctor/clinical?patientId=${patient._id}&tab=history`}>
              <ExternalLink size={14} /> Open Clinical Workspace
            </Button>
          )}
          <Button
            variant={review.isPinned ? "primary" : "secondary"}
            size="sm"
            onClick={() => onTogglePin(review._id)}
            disabled={isPinning}
            isLoading={isPinning}
          >
            <Pin size={14} /> {review.isPinned ? "Unpin" : "Pin as reference"}
          </Button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-black uppercase tracking-wide text-slate-400">What the patient said</p>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            {review.comment || <span className="text-slate-400">No written comment was left with this review.</span>}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-400">Visit context</p>
          {appointment ? (
            <p className="mt-2 text-sm font-semibold text-slate-700">
              {new Date(appointment.date).toLocaleDateString()} · {appointment.timeSlot}
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-400">Appointment record unavailable</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">Your response</p>
          {review.doctorReply?.message ? (
            <div className="rounded-2xl bg-blue-50 p-4">
              <p className="text-xs font-black uppercase text-blue-700">Doctor Reply</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{review.doctorReply.message}</p>
              {review.doctorReply.repliedAt && (
                <p className="mt-2 text-xs text-slate-500">
                  Sent {new Date(review.doctorReply.repliedAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea
                placeholder="Write a reply the patient will see..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                helperText="Once sent, this reply cannot be edited — review it before sending."
              />
              <Button onClick={handleSend} isLoading={isReplying} disabled={!draft.trim()}>
                Send Reply
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default DoctorReviewDetailDrawer;
