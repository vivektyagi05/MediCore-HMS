import { Filter, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { financeApi } from "../../api/financeApi";
import { getApiErrorMessage } from "../../api/axios";
import { walletApi } from "../../api/walletApi";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import WalletRechargeModal from "../../components/wallet/WalletRechargeModal";

function WalletDashboard() {
  const [wallet, setWallet] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [type, setType] = useState("");
  const [isRechargeOpen, setIsRechargeOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadWallet = async () => {
    setIsLoading(true);
    setError("");

    try {
      const [walletResponse, ledgerResponse] = await Promise.all([
        walletApi.getWallet(),
        financeApi.getLedger({ type: type || undefined, limit: 50 }),
      ]);
      setWallet(walletResponse.data.wallet);
      setLedger(ledgerResponse.data.ledger || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadWallet();
  }, [type]);

  if (isLoading) return <Loader label="Loading wallet" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Wallet</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Healthcare wallet</h1>
        </div>
        <Button onClick={() => setIsRechargeOpen(true)}>Recharge Wallet</Button>
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

          <Card title="Transaction Ledger">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex items-center gap-2 text-sm font-black text-slate-600">
                <Filter size={17} /> Filter transactions
              </div>
              <select
                className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm outline-none"
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
            </div>

            {ledger.length ? (
              <div className="space-y-3">
                {ledger.map((transaction) => (
                  <div key={transaction._id} className="flex flex-col justify-between gap-3 rounded-2xl bg-white/60 p-4 shadow-lg sm:flex-row sm:items-center">
                    <div>
                      <p className="font-black capitalize text-slate-950">{transaction.type.replace("_", " ")}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{new Date(transaction.createdAt).toLocaleString()}</p>
                    </div>
                    <p className={`text-lg font-black ${transaction.direction === "credit" ? "text-emerald-600" : "text-blue-600"}`}>
                      {transaction.direction === "credit" ? "+" : "-"} {transaction.currency} {transaction.amount}
                    </p>
                  </div>
                ))}
              </div>
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
