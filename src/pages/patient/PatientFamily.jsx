import { Heart, Phone, Trash2, User, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import AdminModal from "../../components/admin/AdminModal";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import HealthEcosystemNav from "../../components/health/HealthEcosystemNav";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const initial = {
  name: "",
  relation: "",
  age: "",
  gender: "female",
  bloodGroup: "",
  medicalConditions: "",
  emergencyContact: { name: "", phone: "", relation: "" },
};

function relationBadge(age) {
  if (age == null) return "";
  if (age < 18) return "Child";
  if (age >= 60) return "Senior";
  return "Adult";
}

function PatientFamily() {
  const [overview, setOverview] = useState(null);
  const [family, setFamily] = useState([]);
  const [form, setForm] = useState(initial);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [workspace, setWorkspace] = useState(null);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const toast = useToast();
  const { t } = useI18n();

  const load = async () => {
    setIsLoading(true);
    try {
      const [overviewRes, familyRes] = await Promise.all([
        patientWorkflowApi.getEcosystemOverview(),
        patientWorkflowApi.getFamily(),
      ]);
      setOverview(overviewRes.data);
      setFamily(familyRes.data.familyMembers || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await patientWorkflowApi.createFamily({
        ...form,
        age: Number(form.age),
        medicalConditions: form.medicalConditions.split(",").map((x) => x.trim()).filter(Boolean),
      });
      toast.success("Family member added");
      setForm(initial);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (member) => {
    if (!window.confirm(`Remove ${member.name} from your family accounts?`)) return;
    try {
      await patientWorkflowApi.removeFamily(member._id);
      toast.success("Family member removed");
      if (workspace?.familyMember?._id === member._id) setWorkspace(null);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const openWorkspace = async (member) => {
    setIsWorkspaceLoading(true);
    try {
      const response = await patientWorkflowApi.getFamilyWorkspace(member._id);
      setWorkspace(response.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsWorkspaceLoading(false);
    }
  };

  if (isLoading) return <Loader label="Loading family accounts" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Digital Health Ecosystem</p><h1 className="mt-2 text-3xl font-black text-slate-950">Family Health Center</h1></div>
      <HealthEcosystemNav overview={overview} active="family" />
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card title={t("patient.family.add")}>
          <form className="grid gap-4" onSubmit={submit}>
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label="Relation" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} placeholder="Spouse, child, parent..." required />
            <Input label="Age" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} required />
            <select className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select>
            <Input label="Blood group" value={form.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })} />
            <Input label="Medical conditions" value={form.medicalConditions} onChange={(e) => setForm({ ...form, medicalConditions: e.target.value })} placeholder="comma, separated" />
            <div className="rounded-xl border border-slate-200 bg-white/50 p-4">
              <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Emergency contact</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input placeholder="Name" value={form.emergencyContact.name} onChange={(e) => setForm({ ...form, emergencyContact: { ...form.emergencyContact, name: e.target.value } })} />
                <Input placeholder="Phone" value={form.emergencyContact.phone} onChange={(e) => setForm({ ...form, emergencyContact: { ...form.emergencyContact, phone: e.target.value } })} />
                <Input placeholder="Relation" value={form.emergencyContact.relation} onChange={(e) => setForm({ ...form, emergencyContact: { ...form.emergencyContact, relation: e.target.value } })} />
              </div>
            </div>
            <Button type="submit" isLoading={isSaving}>Save Dependent</Button>
          </form>
        </Card>
        <div className="space-y-4">
          {family.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {family.map((member) => (
                <Card key={member._id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg"><User size={20} /></div>
                    <button onClick={() => remove(member)} className="rounded-lg p-2 text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                  <p className="mt-4 text-lg font-black text-slate-950">{member.name}</p>
                  <p className="text-sm font-semibold text-slate-500">{member.relation} • {member.age} yrs • {relationBadge(member.age)}</p>
                  {member.bloodGroup && <p className="mt-1 text-xs font-bold text-blue-600">Blood group {member.bloodGroup}</p>}
                  {member.medicalConditions?.length ? <p className="mt-2 text-xs text-slate-500">{member.medicalConditions.join(", ")}</p> : null}
                  {member.emergencyContact?.phone && (
                    <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-slate-500"><Phone size={12} /> {member.emergencyContact.name} — {member.emergencyContact.phone}</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => openWorkspace(member)}>View health workspace</Button>
                    <Button to="/patient/doctors">Book appointment</Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState title="No dependents added" description="Add a family member to manage their appointments, records, and insurance from one place." />
          )}
          <Card title="AI: Family Health Insights">
            <AIDraftPanel
              title="AI Assist"
              actionLabel="Generate insights"
              onGenerate={() => aiAssistApi.getFamilyInsights()}
              compact
            />
          </Card>
        </div>
      </div>

      <AdminModal isOpen={Boolean(workspace) || isWorkspaceLoading} title={workspace?.familyMember?.name ? `${workspace.familyMember.name}'s health workspace` : "Health workspace"} onClose={() => setWorkspace(null)}>
        {isWorkspaceLoading && <Loader label="Loading workspace" />}
        {workspace && !isWorkspaceLoading && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-white/70 p-3"><p className="text-2xl font-black text-blue-600">{workspace.appointmentCount}</p><p className="text-xs font-bold text-slate-500">Appointments</p></div>
              <div className="rounded-xl bg-white/70 p-3"><p className="text-2xl font-black text-blue-600">{workspace.reportCount}</p><p className="text-xs font-bold text-slate-500">Records</p></div>
              <div className="rounded-xl bg-white/70 p-3"><p className="text-2xl font-black text-blue-600">{workspace.insurancePolicies?.length || 0}</p><p className="text-xs font-bold text-slate-500">Policies</p></div>
            </div>
            {workspace.upcomingAppointment ? (
              <div className="rounded-xl bg-blue-50/70 p-4">
                <p className="flex items-center gap-2 text-sm font-black text-blue-700"><Heart size={14} /> Upcoming visit</p>
                <p className="mt-1 text-sm text-slate-700">Dr. {workspace.upcomingAppointment.doctorId?.userId?.name || "Doctor"} on {new Date(workspace.upcomingAppointment.date).toLocaleDateString()} ({workspace.upcomingAppointment.timeSlot})</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No upcoming appointments scheduled.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button to={`/patient/records?familyMemberId=${workspace.familyMember._id}`}>View records</Button>
              <Button variant="secondary" to={`/patient/insurance?familyMemberId=${workspace.familyMember._id}`}>View insurance</Button>
            </div>
          </div>
        )}
      </AdminModal>
    </div>
  );
}

export default PatientFamily;
