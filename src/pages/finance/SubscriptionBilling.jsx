import { useCallback, useEffect, useState } from "react";
import { Download, ArrowUpCircle, XCircle } from "lucide-react";
import { getApiErrorMessage } from "../../api/axios";
import { financeApi } from "../../api/financeApi";
import { invoiceApi } from "../../api/invoiceApi";
import { practiceApi } from "../../api/practiceApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import PracticeManagementNav from "../../components/practice/PracticeManagementNav";
import SubscriptionPlans from "../../components/subscription/SubscriptionPlans";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import Button from "../../components/ui/Button";
import EmptyState from "../../components/shared/EmptyState";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

function UsageBar({ label, used, limit }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-blue-600";
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="font-bold text-slate-500">{used} / {limit ?? "∞"}</span>
      </div>
      <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={`h-3 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Subscription Center (Phase D4, Step 5) -- transformed from the original
// bare Billing page. Adds real usage-vs-limit tracking, plan
// upgrade/downgrade, and the GST invoice history that subscription
// payments previously never generated.
function SubscriptionBilling() {
  const toast = useToast();
  const { t } = useI18n();
  const [plans, setPlans] = useState([]);
  const [intelligence, setIntelligence] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [error, setError] = useState("");

  const loadBilling = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [plansResponse, intelligenceResponse] = await Promise.all([
        financeApi.getPlans(),
        practiceApi.getSubscriptionIntelligence(),
      ]);
      setPlans((plansResponse.data.plans || []).filter((p) => p.purchasable !== false));
      setIntelligence(intelligenceResponse.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  const subscribe = async (planCode) => {
    setIsSubscribing(true);
    try {
      if (intelligence?.subscriptionId) {
        await practiceApi.changePlan(intelligence.subscriptionId, planCode);
        toast.success("Plan changed successfully");
      } else {
        await financeApi.createSubscription({ planCode });
        toast.success("Subscription activated");
      }
      loadBilling();
    } catch (subscribeError) {
      toast.error(getApiErrorMessage(subscribeError));
    } finally {
      setIsSubscribing(false);
    }
  };

  const cancel = async () => {
    if (!intelligence?.subscriptionId) return;
    try {
      await financeApi.cancelSubscription(intelligence.subscriptionId);
      toast.success("Subscription cancelled");
      loadBilling();
    } catch (cancelError) {
      toast.error(getApiErrorMessage(cancelError));
    }
  };

  const downloadInvoice = async (invoice) => {
    try {
      const blob = await invoiceApi.downloadInvoice(invoice._id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      toast.error(getApiErrorMessage(downloadError));
    }
  };

  if (isLoading) return <Loader label="Loading subscription" />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Subscriptions</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Subscription Center</h1>
      </div>

      <PracticeManagementNav active="subscription" />

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      {intelligence && (
        <Card title="Current Plan & Usage">
          <div className="flex flex-col justify-between gap-3 rounded-2xl bg-white/60 p-4 shadow-lg sm:flex-row sm:items-center">
            <div>
              <p className="font-black text-slate-950">{intelligence.currentPlan.planName}</p>
              {intelligence.currentPlan.nextBillingAt && (
                <p className="mt-1 text-sm font-semibold text-slate-500">Next billing: {new Date(intelligence.currentPlan.nextBillingAt).toLocaleDateString()}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-xl bg-blue-600/10 px-3 py-2 text-sm font-black capitalize text-blue-600">{intelligence.currentPlan.status}</span>
              {intelligence.subscriptionId && (
                <Button variant="secondary" onClick={cancel}><XCircle size={14} /> Cancel</Button>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <UsageBar label="AI Requests (this month)" used={intelligence.usage.aiRequests.used} limit={intelligence.usage.aiRequests.limit} />
            <UsageBar label="Patients" used={intelligence.usage.patients.used} limit={intelligence.usage.patients.limit} />
            <UsageBar label="Appointments (this month)" used={intelligence.usage.appointmentsThisMonth.used} limit={intelligence.usage.appointmentsThisMonth.limit} />
            <UsageBar label="Storage (MB)" used={intelligence.usage.storageMB.used} limit={intelligence.usage.storageMB.limit} />
          </div>
        </Card>
      )}

      <div>
        <p className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-400">
          <ArrowUpCircle size={15} /> Plan Comparison
        </p>
        <SubscriptionPlans plans={plans} isLoading={isSubscribing} onSubscribe={subscribe} />
      </div>

      <Card title="Billing History">
        {intelligence?.invoices?.length ? (
          <div className="space-y-3">
            {intelligence.invoices.map((invoice) => (
              <div key={invoice._id} className="flex flex-col justify-between gap-3 rounded-2xl bg-white/60 p-4 shadow-lg sm:flex-row sm:items-center">
                <div>
                  <p className="font-black text-slate-950">{invoice.invoiceNumber}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    Subtotal ₹{invoice.subtotal} + Tax ₹{invoice.taxAmount} = ₹{invoice.totalAmount}
                  </p>
                </div>
                <button onClick={() => downloadInvoice(invoice)} className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
                  <Download size={14} /> Download
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No invoices yet" description={t("finance.premium")} />
        )}
      </Card>

      <AIDraftPanel title="Subscription Advisor" actionLabel="Check My Usage" onGenerate={() => aiAssistApi.getSubscriptionAdvisor()} />
    </div>
  );
}

export default SubscriptionBilling;
