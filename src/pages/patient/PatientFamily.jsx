import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import AdminTable from "../../components/admin/AdminTable";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

const initial = { name: "", relation: "", age: "", gender: "female", bloodGroup: "", medicalConditions: "" };

function PatientFamily() {
  const [family, setFamily] = useState([]);
  const [form, setForm] = useState(initial);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    setIsLoading(true);
    try {
      const response = await patientWorkflowApi.getFamily();
      setFamily(response.data.familyMembers || []);
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
      await patientWorkflowApi.createFamily({ ...form, age: Number(form.age), medicalConditions: form.medicalConditions.split(",").map((x) => x.trim()).filter(Boolean) });
      toast.success("Family member added");
      setForm(initial);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <Loader label="Loading family accounts" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Family Accounts</p><h1 className="mt-2 text-3xl font-black text-slate-950">Dependents and care access</h1></div>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card title="Add Family Member">
          <form className="grid gap-4" onSubmit={submit}>
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Relation" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} />
            <Input label="Age" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
            <select className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select>
            <Input label="Blood group" value={form.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })} />
            <Input label="Medical conditions" value={form.medicalConditions} onChange={(e) => setForm({ ...form, medicalConditions: e.target.value })} />
            <Button type="submit" isLoading={isSaving}>Save Dependent</Button>
          </form>
        </Card>
        <Card title="Family Members">
          <AdminTable columns={[{ key: "name", header: "Name" }, { key: "relation", header: "Relation" }, { key: "age", header: "Age" }, { key: "bloodGroup", header: "Blood" }, { key: "medicalConditions", header: "Conditions", render: (r) => r.medicalConditions.join(", ") }]} data={family} />
        </Card>
      </div>
    </div>
  );
}

export default PatientFamily;
