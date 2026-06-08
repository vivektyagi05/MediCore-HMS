import { Activity, BellRing, BrainCircuit, CalendarClock, IndianRupee, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { aiApi } from "../../api/aiApi";
import AIInsightCard from "../../components/insights/AIInsightCard";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

function AdminAIInsights() {
  const toast = useToast();
  const [insights, setInsights] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");

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

  useEffect(() => {
    loadAI();
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
        </div>
        <Button onClick={runAutomation} isLoading={isRunning}>
          <BellRing size={17} /> Run Automation
        </Button>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

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

      <Card title="AI Insights">
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
    </div>
  );
}

export default AdminAIInsights;
