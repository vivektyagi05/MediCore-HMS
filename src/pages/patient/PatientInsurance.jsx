import { AlertTriangle, FileCheck, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getApiErrorMessage } from "../../api/axios";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import AdminModal from "../../components/admin/AdminModal";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import HealthEcosystemNav from "../../components/health/HealthEcosystemNav";
import { MiniDonut } from "../../components/finance/FinanceCharts";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const initial = { provider: "", policyNumber: "", policyHolder: "", validTill: "", coverageAmount: "", familyMemberId: "", file: null };

function daysUntil(date) {
  return Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));
}

function PatientInsurance() {
  const [params] = useSearchParams();
  const [overview, setOverview] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [family, setFamily] = useState([]);
  const [form, setForm] = useState(initial);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [claimAmount, setClaimAmount] = useState("");
  const [claimNotes, setClaimNotes] = useState("");
  const toast = useToast();
  const { t } = useI18n();

  const load = async () => {
    setIsLoading(true);
    try {
      const [overviewRes, policyRes, familyRes] = await Promise.all([
        patientWorkflowApi.getEcosystemOverview(),
        patientWorkflowApi.getInsurance({ familyMemberId: params.get("familyMemberId") || undefined }),
        patientWorkflowApi.getFamily(),
      ]);
      setOverview(overviewRes.data);
      setPolicies(policyRes.data.policies || []);
      setFamily(familyRes.data.familyMembers || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [params.toString()]);

  const submit = async (event) => {
    event.preventDefault();
    const formData = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === "file" && value) formData.append("document", value);
      else if (value) formData.append(key, value);
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

  const removePolicy = async (policy) => {
    if (!window.confirm(`Delete the ${policy.provider} policy?`)) return;
    try {
      await patientWorkflowApi.deleteInsurance(policy._id);
      toast.success("Policy deleted");
      if (detail?.policy?._id === policy._id) setDetail(null);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const openDetail = async (policy) => {
    setIsDetailLoading(true);
    setClaimAmount("");
    setClaimNotes("");
    try {
      const response = await patientWorkflowApi.getInsuranceUtilization(policy._id);
      setDetail({ policy, utilization: response.data });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsDetailLoading(false);
    }
  };

  const submitClaim = async (event) => {
    event.preventDefault();
    if (!claimAmount) return;
    try {
      await patientWorkflowApi.submitInsuranceClaim(detail.policy._id, { claimAmount, claimNotes });
      toast.success("Claim submitted");
      setDetail(null);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  if (isLoading) return <Loader label="Loading insurance" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Digital Health Ecosystem</p><h1 className="mt-2 text-3xl font-black text-slate-950">Insurance Center</h1></div>
      <HealthEcosystemNav overview={overview} active="insurance" />
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card title={t("patient.insurance.add")}>
          <form className="grid gap-4" onSubmit={submit}>
            <Input label={t("patient.insurance.provider")} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} required />
            <Input label={t("patient.insurance.policy")} value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} required />
            <Input label={t("patient.insurance.holder")} value={form.policyHolder} onChange={(e) => setForm({ ...form, policyHolder: e.target.value })} required />
            <Input label="Valid till" type="date" value={form.validTill} onChange={(e) => setForm({ ...form, validTill: e.target.value })} required />
            <Input label="Coverage amount" type="number" value={form.coverageAmount} onChange={(e) => setForm({ ...form, coverageAmount: e.target.value })} />
            <div>
              <span className="mb-2 block text-sm font-semibold text-slate-700">Covers</span>
              <select className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.familyMemberId} onChange={(e) => setForm({ ...form, familyMemberId: e.target.value })}>
                <option value="">Myself</option>
                {family.map((member) => <option key={member._id} value={member._id}>{member.name} ({member.relation})</option>)}
              </select>
            </div>
            <input type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} className="rounded-xl bg-white/70 p-3 text-sm" />
            <Button type="submit" isLoading={isSaving}>Save Policy</Button>
          </form>
        </Card>
        <div className="space-y-4">
          {policies.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {policies.map((policy) => {
                const expiring = daysUntil(policy.validTill) <= 30;
                return (
                  <Card key={policy._id}>
                    <div className="flex items-start justify-between gap-3">
                      <ShieldCheck className="text-blue-600" size={28} />
                      <button onClick={() => removePolicy(policy)} className="rounded-lg p-2 text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                    </div>
                    <p className="mt-4 text-xl font-black text-slate-950">{policy.provider}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">{policy.policyNumber}</p>
                    {policy.familyMemberId && <p className="mt-1 text-xs font-bold text-blue-600">Covers {policy.familyMemberId.name}</p>}
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-white/60 p-3">
                        <p className="text-xs font-bold text-slate-500">Valid till</p>
                        <p className="font-black text-slate-950">{new Date(policy.validTill).toLocaleDateString()}</p>
                      </div>
                      <div className="rounded-xl bg-white/60 p-3">
                        <p className="text-xs font-bold text-slate-500">Claim status</p>
                        <p className="font-black capitalize text-blue-600">{policy.claimStatus.replaceAll("_", " ")}</p>
                      </div>
                    </div>
                    {expiring && (
                      <p className="mt-3 flex items-center gap-1 text-xs font-bold text-amber-600"><AlertTriangle size={13} /> Renewal due within 30 days</p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={() => openDetail(policy)}>Coverage details</Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No insurance on file" description="Add a policy so claim status, coverage, and renewals show up here automatically." />
          )}
        </div>
      </div>

      <AdminModal isOpen={Boolean(detail) || isDetailLoading} title={detail?.policy?.provider ? `${detail.policy.provider} coverage` : "Coverage details"} onClose={() => setDetail(null)}>
        {isDetailLoading && <Loader label="Loading coverage" />}
        {detail && !isDetailLoading && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
              <MiniDonut
                segments={[
                  { label: "Used", value: detail.utilization.utilizedAmount, color: "#2563eb" },
                  { label: "Remaining", value: detail.utilization.remainingAmount, color: "#e2e8f0" },
                ]}
              />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-500">Coverage amount: <span className="font-black text-slate-950">INR {detail.utilization.coverageAmount}</span></p>
                <p className="text-sm font-semibold text-slate-500">Utilized: <span className="font-black text-blue-600">INR {detail.utilization.utilizedAmount}</span></p>
                <p className="text-sm font-semibold text-slate-500">Remaining: <span className="font-black text-emerald-600">INR {detail.utilization.remainingAmount}</span></p>
              </div>
            </div>

            {detail.utilization.linkedAppointments?.length ? (
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Linked visits</p>
                <div className="space-y-2">
                  {detail.utilization.linkedAppointments.map((appt) => (
                    <div key={appt._id} className="rounded-xl bg-white/60 p-3 text-sm">
                      <p className="font-black text-slate-950">Dr. {appt.doctorId?.userId?.name || "Doctor"} — {new Date(appt.date).toLocaleDateString()}</p>
                      <p className="text-xs text-slate-500">
                        {appt.paymentId ? `Payment: INR ${appt.paymentId.totalAmount} (${appt.paymentId.status})` : "No payment linked yet"}
                        {appt.invoiceId ? ` • Invoice ${appt.invoiceId.invoiceNumber}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No appointments have used this policy yet.</p>
            )}

            <div className="rounded-xl border border-slate-200 bg-white/50 p-4">
              <p className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500"><FileCheck size={14} /> Submit a claim</p>
              <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={submitClaim}>
                <Input label="Claim amount" type="number" value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} />
                <Input label="Notes" value={claimNotes} onChange={(e) => setClaimNotes(e.target.value)} />
                <Button type="submit" disabled={!claimAmount}>Submit</Button>
              </form>
            </div>

            <AIDraftPanel title="AI: Explain this policy" actionLabel="Explain" onGenerate={() => aiAssistApi.explainInsurance(detail.policy._id)} compact />
            <AIDraftPanel title="AI: Eligibility & utilization summary" actionLabel="Summarize" onGenerate={() => aiAssistApi.getInsuranceEligibility(detail.policy._id)} compact />
          </div>
        )}
      </AdminModal>
    </div>
  );
}

export default PatientInsurance;
