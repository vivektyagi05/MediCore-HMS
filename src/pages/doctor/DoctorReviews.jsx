import {
  ArrowRight,
  MessageSquare,
  Pin,
  Search,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

import { doctorApi } from "../../api/doctorApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import { getApiErrorMessage } from "../../api/axios";
import Button from "../../components/ui/Button";
import Select from "../../components/ui/Select";
import Loader from "../../components/ui/Loader";
import ErrorState from "../../components/shared/ErrorState";
import EmptyState from "../../components/shared/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import BusinessIntelligenceNav from "../../components/business/BusinessIntelligenceNav";
import DoctorReviewDetailDrawer from "../../components/doctor/DoctorReviewDetailDrawer";
import { useRealtime } from "../../context/RealtimeContext";
import { useI18n } from "../../i18n/I18nContext";

const PAGE_SIZE = 10;

const SEVERITY_TONE = { critical: "danger", warning: "warning", info: "info" };

function StarRow({ rating, size = 16 }) {
  return (
    <div className="flex items-center gap-0.5">
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

// PHASE DOC-05 — Reviews & Reputation Workspace.
//
// Redesigned around the journey the brief describes: reputation identity
// first (PRIMARY), what needs attention next (SECONDARY), then the review
// registry itself (TERTIARY), with a focused detail workspace for acting on
// any one review. Deliberately does NOT duplicate the Reputation Center's
// intelligence scores/rating distribution/trend charts — this page links to
// it instead (Step 12/Golden Rule: deep-link rather than duplicate).
//
// Server-side pagination + filtering (Step 9): the reviews list is never
// fetched in full and filtered in React — buildDoctorReviewIntelligence
// (backend) always computes the stats/attention queue from the doctor's
// full review set, but only ever returns one page of the list itself.
function DoctorReviews() {
  const { t } = useI18n();
  const { dashboardSyncTick } = useRealtime();

  const [businessOverview, setBusinessOverview] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [attentionFilter, setAttentionFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [replyingId, setReplyingId] = useState("");
  const [pinningId, setPinningId] = useState("");
  const [selectedReviewId, setSelectedReviewId] = useState("");

  // Deep-link support (Smart Inbox's "Reply" action, dashboard attention
  // items, and this page's own Attention Workspace all use the same
  // mechanism): ?reviewId=... forces the backend to ignore whatever filter
  // is active and resolve the real page that review lives on.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusReviewId = searchParams.get("reviewId") || "";
  const [hasAppliedFocus, setHasAppliedFocus] = useState(!focusReviewId);

  const loadBusinessOverview = async () => {
    try {
      const res = await doctorApi.getBusinessOverview();
      setBusinessOverview(res.data || null);
    } catch {
      setBusinessOverview(null);
    }
  };

  const load = async (targetPage, targetFocus) => {
    setLoading(true);
    setError("");
    try {
      const response = await doctorApi.getReviews({
        page: targetPage,
        limit: PAGE_SIZE,
        search: targetFocus ? undefined : debouncedSearch || undefined,
        rating: targetFocus ? undefined : ratingFilter !== "all" ? ratingFilter : undefined,
        attention: targetFocus ? undefined : attentionFilter !== "all" ? attentionFilter : undefined,
        focusReviewId: targetFocus || undefined,
      });
      setData(response.data);

      if (targetFocus) {
        const resolvedPage = response.data?.pagination?.page;
        if (resolvedPage && resolvedPage !== targetPage) setPage(resolvedPage);
        setHasAppliedFocus(true);
        setSearchParams({}, { replace: true });
        const found = (response.data?.reviews || []).some((r) => r._id === targetFocus);
        if (found) setSelectedReviewId(targetFocus);
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBusinessOverview();
  }, [dashboardSyncTick]);

  // Debounce free-text search.
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(timeout);
  }, [search]);

  // Any committed filter change invalidates the current page.
  useEffect(() => {
    setPage(1);
  }, [ratingFilter, attentionFilter, debouncedSearch]);

  useEffect(() => {
    const targetFocus = !hasAppliedFocus && focusReviewId ? focusReviewId : "";
    load(page, targetFocus);
  }, [dashboardSyncTick, page, ratingFilter, attentionFilter, debouncedSearch, focusReviewId, hasAppliedFocus]);

  const openReview = (reviewId) => {
    setHasAppliedFocus(false);
    setSearchParams({ reviewId });
  };

  const handleReply = async (reviewId, message) => {
    try {
      setReplyingId(reviewId);
      await doctorApi.replyReview(reviewId, { message });
      setSelectedReviewId("");
      await load(page, "");
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setReplyingId("");
    }
  };

  const handleTogglePin = async (reviewId) => {
    try {
      setPinningId(reviewId);
      await doctorApi.pinReview(reviewId);
      await load(page, "");
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setPinningId("");
    }
  };

  const reviews = data?.reviews || [];
  const pagination = data?.pagination;
  const attentionItems = data?.attentionItems || [];
  const selectedReview = useMemo(
    () => reviews.find((r) => r._id === selectedReviewId) || null,
    [reviews, selectedReviewId],
  );

  if (loading && !data) {
    return <Loader label={t("page.loadingReviews")} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Reputation & Patient Feedback</p>
          <h1 className="mt-2 text-3xl font-black">Reviews Workspace</h1>
          <p className="mt-2 text-sm text-slate-500">How patients see your practice, and what needs your attention.</p>
        </div>
        <Button variant="secondary" onClick={() => load(page, "")} isLoading={loading}>
          Refresh
        </Button>
      </div>

      <BusinessIntelligenceNav overview={businessOverview} active="reviews" />

      {error && <ErrorState description={error} onRetry={() => load(page, "")} />}

      {/* PRIMARY — Reputation identity, not a wall of MetricCards */}
      {data && (
        <div className="glass-card rounded-2xl p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-5">
              <div>
                <p className="text-5xl font-black text-slate-950">
                  {data.totalReviews > 0 ? data.averageRating : "—"}
                </p>
                {data.totalReviews > 0 && <StarRow rating={Math.round(data.averageRating)} size={18} />}
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {data.totalReviews} patient review{data.totalReviews === 1 ? "" : "s"}
                </p>
              </div>
              {data.ratingTrendDirection && (
                <div
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${
                    data.ratingTrendDirection.delta > 0
                      ? "bg-emerald-50 text-emerald-700"
                      : data.ratingTrendDirection.delta < 0
                        ? "bg-rose-50 text-rose-700"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {data.ratingTrendDirection.delta > 0 ? (
                    <TrendingUp size={16} />
                  ) : data.ratingTrendDirection.delta < 0 ? (
                    <TrendingDown size={16} />
                  ) : null}
                  {data.ratingTrendDirection.delta > 0 ? "+" : ""}
                  {data.ratingTrendDirection.delta} vs last active month
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-2xl font-black text-slate-950">{data.responseRate}%</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Response rate</p>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-950">{data.pinnedCount}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pinned</p>
              </div>
              <Button variant="tertiary" size="sm" to="/doctor/reputation" className="self-center">
                Full reputation report <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* SECONDARY — What needs attention, WHAT/WHY/ACTION, never a bare count */}
      {attentionItems.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Needs your attention</h2>
          <div className="space-y-2">
            {attentionItems.map((item) => (
              <div
                key={item.reviewId}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <StatusBadge tone={SEVERITY_TONE[item.severity] || "neutral"}>{item.severity}</StatusBadge>
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {item.patientName} · {item.title}
                    </p>
                    <p className="text-sm text-slate-500">{item.reason}</p>
                  </div>
                </div>
                <Button size="sm" onClick={() => openReview(item.reviewId)}>
                  {item.source?.includes("doctorReply missing") ? "Reply" : "Open"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TERTIARY — The registry itself */}
      <div className="glass-card rounded-2xl p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPatientReview")}
              className="w-full rounded-xl border border-slate-200 py-3 pl-11 pr-4 text-sm"
            />
          </div>

          <Select value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)}>
            <option value="all">All ratings</option>
            <option value="5">5 star</option>
            <option value="4">4 star</option>
            <option value="3">3 star</option>
            <option value="2">2 star</option>
            <option value="1">1 star</option>
          </Select>

          <Select value={attentionFilter} onChange={(e) => setAttentionFilter(e.target.value)}>
            <option value="all">All reviews</option>
            <option value="unreplied">Awaiting reply</option>
            <option value="pinned">Pinned</option>
            <option value="negative">Negative (≤2★)</option>
          </Select>
        </div>
      </div>

      <AIDraftPanel
        title="AI Review Summary"
        actionLabel="Summarize Reviews"
        onGenerate={() => aiAssistApi.getDoctorReviewSummary()}
        compact
      />

      {!reviews.length ? (
        <EmptyState
          title={data?.totalReviews ? t("page.noReviews") : "Your first patient review will appear here"}
          description={t("page.patientFeedback")}
        />
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <button
              key={review._id}
              type="button"
              onClick={() => setSelectedReviewId(review._id)}
              className={`w-full rounded-2xl border p-5 text-left shadow-sm transition hover:border-royal-300 ${
                review.isPinned ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white"
              } ${review.rating <= 2 ? "ring-1 ring-rose-200" : ""}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-slate-950">{review.userId?.name || "Patient"}</p>
                  {review.isPinned && <Pin size={13} className="fill-amber-400 text-amber-500" />}
                </div>
                <div className="flex items-center gap-3">
                  <StarRow rating={review.rating} />
                  <span className="text-xs font-semibold text-slate-400">
                    {new Date(review.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              {review.comment && (
                <p className="mt-3 line-clamp-2 text-sm text-slate-600">{review.comment}</p>
              )}
              <div className="mt-3">
                {review.doctorReply?.message ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                    <MessageSquare size={12} /> Replied
                  </span>
                ) : (
                  <StatusBadge tone="warning">Awaiting reply</StatusBadge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} matching review
            {pagination.total === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={!pagination.hasPrevious} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={!pagination.hasNext} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <DoctorReviewDetailDrawer
        review={selectedReview}
        onClose={() => setSelectedReviewId("")}
        onReply={handleReply}
        onTogglePin={handleTogglePin}
        replyingId={replyingId}
        pinningId={pinningId}
      />
    </div>
  );
}

export default DoctorReviews;
