import {
  AlertTriangle,
  Eye,
  MessageSquare,
  Pin,
  Star,
  ThumbsDown,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { adminReviewApi } from "../../api/adminReviewApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import { getApiErrorMessage } from "../../api/axios";

import AdminModal from "../../components/admin/AdminModal";
import AdminTable from "../../components/admin/AdminTable";
import FilterBar from "../../components/admin/FilterBar";
import ReviewDetailWorkspace from "../../components/admin/ReviewDetailWorkspace";
import ErrorState from "../../components/shared/ErrorState";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import Select from "../../components/ui/Select";
import StatusBadge from "../../components/ui/StatusBadge";

import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";

const SEVERITY_TONE = { critical: "danger", warning: "warning", info: "info" };

function AdminReviews() {
  const toast = useToast();
  const { dashboardSyncTick } = useRealtime();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    sentiment: searchParams.get("sentiment") || "",
    replied: searchParams.get("replied") || "",
    pinned: searchParams.get("pinned") || "",
    rating: searchParams.get("rating") || "",
  });

  const [reviews, setReviews] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [summary, setSummary] = useState(null);
  const [attentionItems, setAttentionItems] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [detailId, setDetailId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const query = useMemo(
    () => Object.fromEntries([...searchParams.entries()].filter(([, value]) => value)),
    [searchParams],
  );

  const loadReviews = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await adminReviewApi.getReviews({ ...query, limit: 50 });
      setReviews(response.data.reviews || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const response = await adminReviewApi.getReviewSummary();
      setSummary(response.data || null);
    } catch {
      // Non-critical: KPI strip simply doesn't render if this fails, rather
      // than showing a fabricated number.
    }
  };

  const loadAttentionQueue = async () => {
    try {
      const response = await adminReviewApi.getReviewAttentionQueue();
      setAttentionItems(response.data.items || []);
    } catch {
      // Non-critical: attention queue simply doesn't render if this fails.
    }
  };

  useEffect(() => {
    loadReviews();
  }, [searchParams, dashboardSyncTick]);

  useEffect(() => {
    loadSummary();
    loadAttentionQueue();
  }, [dashboardSyncTick]);

  const applyFilters = () => {
    setSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  };

  const setMetricFilter = (patch) => {
    const next = { search: "", sentiment: "", replied: "", pinned: "", rating: "", ...patch };
    setFilters(next);
    setSearchParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value)));
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminReviewApi.deleteReview(deleteTarget._id);
      toast.success("Review removed");
      setDeleteTarget(null);
      await Promise.all([loadReviews(), loadSummary(), loadAttentionQueue()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error) || "Review could not be removed. The server rejected the operation.");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "patient",
      header: "Patient",
      render: (row) => <p className="font-bold text-slate-950">{row.userId?.name || "Unknown patient"}</p>,
    },
    {
      key: "doctor",
      header: "Doctor",
      render: (row) => (
        <div>
          <p className="font-semibold text-slate-800">Dr. {row.doctorId?.userId?.name || "Unknown"}</p>
          <p className="text-xs text-slate-500">{row.doctorId?.specialization}</p>
        </div>
      ),
    },
    {
      key: "rating",
      header: "Rating",
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <Star size={14} className="fill-amber-400 text-amber-500" />
          <span className="font-bold text-slate-800">{row.rating}/5</span>
        </div>
      ),
    },
    {
      key: "comment",
      header: "Comment",
      render: (row) => (
        <p className="max-w-xs truncate text-xs text-slate-600">{row.comment || <span className="text-slate-400">No comment</span>}</p>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-wrap gap-1.5">
          {row.rating <= 2 && <StatusBadge tone="danger">Negative</StatusBadge>}
          {!row.doctorReply?.message && <StatusBadge tone="warning">Unreplied</StatusBadge>}
          {row.isPinned && (
            <span className="flex items-center gap-1 text-xs font-bold text-amber-600">
              <Pin size={12} className="fill-amber-400" /> Pinned
            </span>
          )}
        </div>
      ),
    },
    {
      key: "date",
      header: "Submitted",
      render: (row) => <span className="text-xs text-slate-500">{new Date(row.createdAt).toLocaleDateString()}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDetailId(row._id)}>
            <Eye size={14} /> View
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleteTarget(row)}>
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Reviews Management"
        title="Reviews Management, Moderation & Reputation Operations"
        description="See what patients wrote, what doctors replied, and what needs your attention — all backed by real data."
      />

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <button type="button" className="text-left" onClick={() => setMetricFilter({})}>
            <MetricCard label="Total Reviews" value={summary.totalReviews} icon={MessageSquare} />
          </button>
          <MetricCard label="Average Rating" value={summary.averageRating ?? "N/A"} icon={Star} tone="premium" />
          <button type="button" className="text-left" onClick={() => setMetricFilter({ sentiment: "negative" })}>
            <MetricCard
              label="Negative Reviews"
              value={summary.negativeCount}
              tone={summary.negativeCount > 0 ? "danger" : "neutral"}
              icon={ThumbsDown}
            />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ replied: "false" })}>
            <MetricCard
              label="Unreplied Reviews"
              value={summary.unrepliedCount}
              tone={summary.unrepliedCount > 0 ? "warning" : "neutral"}
              icon={AlertTriangle}
            />
          </button>
          <button type="button" className="text-left" onClick={() => setMetricFilter({ pinned: "true" })}>
            <MetricCard label="Pinned Reviews" value={summary.pinnedCount} icon={Pin} />
          </button>
          <MetricCard label="Response Rate" value={summary.responseRate != null ? `${summary.responseRate}%` : "N/A"} />
        </div>
      )}

      {attentionItems.length > 0 && (
        <Card title="Attention Queue">
          <div className="space-y-2.5">
            {attentionItems.map((item) => (
              <button
                key={item.reviewId}
                type="button"
                onClick={() => setDetailId(item.reviewId)}
                className="w-full rounded-control border border-slate-200 p-3.5 text-left transition hover:bg-slate-50"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">{item.title}</p>
                  <StatusBadge tone={SEVERITY_TONE[item.severity] || "neutral"}>{item.severity}</StatusBadge>
                </div>
                <p className="mt-1 text-xs text-slate-600">{item.reason}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.patientName} · {item.doctorName}
                </p>
                <p className="mt-1 text-xs font-semibold text-royal-700">Suggested: {item.recommendedAction}</p>
              </button>
            ))}
          </div>
        </Card>
      )}

      <AIDraftPanel
        title="AI: Review Sentiment Overview"
        actionLabel="Analyze sentiment (all reviews)"
        onGenerate={() => aiAssistApi.getReviewSentiment()}
        compact
      />

      <FilterBar
        filters={filters}
        onChange={(event) => setFilters((current) => ({ ...current, [event.target.name]: event.target.value }))}
        onApply={applyFilters}
      >
        <Select
          name="sentiment"
          value={filters.sentiment}
          onChange={(event) => setFilters((current) => ({ ...current, sentiment: event.target.value }))}
        >
          <option value="">All sentiment</option>
          <option value="positive">Positive (4-5★)</option>
          <option value="negative">Negative (1-2★)</option>
        </Select>
        <Select
          name="replied"
          value={filters.replied}
          onChange={(event) => setFilters((current) => ({ ...current, replied: event.target.value }))}
        >
          <option value="">All reviews</option>
          <option value="false">Unreplied</option>
          <option value="true">Replied</option>
        </Select>
        <Select
          name="pinned"
          value={filters.pinned}
          onChange={(event) => setFilters((current) => ({ ...current, pinned: event.target.value }))}
        >
          <option value="">Pinned or not</option>
          <option value="true">Pinned</option>
          <option value="false">Unpinned</option>
        </Select>
        <Select
          name="rating"
          value={filters.rating}
          onChange={(event) => setFilters((current) => ({ ...current, rating: event.target.value }))}
        >
          <option value="">Any rating</option>
          <option value="5">5 Stars</option>
          <option value="4">4 Stars</option>
          <option value="3">3 Stars</option>
          <option value="2">2 Stars</option>
          <option value="1">1 Star</option>
        </Select>
      </FilterBar>

      {loadError ? (
        <ErrorState description={loadError} onRetry={loadReviews} />
      ) : (
        <Card>
          <AdminTable
            columns={columns}
            data={reviews}
            isLoading={isLoading}
            emptyTitle="No reviews found"
            emptyDescription={
              activeFilterCount > 0
                ? "No reviews match these filters. Try clearing them."
                : "No reviews have been submitted yet."
            }
          />
        </Card>
      )}

      {pagination && pagination.total > pagination.limit && (
        <p className="text-center text-xs font-semibold text-slate-500">
          Showing {reviews.length} of {pagination.total} reviews. Narrow with search or filters to see more.
        </p>
      )}

      <AdminModal isOpen={Boolean(detailId)} title="Review Workspace" onClose={() => setDetailId(null)} size="xl">
        {detailId && (
          <ReviewDetailWorkspace
            reviewId={detailId}
            onChanged={() => {
              loadReviews();
              loadSummary();
              loadAttentionQueue();
            }}
            onClose={() => setDetailId(null)}
          />
        )}
      </AdminModal>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Remove this review?"
        description="This soft-deletes the review, recalculates the doctor's rating, and notifies the patient. This action is logged."
        confirmLabel="Remove Review"
        isLoading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default AdminReviews;
