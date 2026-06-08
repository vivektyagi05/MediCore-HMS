import { RefreshCcw, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { financeApi } from "../../api/financeApi";
import OnlineUsers from "../../components/realtime/OnlineUsers";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

function FinanceHistory() {
  const toast = useToast();
  const [ledger, setLedger] = useState([]);
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState("");

  const loadFinance = async () => {
    setIsLoading(true);
    setError("");
    try {
      const [ledgerResponse, reconciliationResponse] = await Promise.all([
        financeApi.getLedger({ limit: 50 }),
        financeApi.getReconciliationReport(),
      ]);
      setLedger(ledgerResponse.data.ledger || []);
      setReport(reconciliationResponse.data.report);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFinance();
  }, []);

  const retryDue = async () => {
    setIsRetrying(true);
    try {
      const response = await financeApi.retryDuePayments();
      toast.success(`${response.data.retried} failed payment retries processed`);
      loadFinance();
    } catch (retryError) {
      toast.error(getApiErrorMessage(retryError));
    } finally {
      setIsRetrying(false);
    }
  };

  if (isLoading) return <Loader label="Loading finance controls" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Finance Ops</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Reconciliation and recovery</h1>
        </div>
        <Button onClick={retryDue} isLoading={isRetrying}>
          <RefreshCcw size={17} /> Retry Due Payments
        </Button>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <ShieldAlert className="text-blue-600" size={26} />
          <p className="mt-4 text-sm font-bold text-slate-500">Records checked</p>
          <p className="mt-2 text-4xl font-black text-slate-950">{report?.checked || 0}</p>
        </Card>
        <Card>
          <p className="text-sm font-bold text-slate-500">Reconciliation issues</p>
          <p className="mt-2 text-4xl font-black text-red-600">{report?.issues?.length || 0}</p>
        </Card>
        <Card>
          <p className="text-sm font-bold text-slate-500">Generated</p>
          <p className="mt-2 text-lg font-black text-slate-950">{report?.generatedAt ? new Date(report.generatedAt).toLocaleString() : "Pending"}</p>
        </Card>
      </div>

      <Card title="Recent Ledger Entries">
        <div className="space-y-3">
          {ledger.map((entry) => (
            <div key={entry._id} className="flex flex-col justify-between gap-3 rounded-2xl bg-white/60 p-4 shadow-lg sm:flex-row sm:items-center">
              <div>
                <p className="font-black capitalize text-slate-950">{entry.type.replace("_", " ")}</p>
                <p className="text-sm font-semibold text-slate-500">{entry.status} - {new Date(entry.createdAt).toLocaleString()}</p>
              </div>
              <p className="text-lg font-black text-blue-600">{entry.currency} {entry.amount}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Online Presence">
        <OnlineUsers />
      </Card>
    </div>
  );
}

export default FinanceHistory;
