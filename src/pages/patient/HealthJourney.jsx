import { Activity, CalendarClock, CheckCircle2, FileText, Receipt, Stethoscope, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import PersonalHealthNav from "../../components/health/PersonalHealthNav";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useToast } from "../../context/ToastContext";

const TIMELINE_ICON = {
  appointment: Stethoscope,
  prescription: FileText,
  report: FileText,
  payment: Receipt,
};

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function HealthJourney() {
  const [journey, setJourney] = useState(null);
  const [healthScore, setHealthScore] = useState(null);
  const [family, setFamily] = useState([]);
  const [familyMemberId, setFamilyMemberId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const toast = useToast();

  const load = async (memberId) => {
    setIsLoading(true);
    try {
      const [journeyRes, familyRes, healthProfileRes] = await Promise.all([
        patientWorkflowApi.getHealthJourney(memberId ? { familyMemberId: memberId } : {}),
        patientWorkflowApi.getFamily(),
        patientWorkflowApi.getHealthProfile(),
      ]);
      setJourney(journeyRes.data);
      setFamily(familyRes.data.familyMembers || []);
      setHealthScore(healthProfileRes.data.healthScore);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (isLoading) return <Loader label="Loading your health journey" />;

  const timeline = journey?.timeline || [];
  const milestones = journey?.milestones || [];
  const nextAction = journey?.nextAction;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Personal Health Intelligence Platform</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Personal Health Journey</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
          Your longitudinal healthcare story — every appointment, report, prescription, and payment, connected chronologically.
        </p>
      </div>

      <PersonalHealthNav healthScore={healthScore} active="journey" />

      {family.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Viewing journey for</span>
          <select
            className="rounded-xl border border-slate-200 bg-white/70 px-4 py-2 text-sm"
            value={familyMemberId}
            onChange={(e) => { setFamilyMemberId(e.target.value); load(e.target.value); }}
          >
            <option value="">Myself</option>
            {family.map((member) => (
              <option key={member._id} value={member._id}>{member.name} ({member.relation})</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card title="Next Recommended Action">
          {nextAction ? (
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white"><Target size={20} /></div>
              <div>
                <p className="font-black text-slate-950">{nextAction.label}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">{nextAction.type?.replace(/_/g, " ")}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm font-semibold text-slate-400">No recommendation available yet.</p>
          )}
        </Card>
        <Card title="AI: Journey Summary">
          <AIDraftPanel
            title="AI Health Journey Summary"
            actionLabel="Summarize my journey"
            onGenerate={() => aiAssistApi.getHealthJourneySummary(familyMemberId ? { familyMemberId } : {})}
            compact
          />
        </Card>
      </div>

      {milestones.length > 0 && (
        <Card title="Milestones">
          <div className="grid gap-4 sm:grid-cols-3">
            {milestones.map((milestone) => (
              <div key={milestone.label} className="flex items-center gap-3 rounded-2xl bg-white/60 p-4 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><CheckCircle2 size={18} /></div>
                <div>
                  <p className="text-xl font-black text-slate-950">{milestone.value}</p>
                  <p className="text-xs font-bold text-slate-500">{milestone.label}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {journey?.upcomingAppointment && (
        <Card title="Upcoming">
          <div className="flex items-center gap-3 rounded-2xl bg-blue-50 p-4">
            <CalendarClock className="text-blue-600" size={22} />
            <p className="text-sm font-bold text-blue-800">
              Appointment on {formatDate(journey.upcomingAppointment.date)} at {journey.upcomingAppointment.timeSlot}
            </p>
          </div>
        </Card>
      )}

      <Card title="Chronological Timeline">
        {timeline.length ? (
          <div className="space-y-3">
            {timeline.map((item, index) => {
              const Icon = TIMELINE_ICON[item.type] || Activity;
              return (
                <div key={`${item.type}-${index}`} className="flex items-start gap-3 rounded-2xl bg-white/60 p-4 shadow-sm">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-black text-slate-950">{item.title}</p>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{item.type} • {formatDate(item.date)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No health activity yet" description="Appointments, reports, and prescriptions will appear here chronologically as they happen." />
        )}
      </Card>
    </div>
  );
}

export default HealthJourney;
