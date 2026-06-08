import { Banknote, CreditCard, Percent, Repeat2, RotateCcw, WalletCards, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { paymentApi } from "../../api/paymentApi";
import { refundApi } from "../../api/refundApi";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

function AdminFinanceDashboard() {
  const [summary, setSummary] = useState(null);
  const [payments, setPayments] = useState([]);
  const [refundRequests, setRefundRequests] = useState([]);
  const [refundAmounts, setRefundAmounts] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [refundingId, setRefundingId] = useState("");
  const [error, setError] = useState("");
  const toast = useToast();

  const loadFinance = async () => {
    setIsLoading(true);
    setError("");

    try {
      const [summaryResponse, paymentsResponse, refundResponse] = await Promise.all([
        paymentApi.getSummary(),
        paymentApi.getPayments({ limit: 100 }),
        refundApi.getRequests({ status: "pending" }),
      ]);
      setSummary(summaryResponse.data);
      setPayments(paymentsResponse.data.payments || []);
      setRefundRequests(refundResponse.data.refundRequests || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFinance();
  }, []);

  const initiateRefund = async (payment) => {
    setRefundingId(payment._id);

    try {
      const amount = refundAmounts[payment._id] ? Number(refundAmounts[payment._id]) : undefined;
      await refundApi.initiateRefund(payment._id, {
        amount,
        reason: "Admin finance refund",
      });
      toast.success("Refund processed and wallet credited");
      await loadFinance();
    } catch (refundError) {
      toast.error(getApiErrorMessage(refundError));
    } finally {
      setRefundingId("");
    }
  };

  const approveRefundRequest = async (request) => {
    setRefundingId(request._id);

    try {
      await refundApi.approveRequest(request._id, { note: "Approved from finance dashboard" });
      toast.success("Refund request approved and processed");
      await loadFinance();
    } catch (refundError) {
      toast.error(getApiErrorMessage(refundError));
    } finally {
      setRefundingId("");
    }
  };

  if (isLoading) return <Loader label="Loading finance dashboard" />;

  const cards = [
    { label: "Total Earnings", value: summary?.totalEarnings || 0, icon: Banknote },
    { label: "Captured Payments", value: summary?.capturedPayments || 0, icon: CreditCard },
    { label: "Refunded Amount", value: summary?.refundedAmount || 0, icon: RotateCcw },
    { label: "Failed Payments", value: summary?.failedPayments || 0, icon: XCircle },
    { label: "Success Ratio", value: `${summary?.successRatio || 0}%`, icon: Percent },
    { label: "Wallet Balances", value: summary?.walletBalances || 0, icon: WalletCards },
    { label: "Recurring Revenue", value: summary?.recurringRevenue || 0, icon: Repeat2 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Financial Dashboard</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Revenue and refunds</h1>
        </div>
        <Button onClick={loadFinance}>Refresh</Button>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((item) => (
          <Card key={item.label}>
            <item.icon className="text-blue-600" size={26} />
            <p className="mt-5 text-3xl font-black text-slate-950">{item.value}</p>
            <p className="mt-1 text-sm font-bold text-slate-500">{item.label}</p>
          </Card>
        ))}
      </div>

      <Card title="Pending Refund Approvals">
        {refundRequests.length ? (
          <div className="space-y-3">
            {refundRequests.map((request) => (
              <div key={request._id} className="flex flex-col justify-between gap-4 rounded-2xl bg-white/60 p-4 shadow-lg lg:flex-row lg:items-center">
                <div>
                  <p className="font-black text-slate-950">{request.requestedBy?.name || "Requester"}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    INR {request.amount} - {request.reason}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => approveRefundRequest(request)}
                  isLoading={refundingId === request._id}
                >
                  Approve and Process
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No pending refunds" description="Patient refund requests will appear here for approval." />
        )}
      </Card>

      <Card title="Payment Ledger">
        {payments.length ? (
          <div className="space-y-3">
            {payments.map((payment) => (
              <div key={payment._id} className="rounded-2xl bg-white/60 p-4 shadow-lg">
                <div className="grid gap-4 lg:grid-cols-[1fr_0.7fr_0.9fr] lg:items-end">
                  <div>
                    <p className="font-black text-slate-950">{payment.userId?.name || "Patient"}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {payment.currency} {payment.totalAmount} - {payment.status}
                    </p>
                  </div>
                  <Input
                    label="Refund amount"
                    type="number"
                    min="1"
                    max={payment.totalAmount - payment.refundedAmount}
                    value={refundAmounts[payment._id] || ""}
                    onChange={(event) =>
                      setRefundAmounts((current) => ({ ...current, [payment._id]: event.target.value }))
                    }
                    placeholder="Full refund"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => initiateRefund(payment)}
                    isLoading={refundingId === payment._id}
                    disabled={!["captured", "partially_refunded"].includes(payment.status)}
                  >
                    Initiate Refund
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No payments yet" description="Captured and failed payments will appear in this ledger." />
        )}
      </Card>
    </div>
  );
}

export default AdminFinanceDashboard;
