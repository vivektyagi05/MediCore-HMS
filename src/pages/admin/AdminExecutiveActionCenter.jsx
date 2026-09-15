import { useEffect, useState } from "react";
import { RefreshCcw, HelpCircle, Radio, PauseCircle, PlayCircle, Clock } from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Modal from "../../components/ui/Modal";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useRealtime } from "../../context/RealtimeContext";

const PRIORITY_TONE = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
  info: "success",
};

function timeUntil(deadline) {
  if (!deadline) return null;
  const diffMs = new Date(deadline).getTime() - Date.now();
  if (diffMs <= 0) return "overdue";
  const hours = Math.round(diffMs / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

function AdminExecutiveActionCenter() {
  const { dashboardSyncTick } = useRealtime();
  const [actionCenter, setActionCenter] = useState(null);
  const [decisions, setDecisions] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  // Workspace state — everything below opens inline instead of navigating away.
  const [explainModal, setExplainModal] = useState(null); // { title, narrative } | null
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastForm, setBroadcastForm] = useState({ title: "", message: "", roles: [] });
  const [actionBusy, setActionBusy] = useState("");
  const [pauseState, setPauseState] = useState(null);
  const [toast, setToast] = useState("");

  const load = async () => {
    setError("");
    try {
      const [ac, dc, rc, tl] = await Promise.all([
        adminApi.getActionCenter(),
        adminApi.getDecisionCards(),
        adminApi.getExecutiveRecommendations(),
        adminApi.getExecutiveTimeline({ limit: 25 }),
      ]);
      setActionCenter(ac.data);
      setDecisions(dc.data);
      setRecommendations(rc.data);
      setTimeline(tl.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [dashboardSyncTick]);

  useEffect(() => {
    const interval = window.setInterval(load, 20000);
    return () => window.clearInterval(interval);
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3500);
  };

  const handleExplain = async (metricKey, title) => {
    setActionBusy(`explain-${metricKey}`);
    try {
      const res = await adminApi.explainMetric(metricKey);
      setExplainModal({ title, narrative: res.data.content?.narrative || res.data.content, disclaimer: res.data.disclaimer });
    } catch (explainError) {
      showToast(getApiErrorMessage(explainError));
    } finally {
      setActionBusy("");
    }
  };

  const handleBroadcastSubmit = async (event) => {
    event.preventDefault();
    setActionBusy("broadcast");
    try {
      const res = await adminApi.broadcastAnnouncement({
        title: broadcastForm.title,
        message: broadcastForm.message,
        roles: broadcastForm.roles.length ? broadcastForm.roles : undefined,
      });
      showToast(`Announcement sent to ${res.data.recipientCount} recipient(s)`);
      setBroadcastOpen(false);
      setBroadcastForm({ title: "", message: "", roles: [] });
    } catch (broadcastError) {
      showToast(getApiErrorMessage(broadcastError));
    } finally {
      setActionBusy("");
    }
  };

  const togglePause = async () => {
    const next = !pauseState;
    setActionBusy("pause");
    try {
      const res = await adminApi.setRegistrationsPaused(next);
      setPauseState(res.data.feature.isEnabled);
      showToast(res.message);
    } catch (pauseError) {
      showToast(getApiErrorMessage(pauseError));
    } finally {
      setActionBusy("");
    }
  };

  if (isLoading && !actionCenter) return <Loader label="Loading executive action center" />;
  if (error && !actionCenter) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Executive Action Center</h1>
          <p className="text-sm text-slate-600">Understand, decide, and act on the platform from one place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={load}>
            <RefreshCcw size={16} /> Refresh
          </Button>
          <Button variant="secondary" onClick={() => setBroadcastOpen(true)}>
            <Radio size={16} /> Broadcast Announcement
          </Button>
          <Button variant={pauseState ? "primary" : "secondary"} isLoading={actionBusy === "pause"} onClick={togglePause}>
            {pauseState ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
            {pauseState ? "Resume Registrations" : "Pause Registrations"}
          </Button>
        </div>
      </div>

      {toast && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800">{toast}</div>}

      {/* Step 8 — Smart Decision Engine */}
      <Card title="Decision Cards">
        <div className="grid gap-3 md:grid-cols-2">
          {decisions?.cards?.map((card) => (
            <div key={card.key} className="rounded-xl border border-slate-200 bg-white/60 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Badge tone={PRIORITY_TONE[card.priority] || "neutral"}>{card.priority}</Badge>
                <span className="text-xs font-semibold text-slate-500">Confidence: {card.confidence}</span>
              </div>
              <h3 className="font-bold text-slate-950">{card.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{card.detail}</p>
              <p className="mt-2 text-sm font-semibold text-slate-800">→ {card.recommendedAction}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Step 2 — Executive Action Center cards */}
      <Card title={`Needs Immediate Action (${actionCenter?.cards?.length || 0})`}>
        {!actionCenter?.cards?.length ? (
          <EmptyState title="Nothing needs action right now" description="All clear across the platform." />
        ) : (
          <div className="space-y-3">
            {actionCenter.cards.map((card) => (
              <div key={card.key} className="rounded-xl border border-slate-200 bg-white/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge tone={PRIORITY_TONE[card.priority] || "neutral"}>{card.priority}</Badge>
                      <span className="text-xs font-semibold text-slate-500">{card.owner}</span>
                      {card.deadline && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                          <Clock size={12} /> {timeUntil(card.deadline)}
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-slate-950">
                      {card.title} {card.count != null && <span className="text-slate-500">({card.count})</span>}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">{card.reason}</p>
                    <p className="mt-1 text-sm text-slate-700">
                      <span className="font-semibold">Impact:</span> {card.impact}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">→ {card.recommendedAction}</p>
                  </div>
                  {card.actionButton?.route && (
                    <Button to={card.actionButton.route} variant="primary" className="shrink-0">
                      {card.actionButton.label}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Step 4 — Executive Recommendations, with AI Explain (Step 10) */}
      <Card title="Executive Recommendations">
        {!recommendations?.length ? (
          <EmptyState title="No recommendations right now" description="No rule-based risk pattern has been detected." />
        ) : (
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <div key={rec.key} className="rounded-xl border border-slate-200 bg-white/60 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone={PRIORITY_TONE[rec.priority] || "neutral"}>{rec.priority}</Badge>
                  <span className="text-xs font-semibold text-slate-500">Confidence: {rec.confidence}</span>
                </div>
                <h3 className="font-bold text-slate-950">{rec.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{rec.reason}</p>
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-semibold">Business impact:</span> {rec.businessImpact}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-800">→ {rec.recommendedAction}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Step 10 — AI Explain Everything, for the whitelisted platform-health metrics */}
      <Card title="AI Explain Everything">
        <div className="flex flex-wrap gap-2">
          {[
            { key: "healthScore", label: "Why this Health Score?" },
            { key: "cancellationRate", label: "Why this Cancellation Rate?" },
            { key: "paymentFailureRate", label: "Why this Payment Failure Rate?" },
            { key: "refundBacklog", label: "Why this Refund Backlog?" },
          ].map((metric) => (
            <Button
              key={metric.key}
              variant="secondary"
              isLoading={actionBusy === `explain-${metric.key}`}
              onClick={() => handleExplain(metric.key, metric.label)}
            >
              <HelpCircle size={14} /> {metric.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* Step 7 — Executive Timeline */}
      <Card title="Executive Timeline">
        {!timeline?.length ? (
          <EmptyState title="No recent events" description="No real platform events in the last 30 days." />
        ) : (
          <ul className="space-y-2">
            {timeline.map((event, idx) => (
              <li key={idx} className="flex items-start gap-3 border-b border-slate-100 pb-2 text-sm last:border-0">
                <Badge tone={event.severity === "critical" ? "danger" : event.severity === "high" ? "warning" : "neutral"}>
                  {event.type}
                </Badge>
                <span className="text-slate-700">{event.label}</span>
                <span className="ml-auto shrink-0 text-xs text-slate-400">{new Date(event.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Step 10 explain result, inline workspace modal (Step 9) */}
      <Modal isOpen={Boolean(explainModal)} title={explainModal?.title || "Explanation"} onClose={() => setExplainModal(null)}>
        <p className="text-sm text-slate-700">{explainModal?.narrative}</p>
        {explainModal?.disclaimer && <p className="mt-3 text-xs italic text-slate-400">{explainModal.disclaimer}</p>}
      </Modal>

      {/* Step 5 quick action, Step 9 inline workspace modal */}
      <Modal isOpen={broadcastOpen} title="Broadcast Announcement" onClose={() => setBroadcastOpen(false)}>
        <form className="space-y-3" onSubmit={handleBroadcastSubmit}>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">Title</label>
            <input
              required
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              value={broadcastForm.title}
              onChange={(e) => setBroadcastForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">Message</label>
            <textarea
              required
              rows={4}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              value={broadcastForm.message}
              onChange={(e) => setBroadcastForm((f) => ({ ...f, message: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">Recipients (default: all patients + doctors)</label>
            <div className="flex gap-3">
              {["patient", "doctor", "receptionist"].map((role) => (
                <label key={role} className="flex items-center gap-1.5 text-sm capitalize">
                  <input
                    type="checkbox"
                    checked={broadcastForm.roles.includes(role)}
                    onChange={(e) =>
                      setBroadcastForm((f) => ({
                        ...f,
                        roles: e.target.checked ? [...f.roles, role] : f.roles.filter((r) => r !== role),
                      }))
                    }
                  />
                  {role}
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" variant="primary" isLoading={actionBusy === "broadcast"} className="w-full">
            Send Broadcast
          </Button>
        </form>
      </Modal>
    </div>
  );
}

export default AdminExecutiveActionCenter;
