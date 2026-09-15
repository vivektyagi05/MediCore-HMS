import { BrainCircuit, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { aiApi } from "../../api/aiApi";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import DoctorRecommendationCard from "../../components/ai/DoctorRecommendationCard";
import SmartSlotCard from "../../components/ai/SmartSlotCard";
import SymptomChecker from "../../components/ai/SymptomChecker";
import AIChatbotPanel from "../../components/chatbot/AIChatbotPanel";
import EmptyState from "../../components/shared/EmptyState";
import PersonalHealthNav from "../../components/health/PersonalHealthNav";
import Card from "../../components/ui/Card";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import { aiAssistApi } from "../../api/aiAssistApi";

const urgencyStyles = {
  routine: "bg-emerald-100 text-emerald-700",
  soon: "bg-blue-100 text-blue-700",
  urgent: "bg-red-100 text-red-700",
};

function PatientAIAssistant() {
  const toast = useToast();
  const { t } = useI18n();
  const [analysis, setAnalysis] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [slots, setSlots] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [healthScore, setHealthScore] = useState(null);
  const [recentDrafts, setRecentDrafts] = useState([]);

  useEffect(() => {
    patientWorkflowApi.getHealthProfile().then((res) => setHealthScore(res.data.healthScore)).catch(() => {});
    aiAssistApi.listDrafts({ limit: 8 }).then((res) => setRecentDrafts(res.data.drafts || [])).catch(() => {});
  }, []);

  const analyze = async (payload) => {
    setIsAnalyzing(true);
    setSlots([]);
    try {
      const response = await aiApi.analyzeSymptoms(payload);
      setAnalysis(response.data.analysis);
      setRecommendations(response.data.recommendations || []);
      toast.success(t("ui.aiSuggestionsGenerated"));
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const suggestSlots = async (doctorId) => {
    setIsLoadingSlots(true);
    try {
      const response = await aiApi.suggestSlots({ doctorId });
      setSlots(response.data.suggestions || []);
      toast.success(t("ui.smartSlotsGenerated"));
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoadingSlots(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">{t("ui.aiHealthcare")}</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">{t("ui.smartAssistant")}</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
          Safe triage suggestions, doctor matching, smart slot discovery, and support guidance.
        </p>
      </div>

      <PersonalHealthNav healthScore={healthScore} active="ai" />

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card title={t("ui.symptomChecker")}>
          <SymptomChecker onAnalyze={analyze} isLoading={isAnalyzing} />
        </Card>

        <div className="space-y-6">
          <Card title="AI Result">
            {analysis ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded-xl px-3 py-2 text-xs font-black capitalize ${urgencyStyles[analysis.urgency]}`}>
                    {analysis.urgency}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-xl bg-blue-600/10 px-3 py-2 text-xs font-black text-blue-600">
                    <Sparkles size={14} /> Recommendation only
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {analysis.suggestedDepartments.map((department) => (
                    <div key={department} className="rounded-2xl bg-white/60 p-4 shadow-lg">
                      <BrainCircuit className="text-blue-600" size={20} />
                      <p className="mt-3 font-black text-slate-950">{department}</p>
                    </div>
                  ))}
                </div>
                <p className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-800">{analysis.recommendationText}</p>
                {analysis.safetyFlags?.map((flag) => (
                  <p key={flag} className="rounded-2xl bg-red-50 p-4 text-sm font-bold leading-6 text-red-700">{flag}</p>
                ))}
              </div>
            ) : (
              <EmptyState title="No analysis yet" description="Enter symptoms to get department and specialist suggestions." />
            )}
          </Card>

          <AIChatbotPanel />
        </div>
      </div>

      <Card title="Recommended Doctors">
        {recommendations.length ? (
          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {recommendations.map((recommendation) => (
              <DoctorRecommendationCard
                key={recommendation.doctor._id}
                recommendation={recommendation}
                onSuggestSlots={suggestSlots}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No recommendations yet" description="AI doctor matches appear after symptom analysis." />
        )}
      </Card>

      <Card title={isLoadingSlots ? "Generating Smart Slots" : "Smart Slot Suggestions"}>
        {slots.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {slots.map((slot) => (
              <SmartSlotCard key={`${slot.doctorId}-${slot.date}-${slot.timeSlot}`} slot={slot} />
            ))}
          </div>
        ) : (
          <EmptyState title="No smart slots selected" description="Choose Smart Slots on a recommended doctor." />
        )}
      </Card>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="What needs my attention?">
          <AIDraftPanel
            title="AI: My Follow-ups"
            actionLabel="Check follow-ups"
            onGenerate={() => aiAssistApi.getWorkflowSuggestions()}
            compact
          />
          <p className="mt-3 text-xs text-slate-500">
            For document summaries and prescription explanations, open a report or prescription from your Digital Records page.
          </p>
        </Card>
        <Card title="AI: Health Profile Review">
          <AIDraftPanel
            title="Review my health profile"
            actionLabel="Review profile"
            onGenerate={() => aiAssistApi.getHealthProfileReview()}
            compact
          />
        </Card>
        <Card title="AI: Health Journey Summary">
          <AIDraftPanel
            title="Summarize my journey"
            actionLabel="Summarize journey"
            onGenerate={() => aiAssistApi.getHealthJourneySummary()}
            compact
          />
        </Card>
      </div>

      <Card title="Recent AI Activity">
        {recentDrafts.length ? (
          <div className="space-y-2">
            {recentDrafts.map((draft) => (
              <div key={draft._id} className="flex items-center justify-between gap-3 rounded-xl bg-white/60 p-3 shadow-sm">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-950">{draft.promptKey.replace(/([A-Z])/g, " $1")}</p>
                  <p className="text-xs font-semibold text-slate-500">{new Date(draft.createdAt).toLocaleString()}</p>
                </div>
                <span className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase ${draft.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {draft.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No AI activity yet" description="Generated summaries, reviews, and explanations you request will show up here." />
        )}
      </Card>
    </div>
  );
}

export default PatientAIAssistant;
