import { useCallback, useEffect, useState } from "react";
import { Filter, WalletCards } from "lucide-react";
import { financeApi } from "../../api/financeApi";
import { getApiErrorMessage } from "../../api/axios";
import { walletApi } from "../../api/walletApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import EmptyState from "../../components/shared/EmptyState";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import { MiniDonut, MiniLineChart } from "../../components/finance/FinanceCharts";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import WalletRechargeModal from "../../components/wallet/WalletRechargeModal";
import { useI18n } from "../../i18n/I18nContext";

const CATEGORY_LABELS = {
  wallet_credit: "Top-ups & credits",
  wallet_debit: "Spent from wallet",
  refund: "Refunds credited",
};

const CATEGORY_COLORS = ["#2563eb", "#059669", "#7c3aed", "#d97706"];

// P23 Section 14/15 — recharge status badges so the wallet page can never
// look like "money simply appeared". Every recharge is shown with its
// real, authoritative lifecycle state.
const RECHARGE_STATUS_STYLES = {
  posted: "bg-emerald-50 text-emerald-700",
  captured: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  verification_pending: "bg-amber-50 text-amber-700",
  reconciliation_required: "bg-amber-50 text-amber-700",
  order_created: "bg-slate-100 text-slate-600",
  checkout_started: "bg-slate-100 text-slate-600",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
  expired: "bg-slate-100 text-slate-500",
};

const RECHARGE_STATUS_LABELS = {
  posted: "Successful",
  captured: "Confirming",
  pending: "Pending",
  verification_pending: "Verifying",
  reconciliation_required: "Needs review",
  order_created: "Awaiting checkout",
  checkout_started: "Awaiting checkout",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
};

const RECOVERABLE_STATUSES = ["pending", "verification_pending", "reconciliation_required", "order_created", "checkout_started"];

