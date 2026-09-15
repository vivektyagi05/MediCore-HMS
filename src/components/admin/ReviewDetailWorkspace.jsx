import { AlertTriangle, Pin, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { adminReviewApi } from "../../api/adminReviewApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import { getApiErrorMessage } from "../../api/axios";
import AIDraftPanel from "../ai/AIDraftPanel";
import ConfirmDialog from "../ui/ConfirmDialog";
import ErrorState from "../shared/ErrorState";
import Loader from "../ui/Loader";
import MetricCard from "../ui/MetricCard";
import StatusBadge from "../ui/StatusBadge";
import Tabs from "../ui/Tabs";
import Button from "../ui/Button";
import { useToast } from "../../context/ToastContext";

function StarRow({ rating }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={18}
          fill={star <= rating ? "currentColor" : "none"}
          className={star <= rating ? "text-amber-500" : "text-slate-300"}
        />
      ))}
    </div>
  );
}

// Doctor Reputation is deliberately NEVER recalculated here — this tab reads
// the exact same GET /admin/doctors/:id aggregate the Doctor Management
// Workspace's own Reputation tab uses (buildDoctorReputationIntelligence()),
// so the two can never disagree.
function ReputationTab({ doctorId }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi
      .getDoctorDetailAdmin(doctorId)
      .then((res) => {
        if (!cancelled) setDetail(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doctorId]);

  if (loading) return <Loader label="Loading reputation data..." />;
  if (error) return <ErrorState description={error} />;
  if (!detail) return null;

  const { reputation, reviews } = detail;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Rating" value={reputation.overview.rating} />
        <MetricCard label="Total Reviews" value={reputation.overview.totalReviews} />
        <MetricCard label="Satisfaction Rate" value={`${reputation.overview.satisfactionRate}%`} />
        <MetricCard label="Response Rate" value={`${reviews.responseRate}%`} />
        <MetricCard
          label="Negative Reviews"
          value={reviews.negativeCount}
          tone={reviews.negativeCount > 0 ? "danger" : "neutral"}
        />
        <MetricCard
          label="Unreplied Reviews"
          value={reviews.unrepliedCount}
          tone={reviews.unrepliedCount > 0 ? "warning" : "neutral"}
        />
      </div>
      {reputation.intelligence?.topStrengths?.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold text-slate-800">Top Strengths</p>
          <div className="flex flex-wrap gap-2">
            {reputation.intelligence.topStrengths.map((s, i) => (
              <StatusBadge key={i} tone="success">
                {s}
              </StatusBadge>
            ))}
          </div>
        </div>
      )}
      {reputation.intelligence?.improvementOpportunities?.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold text-slate-800">Improvement Opportunities</p>
          <div className="flex flex-wrap gap-2">
            {reputation.intelligence.improvementOpportunities.map((s, i) => (
              <StatusBadge key={i} tone="warning">
                {s}
              </StatusBadge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewDetailWorkspace({ reviewId, onChanged, onClose }) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("review");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminReviewApi.getReviewDetail(reviewId);
      setDetail(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [reviewId]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await adminReviewApi.deleteReview(reviewId);
      toast.success("Review removed");
      setShowDeleteConfirm(false);
      onChanged?.();
      onClose?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Review could not be removed. The server rejected the operation.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <Loader label="Loading review..." />;
  if (error) return <ErrorState description={error} onRetry={loadDetail} />;
  if (!detail) return null;

  const { review, timeline } = detail;
  const doctorName = review.doctorId?.userId?.name ? `Dr. ${review.doctorId.userId.name}` : "Unknown doctor";
  const doctorId = review.doctorId?._id;

  const tabs = [
    { id: "review", label: "Review" },
    { id: "response", label: "Response" },
    { id: "context", label: "Context" },
    { id: "reputation", label: "Reputation" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-slate-950">{review.userId?.name || "Unknown patient"}</h3>
            {review.isPinned && (
              <span className="flex items-center gap-1 text-xs font-bold text-amber-600">
                <Pin size={12} className="fill-amber-400" /> Pinned
              </span>
            )}
            {review.rating <= 2 && (
              <StatusBadge tone="danger">Negative</StatusBadge>
            )}
            {!review.doctorReply?.message && <StatusBadge tone="warning">Unreplied</StatusBadge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">for {doctorName}</p>
        </div>
        <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm(true)}>
          <Trash2 size={14} /> Remove Review
        </Button>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "review" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <StarRow rating={review.rating} />
            <span className="text-sm font-bold text-slate-700">{review.rating}/5</span>
          </div>
          <p className="text-sm leading-6 text-slate-700">
            {review.comment || <span className="text-slate-400">No written comment was left with this review.</span>}
          </p>
          <p className="text-xs text-slate-500">Submitted {new Date(review.createdAt).toLocaleString()}</p>
          {review.isEdited && <p className="text-xs font-semibold text-amber-600">Edited by the patient after submission.</p>}
        </div>
      )}

      {activeTab === "response" && (
        <div className="space-y-3">
          {review.doctorReply?.message ? (
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="text-xs font-black uppercase text-blue-700">Doctor Reply</p>
              <p className="mt-2 text-sm text-slate-700">{review.doctorReply.message}</p>
              {review.doctorReply.repliedAt && (
                <p className="mt-2 text-xs text-slate-500">{new Date(review.doctorReply.repliedAt).toLocaleString()}</p>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>
                No reply yet. Only {doctorName} can reply to this review from their own Review Intelligence Center —
                admins cannot post a reply on a doctor's behalf.
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "context" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Doctor</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{doctorName}</p>
            {review.doctorId?.specialization && <p className="text-xs text-slate-500">{review.doctorId.specialization}</p>}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Patient</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{review.userId?.name || "Unknown"}</p>
            {review.userId?.email && <p className="text-xs text-slate-500">{review.userId.email}</p>}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Appointment</p>
            {review.appointmentId ? (
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {new Date(review.appointmentId.date).toLocaleDateString()} · {review.appointmentId.timeSlot}
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-400">Appointment record unavailable</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "reputation" && doctorId && <ReputationTab doctorId={doctorId} />}

      {activeTab === "timeline" && (
        <div className="space-y-3">
          {timeline.map((event) => (
            <div key={event.key} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-royal-500" />
              <div>
                <p className="text-sm font-semibold text-slate-800">{event.label}</p>
                <p className="text-xs text-slate-500">{new Date(event.at).toLocaleString()}</p>
              </div>
            </div>
          ))}
          {review.isPinned && (
            <p className="text-xs text-slate-400">
              Currently pinned by the doctor — pin/unpin timestamps are not tracked in this schema, so no event time is shown.
            </p>
          )}
        </div>
      )}

      {doctorId && (
        <AIDraftPanel
          title="AI: Review Sentiment for this Doctor"
          actionLabel="Analyze this doctor's reviews"
          onGenerate={() => aiAssistApi.getReviewSentiment({ doctorId })}
          compact
        />
      )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Remove this review?"
        description="This soft-deletes the review, recalculates the doctor's rating, and notifies the patient. This action is logged."
        confirmLabel="Remove Review"
        isLoading={deleting}
        onConfirm={handleDelete}
        onClose={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

export default ReviewDetailWorkspace;
