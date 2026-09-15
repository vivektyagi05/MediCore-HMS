import { Bell, Download, HeartPulse, Plus, ShieldCheck, Stethoscope, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import PersonalHealthNav from "../../components/health/PersonalHealthNav";
import { MiniDonut } from "../../components/finance/FinanceCharts";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

const selectClass = "w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10";

function LabeledSelect({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700">{label}</span>
      <select className={selectClass} value={value || ""} onChange={onChange}>
        <option value="">Not specified</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

const emptyProfile = {
  dateOfBirth: "",
  gender: "",
  bloodGroup: "",
  emergencyContact: { name: "", phone: "", relation: "" },
  allergies: "",
  address: "",
  medicalConditions: "",
  medications: [],
  lifestyle: { smokingStatus: "", alcoholConsumption: "", exerciseFrequency: "", dietType: "", sleepHoursAvg: "" },
  vitals: { heightCm: "", weightKg: "", bloodPressureSystolic: "", bloodPressureDiastolic: "", restingHeartRate: "" },
  healthGoals: [],
  preferredSpecializations: "",
  healthPreferences: { reminderOptIn: true, preferredConsultationMode: "" },
};

function PatientProfile() {
  const [overview, setOverview] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [profile, setProfile] = useState(emptyProfile);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    setIsLoading(true);
    try {
      const [healthProfileRes, notificationRes] = await Promise.all([
        patientWorkflowApi.getHealthProfile(),
        patientWorkflowApi.getNotifications(),
      ]);
      setOverview(healthProfileRes.data);
      setNotifications(notificationRes.data.notifications || []);
      const saved = healthProfileRes.data.profile || {};
      setProfile({
        ...emptyProfile,
        ...saved,
        dateOfBirth: saved.dateOfBirth ? new Date(saved.dateOfBirth).toISOString().slice(0, 10) : "",
        allergies: saved.allergies?.join(", ") || "",
        medicalConditions: saved.medicalConditions?.join(", ") || "",
        preferredSpecializations: saved.preferredSpecializations?.join(", ") || "",
        emergencyContact: { ...emptyProfile.emergencyContact, ...saved.emergencyContact },
        lifestyle: { ...emptyProfile.lifestyle, ...saved.lifestyle },
        vitals: { ...emptyProfile.vitals, ...saved.vitals },
        healthPreferences: { ...emptyProfile.healthPreferences, ...saved.healthPreferences },
        medications: saved.medications?.length ? saved.medications : [],
        healthGoals: saved.healthGoals?.length ? saved.healthGoals.map((g) => ({ ...g, targetDate: g.targetDate ? new Date(g.targetDate).toISOString().slice(0, 10) : "" })) : [],
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveProfile = async () => {
    setIsSaving(true);
    try {
      const payload = {
        ...profile,
        allergies: profile.allergies.split(",").map((item) => item.trim()).filter(Boolean),
        medicalConditions: profile.medicalConditions.split(",").map((item) => item.trim()).filter(Boolean),
        preferredSpecializations: profile.preferredSpecializations.split(",").map((item) => item.trim()).filter(Boolean),
        vitals: {
          ...profile.vitals,
          heightCm: profile.vitals.heightCm ? Number(profile.vitals.heightCm) : undefined,
          weightKg: profile.vitals.weightKg ? Number(profile.vitals.weightKg) : undefined,
          bloodPressureSystolic: profile.vitals.bloodPressureSystolic ? Number(profile.vitals.bloodPressureSystolic) : undefined,
          bloodPressureDiastolic: profile.vitals.bloodPressureDiastolic ? Number(profile.vitals.bloodPressureDiastolic) : undefined,
          restingHeartRate: profile.vitals.restingHeartRate ? Number(profile.vitals.restingHeartRate) : undefined,
          recordedAt: profile.vitals.heightCm || profile.vitals.weightKg ? new Date() : undefined,
        },
        lifestyle: {
          ...profile.lifestyle,
          sleepHoursAvg: profile.lifestyle.sleepHoursAvg ? Number(profile.lifestyle.sleepHoursAvg) : undefined,
        },
        medications: profile.medications.filter((m) => m.name?.trim()),
        healthGoals: profile.healthGoals.filter((g) => g.title?.trim()),
      };
      await patientWorkflowApi.updateProfile({ patientProfile: payload });
      toast.success("Health profile updated");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const exportData = async (resource, format) => {
    const blob = await patientWorkflowApi.exportData({ resource, format });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${resource}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const addMedication = () => setProfile({ ...profile, medications: [...profile.medications, { name: "", dosage: "", frequency: "" }] });
  const updateMedication = (index, key, value) => {
    const next = [...profile.medications];
    next[index] = { ...next[index], [key]: value };
    setProfile({ ...profile, medications: next });
  };
  const removeMedication = (index) => setProfile({ ...profile, medications: profile.medications.filter((_, i) => i !== index) });

  const addGoal = () => setProfile({ ...profile, healthGoals: [...profile.healthGoals, { title: "", targetDate: "", status: "active" }] });
  const updateGoal = (index, key, value) => {
    const next = [...profile.healthGoals];
    next[index] = { ...next[index], [key]: value };
    setProfile({ ...profile, healthGoals: next });
  };
  const removeGoal = (index) => setProfile({ ...profile, healthGoals: profile.healthGoals.filter((_, i) => i !== index) });

  if (isLoading) return <Loader label="Loading your health profile" />;

  const healthScore = overview?.healthScore || 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Personal Health Intelligence Platform</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Health Profile</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
          Your complete health identity — conditions, medications, lifestyle, vitals, goals, and care preferences, all connected to your records.
        </p>
      </div>

      <PersonalHealthNav healthScore={healthScore} active="profile" />

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card title="Health Score">
          <div className="flex items-center gap-6">
            <MiniDonut segments={[{ value: healthScore, label: "Complete" }, { value: 100 - healthScore, label: "Remaining" }]} size={120} thickness={14} />
            <div>
              <p className="text-3xl font-black text-slate-950">{healthScore}%</p>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                {overview?.missing?.length ? `Missing: ${overview.missing.join(", ")}` : "Every core field is on file."}
              </p>
            </div>
          </div>
        </Card>
        <Card title="AI: Profile Review">
          <AIDraftPanel
            title="AI Health Profile Review"
            actionLabel="Review my profile"
            onGenerate={() => aiAssistApi.getHealthProfileReview()}
            compact
          />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Personal & Emergency Information">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Date of birth" type="date" value={profile.dateOfBirth} onChange={(e) => setProfile({ ...profile, dateOfBirth: e.target.value })} />
            <LabeledSelect label="Gender" value={profile.gender} onChange={(e) => setProfile({ ...profile, gender: e.target.value })} options={["male", "female", "other", "prefer_not_to_say"]} />
            <Input label="Blood group" value={profile.bloodGroup || ""} onChange={(e) => setProfile({ ...profile, bloodGroup: e.target.value })} />
            <Input label="Address" value={profile.address || ""} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
            <Input label="Emergency contact name" value={profile.emergencyContact?.name || ""} onChange={(e) => setProfile({ ...profile, emergencyContact: { ...profile.emergencyContact, name: e.target.value } })} />
            <Input label="Emergency contact phone" value={profile.emergencyContact?.phone || ""} onChange={(e) => setProfile({ ...profile, emergencyContact: { ...profile.emergencyContact, phone: e.target.value } })} />
            <Input label="Emergency contact relation" value={profile.emergencyContact?.relation || ""} onChange={(e) => setProfile({ ...profile, emergencyContact: { ...profile.emergencyContact, relation: e.target.value } })} />
          </div>
        </Card>

        <Card title="Medical Conditions & Allergies">
          <div className="grid gap-4">
            <Input label="Medical conditions (comma separated)" value={profile.medicalConditions || ""} onChange={(e) => setProfile({ ...profile, medicalConditions: e.target.value })} />
            <Input label="Allergies (comma separated)" value={profile.allergies || ""} onChange={(e) => setProfile({ ...profile, allergies: e.target.value })} />
          </div>
        </Card>

        <Card
          title="Current Medications"
          action={<Button variant="secondary" onClick={addMedication}><Plus size={14} /> Add</Button>}
        >
          {profile.medications.length ? (
            <div className="space-y-3">
              {profile.medications.map((med, index) => (
                <div key={index} className="grid gap-2 rounded-xl bg-white/60 p-3 shadow-sm sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <Input label="Name" value={med.name || ""} onChange={(e) => updateMedication(index, "name", e.target.value)} />
                  <Input label="Dosage" value={med.dosage || ""} onChange={(e) => updateMedication(index, "dosage", e.target.value)} />
                  <Input label="Frequency" value={med.frequency || ""} onChange={(e) => updateMedication(index, "frequency", e.target.value)} />
                  <button type="button" className="mt-8 flex h-10 w-10 items-center justify-center rounded-xl text-red-600 hover:bg-red-50" onClick={() => removeMedication(index)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-slate-400">No medications recorded yet.</p>
          )}
        </Card>

        <Card title="Vitals">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Height (cm)" type="number" value={profile.vitals.heightCm || ""} onChange={(e) => setProfile({ ...profile, vitals: { ...profile.vitals, heightCm: e.target.value } })} />
            <Input label="Weight (kg)" type="number" value={profile.vitals.weightKg || ""} onChange={(e) => setProfile({ ...profile, vitals: { ...profile.vitals, weightKg: e.target.value } })} />
            <Input label="Blood pressure (systolic)" type="number" value={profile.vitals.bloodPressureSystolic || ""} onChange={(e) => setProfile({ ...profile, vitals: { ...profile.vitals, bloodPressureSystolic: e.target.value } })} />
            <Input label="Blood pressure (diastolic)" type="number" value={profile.vitals.bloodPressureDiastolic || ""} onChange={(e) => setProfile({ ...profile, vitals: { ...profile.vitals, bloodPressureDiastolic: e.target.value } })} />
            <Input label="Resting heart rate" type="number" value={profile.vitals.restingHeartRate || ""} onChange={(e) => setProfile({ ...profile, vitals: { ...profile.vitals, restingHeartRate: e.target.value } })} />
          </div>
          {overview?.bmi?.value ? (
            <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-700">
              BMI: {overview.bmi.value} ({overview.bmi.category})
            </p>
          ) : (
            <p className="mt-4 text-xs font-semibold text-slate-400">Add height and weight to see your BMI.</p>
          )}
        </Card>

        <Card title="Lifestyle">
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledSelect label="Smoking status" value={profile.lifestyle.smokingStatus} onChange={(e) => setProfile({ ...profile, lifestyle: { ...profile.lifestyle, smokingStatus: e.target.value } })} options={["never", "former", "current"]} />
            <LabeledSelect label="Alcohol consumption" value={profile.lifestyle.alcoholConsumption} onChange={(e) => setProfile({ ...profile, lifestyle: { ...profile.lifestyle, alcoholConsumption: e.target.value } })} options={["none", "occasional", "moderate", "frequent"]} />
            <LabeledSelect label="Exercise frequency" value={profile.lifestyle.exerciseFrequency} onChange={(e) => setProfile({ ...profile, lifestyle: { ...profile.lifestyle, exerciseFrequency: e.target.value } })} options={["sedentary", "light", "moderate", "active"]} />
            <Input label="Diet type" value={profile.lifestyle.dietType || ""} onChange={(e) => setProfile({ ...profile, lifestyle: { ...profile.lifestyle, dietType: e.target.value } })} />
            <Input label="Average sleep (hours)" type="number" value={profile.lifestyle.sleepHoursAvg || ""} onChange={(e) => setProfile({ ...profile, lifestyle: { ...profile.lifestyle, sleepHoursAvg: e.target.value } })} />
          </div>
        </Card>

        <Card
          title="Health Goals"
          action={<Button variant="secondary" onClick={addGoal}><Plus size={14} /> Add</Button>}
        >
          {profile.healthGoals.length ? (
            <div className="space-y-3">
              {profile.healthGoals.map((goal, index) => (
                <div key={index} className="grid gap-2 rounded-xl bg-white/60 p-3 shadow-sm sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                  <Input label="Goal" value={goal.title || ""} onChange={(e) => updateGoal(index, "title", e.target.value)} />
                  <Input label="Target date" type="date" value={goal.targetDate || ""} onChange={(e) => updateGoal(index, "targetDate", e.target.value)} />
                  <LabeledSelect label="Status" value={goal.status} onChange={(e) => updateGoal(index, "status", e.target.value)} options={["active", "achieved", "abandoned"]} />
                  <button type="button" className="mt-8 flex h-10 w-10 items-center justify-center rounded-xl text-red-600 hover:bg-red-50" onClick={() => removeGoal(index)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-slate-400">No health goals set yet.</p>
          )}
        </Card>

        <Card title="Doctor Preferences & Primary Physician">
          <div className="space-y-4">
            <Input label="Preferred specializations (comma separated)" value={profile.preferredSpecializations || ""} onChange={(e) => setProfile({ ...profile, preferredSpecializations: e.target.value })} />
            <LabeledSelect label="Preferred consultation mode" value={profile.healthPreferences.preferredConsultationMode} onChange={(e) => setProfile({ ...profile, healthPreferences: { ...profile.healthPreferences, preferredConsultationMode: e.target.value } })} options={["in_person", "video", "either"]} />
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={Boolean(profile.healthPreferences.reminderOptIn)} onChange={(e) => setProfile({ ...profile, healthPreferences: { ...profile.healthPreferences, reminderOptIn: e.target.checked } })} />
              Send me appointment and follow-up reminders
            </label>
            <div className="rounded-2xl bg-white/60 p-4 shadow-sm">
              {overview?.primaryPhysician?.doctorId ? (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><Stethoscope size={18} /></div>
                  <div>
                    <p className="font-black text-slate-950">Dr. {overview.primaryPhysician.doctorId.userId?.name}</p>
                    <p className="text-xs font-bold text-slate-500">{overview.primaryPhysician.doctorId.specialization} • Primary physician</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm font-semibold text-slate-500">
                  No primary physician set. Mark one from your <a href="/patient/saved-doctors" className="font-black text-blue-600 hover:underline">Saved Doctors</a> page.
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card title="Insurance Summary" action={<a href="/patient/insurance" className="text-xs font-black text-blue-600 hover:underline">Manage insurance</a>}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><ShieldCheck size={18} /></div>
            <div>
              <p className="font-black text-slate-950">{overview?.insuranceSummary?.total || 0} polic{overview?.insuranceSummary?.total === 1 ? "y" : "ies"} on file</p>
              {overview?.insuranceSummary?.expiringSoon ? (
                <p className="text-xs font-bold text-amber-600">{overview.insuranceSummary.expiringSoon} expiring within 30 days</p>
              ) : (
                <p className="text-xs font-bold text-slate-500">No policies expiring soon</p>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button isLoading={isSaving} onClick={saveProfile}><HeartPulse size={16} /> Save Health Profile</Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Notifications">
          <div className="space-y-3">
            {notifications.length ? notifications.map((item, index) => (
              <div key={index} className="flex gap-3 rounded-2xl bg-white/60 p-4 shadow-lg">
                <Bell className="text-blue-600" size={20} />
                <div><p className="font-black text-slate-950">{item.message}</p><p className="text-xs font-bold text-slate-500">{item.type}</p></div>
              </div>
            )) : <p className="text-sm font-semibold text-slate-400">No notifications yet.</p>}
          </div>
        </Card>
        <Card title="Exports">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => exportData("appointments", "csv")}><Download size={16} /> Appointments CSV</Button>
            <Button variant="secondary" onClick={() => exportData("reports", "pdf")}>Reports PDF</Button>
            <Button variant="secondary" onClick={() => exportData("prescriptions", "csv")}>Prescriptions CSV</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default PatientProfile;