function WalletDashboard() {
  const [wallet, setWallet] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [analytics, setAnalytics] = useState(null);
  const [recharges, setRecharges] = useState([]);
  const [recoveringId, setRecoveringId] = useState(null);
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [isRechargeOpen, setIsRechargeOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { t } = useI18n();
  const [error, setError] = useState("");

  const loadWallet = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const [walletResponse, ledgerResponse, analyticsResponse, rechargeResponse] = await Promise.all([
        walletApi.getWallet(),
        financeApi.getLedger({ type: type || undefined, from: from || undefined, to: to || undefined, page, limit: 10 }),
        walletApi.getAnalytics(),
        financeApi.getWalletRechargeHistory({ limit: 10 }),
      ]);
      setWallet(walletResponse.data.wallet);
      setLedger(ledgerResponse.data.ledger || []);
      setPagination(ledgerResponse.data.pagination || { page: 1, pages: 1, total: 0 });
      setAnalytics(analyticsResponse.data);
      setRecharges(rechargeResponse.data.recharges || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [type, from, to, page]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    setPage(1);
  }, [type, from, to]);

  // Section 15 — real recovery action, never a blind retry. Re-checks the
  // authoritative provider status for a still-open recharge.
  const recoverRecharge = async (gatewayOrderId) => {
    setRecoveringId(gatewayOrderId);
    try {
      await financeApi.getWalletRechargeStatus(gatewayOrderId);
      await loadWallet();
    } catch (recoverError) {
      setError(getApiErrorMessage(recoverError));
    } finally {
      setRecoveringId(null);
    }
  };

  if (isLoading) return <Loader label="Loading wallet" />;

  const categorySegments = (analytics?.categoryBreakdown || [])
    .filter((entry) => CATEGORY_LABELS[entry.type])
    .map((entry, i) => ({
      label: CATEGORY_LABELS[entry.type],
      value: entry.totalAmount,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Wallet</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Healthcare wallet</h1>
        </div>
        <Button onClick={() => setIsRechargeOpen(true)}>{t("patient.wallet.recharge")}</Button>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      {wallet && (
        <>
          <Card>
            <div className="rounded-2xl bg-slate-950 p-6 text-white">
              <WalletCards className="text-blue-400" size={30} />
              <p className="mt-5 text-sm font-bold text-slate-400">Available balance</p>
              <p className="mt-2 text-5xl font-black">{wallet.currency} {wallet.balance}</p>
            </div>
          </Card>

          <AIDraftPanel
            title="AI wallet spending summary"
            actionLabel="Summarize my wallet activity"
            onGenerate={() => aiAssistApi.getExpenseSummary()}
          />

          {analytics && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card title="Monthly credit / debit trend">
                <MiniLineChart data={analytics.monthlyTrend} />
              </Card>
              <Card title="Wallet activity breakdown">
                <MiniDonut segments={categorySegments} />
              </Card>
            </div>
          )}

          <Card title="Recharge History">
            {recharges.length ? (
              <div className="space-y-3">
                {recharges.map((entry) => (
                  <div key={entry._id} className="flex flex-col justify-between gap-3 rounded-2xl bg-white/60 p-4 shadow-lg sm:flex-row sm:items-center">
                    <div>
                      <p className="font-black text-slate-950">{entry.currency} {entry.amount}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{new Date(entry.createdAt).toLocaleString()}</p>
                      {entry.failureReason && <p className="mt-1 text-xs font-semibold text-red-600">{entry.failureReason}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${RECHARGE_STATUS_STYLES[entry.status] || "bg-slate-100 text-slate-600"}`}>
                        {RECHARGE_STATUS_LABELS[entry.status] || entry.status}
                      </span>
                      {RECOVERABLE_STATUSES.includes(entry.status) && (
                        <Button
                          variant="secondary"
                          onClick={() => recoverRecharge(entry.gatewayOrderId)}
                          isLoading={recoveringId === entry.gatewayOrderId}
                        >
                          Check status
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No recharges yet" description="Wallet recharges you start will appear here with their real status." />
            )}
          </Card>

          <Card title="Transaction Ledger">
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-black text-slate-600">
                  <Filter size={15} /> Type
                </span>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm outline-none"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                >
                  <option value="">All types</option>
                  <option value="payment">Payments</option>
                  <option value="refund">Refunds</option>
                  <option value="wallet_credit">Wallet credits</option>
                  <option value="wallet_debit">Wallet debits</option>
                  <option value="coupon">Coupons</option>
                </select>
              </label>
              <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            {ledger.length ? (
              <>
                <div className="space-y-3">
                  {ledger.map((transaction) => (
                    <div key={transaction._id} className="flex flex-col justify-between gap-3 rounded-2xl bg-white/60 p-4 shadow-lg sm:flex-row sm:items-center">
                      <div>
                        <p className="font-black capitalize text-slate-950">{transaction.type.replace("_", " ")}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-500">{new Date(transaction.createdAt).toLocaleString()}</p>
                        {transaction.referenceId && (
                          <p className="mt-1 text-xs font-semibold text-slate-400">Ref: {transaction.referenceId}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${transaction.status === "posted" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {transaction.status}
                        </span>
                        <p className={`text-lg font-black ${transaction.direction === "credit" ? "text-emerald-600" : "text-blue-600"}`}>
                          {transaction.direction === "credit" ? "+" : "-"} {transaction.currency} {transaction.amount}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {pagination.pages > 1 && (
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <Button variant="secondary" disabled={pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                      Previous
                    </Button>
                    <span className="text-sm font-bold text-slate-600">Page {pagination.page} of {pagination.pages}</span>
                    <Button variant="secondary" disabled={pagination.page >= pagination.pages} onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}>
                      Next
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <EmptyState title="No ledger activity" description="Wallet recharges, refunds, coupons, and payments will appear here." />
            )}
          </Card>
        </>
      )}

      <WalletRechargeModal
        isOpen={isRechargeOpen}
        onClose={() => setIsRechargeOpen(false)}
        onSuccess={loadWallet}
      />
    </div>
  );
}

export default WalletDashboard;
