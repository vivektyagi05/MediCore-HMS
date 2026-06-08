import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import InsuranceCard from "../../components/insurance/InsuranceCard";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

const initial = { provider: "", policyNumber: "", policyHolder: "", validTill: "", coverageAmount: "", file: null };

function PatientInsurance() {
  const [policies, setPolicies] = useState([]);
  const [form, setForm] = useState(initial);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    setIsLoading(true);
    try {
      const response = await patientWorkflowApi.getInsurance();
      setPolicies(response.data.policies || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    const formData = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === "file" && value) formData.append("document", value);
      else formData.append(key, value);
    });
    setIsSaving(true);
    try {
      await patientWorkflowApi.createInsurance(formData);
      toast.success("Insurance saved");
      setForm(initial);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <Loader label="Loading insurance" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Insurance</p><h1 className="mt-2 text-3xl font-black text-slate-950">Policies and claim readiness</h1></div>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card title="Add Policy">
          <form className="grid gap-4" onSubmit={submit}>
            <Input label="Provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
            <Input label="Policy number" value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} />
            <Input label="Policy holder" value={form.policyHolder} onChange={(e) => setForm({ ...form, policyHolder: e.target.value })} />
            <Input label="Valid till" type="date" value={form.validTill} onChange={(e) => setForm({ ...form, validTill: e.target.value })} />
            <Input label="Coverage amount" type="number" value={form.coverageAmount} onChange={(e) => setForm({ ...form, coverageAmount: e.target.value })} />
            <input type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} className="rounded-xl bg-white/70 p-3 text-sm" />
            <Button type="submit" isLoading={isSaving}>Save Policy</Button>
          </form>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">{policies.map((policy) => <InsuranceCard key={policy._id} policy={policy} />)}</div>
      </div>
    </div>
  );
}

export default PatientInsurance;
