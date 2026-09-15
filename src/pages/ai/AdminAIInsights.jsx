import { Activity, BellRing, BrainCircuit, CalendarClock, CircuitBoard, IndianRupee, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getApiErrorMessage } from "../../api/axios";
import { aiApi } from "../../api/aiApi";
import AIInsightCard from "../../components/insights/AIInsightCard";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import StatusBadge from "../../components/ui/StatusBadge";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import { aiAssistApi } from "../../api/aiAssistApi";

function timeAgo(isoString) {
  if (!isoString) return "never";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// PHASE UI-12 — AI System Health. Distinguishes real provider/capability
// state instead of decorative "AI Powered" labeling; never shows a
// fabricated uptime percentage (see backend/services/ai/
// aiSystemHealthAggregates.js for what is and isn't tracked and why).
function AISystemHealthCard({ health, isLoading, error, onRetry }) {
  if (isLoading) {
    return (
      <Card title="AI System Health">
        <Loader label="Checking AI system health" />
      </Card>
    );
  }

  if (error || !health) {
    return (
      <Card title="AI System Health">
        <EmptyState
          title="AI system health is temporarily unavailable"
          description={error || "Could not reach the health check. The rest of the AI Command page continues to work."}
          actionLabel="Try again"
          onAction={onRetry}
        />
      </Card>
    );
  }

  const { provider, capabilities, activity, activityError, limitations } = health;

  return (
    <Card title="AI System Health" action={<CircuitBoard size={20} className="text-royal-600" />}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-white/60 p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">AI Provider</p>
          <div className="mt-2">
            <StatusBadge tone={provider.available ? "success" : "danger"}>
              {provider.available ? "Available" : "Unavailable"}
            </StatusBadge>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-700">{provider.activeProvider || "None active"}</p>
          {provider.isDeterministicFallback && (
            <p className="mt-1 text-xs font-semibold text-slate-500">
              Deterministic template engine — grounded strictly in real platform data, never a network call.
            </p>
          )}
          {provider.error && <p className="mt-1 text-xs font-bold text-rose-600">{provider.error}</p>}
        </div>

        <div className="rounded-2xl bg-white/60 p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Capability Registry</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{capabilities.totalRegistered}</p>
          <p className="text-xs font-semibold text-slate-500">registered AI capabilities</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(capabilities.byScope).map(([scope, count]) => (
              <span key={scope} className="rounded-lg bg-royal-600/10 px-2 py-1 text-xs font-bold capitalize text-royal-700">
                {scope}: {count}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white/60 p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Recent Generation Activity</p>
          {activityError || !activity ? (
            <p className="mt-2 text-xs font-bold text-rose-600">{activityError || "Unavailable"}</p>
          ) : (
            <>
              <p className="mt-2 text-2xl font-black text-slate-950">{activity.trackedGenerationsToday}</p>
              <p className="text-xs font-semibold text-slate-500">
                tracked generations today - {activity.trackedGenerationsLast7d} in last 7 days
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">Last: {timeAgo(activity.lastGeneratedAt)}</p>
            </>
          )}
        </div>
      </div>

      {activity?.topCapabilities?.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Most-used tracked capabilities (30d)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {activity.topCapabilities.map((cap) => (
              <span key={cap.promptKey} className="rounded-lg bg-slate-900/5 px-3 py-1.5 text-xs font-bold text-slate-700">
                {cap.label} - {cap.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {limitations?.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-xs font-medium leading-5 text-slate-500">
          {limitations.map((line, i) => (
            <li key={i}>- {line}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AdminAIInsights() {
  const toast = useToast();
  const { t } = useI18n();
  const [insights, setInsights] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState(null);
  const [isHealthLoading, setIsHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState("");

  const loadAI = async () => {
    setIsLoading(true);
    setError("");
    try {
      const [insightsResponse, predictionsResponse, scheduleResponse] = await Promise.all([
        aiApi.getInsights({ generate: true }),
        aiApi.getPredictions(),
        aiApi.getScheduleOptimization(),
      ]);
      setInsights(insightsResponse.data.insights || []);
      setForecast(predictionsResponse.data.forecast);
      setSchedule(scheduleResponse.data.suggestions || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  // AI System Health is fetched and rendered independently — Step 6: one AI
  // section failing must never break another, and never break the page.
  const loadHealth = async () => {
    setIsHealthLoading(true);
    setHealthError("");
    try {
      const response = await aiApi.getSystemHealth();
      setHealth(response.data);
    } catch (loadError) {
      setHealthError(getApiErrorMessage(loadError));
    } finally {
      setIsHealthLoading(false);
    }
  };

  useEffect(() => {
    loadAI();
    loadHealth();
  }, []);

  const runAutomation = async () => {
    setIsRunning(true);
    try {
      const response = await aiApi.runAutomation();
      setSummary(response.data.summary);
      toast.success("Automation run completed");
      await loadAI();
    } catch (automationError) {
      toast.error(getApiErrorMessage(automationError));
    } finally {
      setIsRunning(false);
    }
  };

  if (isLoading) return <Loader label="Loading AI intelligence" />;

  const predictionCards = [
    { label: "Expected Weekly Appointments", value: forecast?.expectedWeeklyAppointments || 0, icon: CalendarClock },
    { label: "Expected Weekly Revenue", value: `INR ${forecast?.expectedWeeklyRevenue || 0}`, icon: IndianRupee },
    { label: "Refund Risk", value: forecast?.refundRisk || "normal", icon: Activity },
    { label: "Prediction Confidence", value: `${Math.round((forecast?.confidence || 0) * 100)}%`, icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">AI Command</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Predictive healthcare operations</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            AI system health, predictive forecasts, and platform-wide advisory generation. For the
            full operational command center (finance, workflow, governance, reputation), open{" "}
            <Link to="/admin/dashboard" className="font-bold text-royal-600 underline">Executive Command Center</Link>.
          </p>
        </div>
        <Button onClick={runAutomation} isLoading={isRunning}>
          <BellRing size={17} /> Run Automation
        </Button>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      <AISystemHealthCard health={health} isLoading={isHealthLoading} error={healthError} onRetry={loadHealth} />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {predictionCards.map((card) => (
          <Card key={card.label}>
            <card.icon className="text-blue-600" size={26} />
            <p className="mt-5 text-3xl font-black capitalize text-slate-950">{card.value}</p>
            <p className="mt-1 text-sm font-bold text-slate-500">{card.label}</p>
          </Card>
        ))}
      </div>

      {summary && (
        <Card title="Last Automation Run">
          <div className="grid gap-4 md:grid-cols-4">
            {Object.entries(summary).map(([key, value]) => (
              <div key={key} className="rounded-2xl bg-white/60 p-4 shadow-lg">
                <p className="text-2xl font-black text-slate-950">{value}</p>
                <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-slate-500">{key}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={t("sidebar.analytics")}>
        {insights.length ? (
          <div className="grid gap-6 lg:grid-cols-2">
            {insights.map((insight) => <AIInsightCard key={insight._id} insight={insight} />)}
          </div>
        ) : (
          <EmptyState title="No active insights" description="Generate insights to identify operational patterns." />
        )}
      </Card>

      <Card title="Schedule Optimization">
        <div className="space-y-3">
          {schedule.map((item) => (
            <div key={item.doctorId} className="flex flex-col justify-between gap-4 rounded-2xl bg-white/60 p-4 shadow-lg lg:flex-row lg:items-center">
              <div>
                <div className="flex items-center gap-2">
                  <BrainCircuit className="text-blue-600" size={18} />
                  <p className="font-black text-slate-950">{item.doctorName}</p>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-500">{item.specialization} - {item.load} upcoming appointments</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{item.recommendation}</p>
              </div>
              <span className="rounded-xl bg-blue-600/10 px-3 py-2 text-xs font-black capitalize text-blue-600">{item.status}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <AIDraftPanel
          title="AI: Executive Daily Brief"
          actionLabel="Generate brief"
          onGenerate={() => aiAssistApi.getExecutiveBrief()}
        />
        <AIDraftPanel
          title="AI: Review Sentiment Overview"
          actionLabel="Analyze sentiment"
          onGenerate={() => aiAssistApi.getReviewSentiment()}
        />
      </div>
    </div>
  );
}

export default AdminAIInsights;
