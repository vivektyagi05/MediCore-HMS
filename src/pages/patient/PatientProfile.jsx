import { Bell, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import ProfileCompletionCard from "../../components/patient/ProfileCompletionCard";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

function PatientProfile() {
  const [completion, setCompletion] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [profile, setProfile] = useState({ bloodGroup: "", allergies: "", emergencyContact: { name: "", phone: "", relation: "" }, address: "" });
  const [isLoading, setIsLoading] = useState(true);
  const toast = useToast();

  const load = async () => {
    setIsLoading(true);
    try {
      const [completionRes, notificationRes] = await Promise.all([patientWorkflowApi.getProfileCompletion(), patientWorkflowApi.getNotifications()]);
      setCompletion(completionRes.data);
      setNotifications(notificationRes.data.notifications || []);
      const saved = completionRes.data.profile || {};
      setProfile({ ...profile, ...saved, allergies: saved.allergies?.join(", ") || "" });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveProfile = async () => {
    try {
      await patientWorkflowApi.updateProfile({ patientProfile: { ...profile, allergies: profile.allergies.split(",").map((item) => item.trim()).filter(Boolean) } });
      toast.success("Profile updated");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
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

  if (isLoading) return <Loader label="Loading patient profile" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Patient Profile</p><h1 className="mt-2 text-3xl font-black text-slate-950">Health identity and notifications</h1></div>
      <ProfileCompletionCard completion={completion} />
      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card title="Profile Details">
          <div className="grid gap-4">
            <Input label="Blood group" value={profile.bloodGroup || ""} onChange={(e) => setProfile({ ...profile, bloodGroup: e.target.value })} />
            <Input label="Allergies" value={profile.allergies || ""} onChange={(e) => setProfile({ ...profile, allergies: e.target.value })} />
            <Input label="Emergency contact name" value={profile.emergencyContact?.name || ""} onChange={(e) => setProfile({ ...profile, emergencyContact: { ...profile.emergencyContact, name: e.target.value } })} />
            <Input label="Emergency contact phone" value={profile.emergencyContact?.phone || ""} onChange={(e) => setProfile({ ...profile, emergencyContact: { ...profile.emergencyContact, phone: e.target.value } })} />
            <Input label="Address" value={profile.address || ""} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
            <Button onClick={saveProfile}>Save Profile</Button>
          </div>
        </Card>
        <Card title="Notifications">
          <div className="space-y-3">{notifications.map((item, index) => <div key={index} className="flex gap-3 rounded-2xl bg-white/60 p-4 shadow-lg"><Bell className="text-blue-600" size={20} /><div><p className="font-black text-slate-950">{item.message}</p><p className="text-xs font-bold text-slate-500">{item.type}</p></div></div>)}</div>
        </Card>
      </div>
      <Card title="Exports">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => exportData("appointments", "csv")}><Download size={16} /> Appointments CSV</Button>
          <Button variant="secondary" onClick={() => exportData("reports", "pdf")}>Reports PDF</Button>
          <Button variant="secondary" onClick={() => exportData("prescriptions", "csv")}>Prescriptions CSV</Button>
        </div>
      </Card>
    </div>
  );
}

export default PatientProfile;
