import { useCallback, useEffect, useState } from "react";
import { Landmark, Loader2 } from "lucide-react";

import { withdrawalApi } from "../../api/withdrawalApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../ui/Card";
import MetricCard from "../ui/MetricCard";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import Input from "../ui/Input";
import Modal from "../ui/Modal";
import Skeleton from "../shared/Skeleton";
import EmptyState from "../shared/EmptyState";
import ErrorState from "../shared/ErrorState";

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const STATUS_TONE = {
  requested: "info",
  reserved: "info",
  processing: "warning",
  completed: "success",
  failed: "danger",
  retry_required: "warning",
  reconciliation_required: "warning",
  cancelled: "neutral",
};

const STATUS_LABEL = {
  requested: "Requested",
  reserved: "Reserved",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  retry_required: "Retry required",
  reconciliation_required: "Under review",
  cancelled: "Cancelled",
};

// STEP = which screen of the request flow is showing (Section 23).
const STEP = { FORM: "form", REVIEW: "review", SUBMITTING: "submitting", DONE: "done" };

function DoctorWithdrawalPanel() {
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState("");

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState(STEP.FORM);
  const [amount, setAmount] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState(null);

  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const res = await withdrawalApi.getBalance();
      setBalance(res.data);
    } catch (error) {
      setBalanceError(getApiErrorMessage(error));
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await withdrawalApi.getMine({ pageSize: 10 });
      setHistory(res.data?.withdrawals || []);
    } catch (error) {
      setHistoryError(getApiErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBalance();
    loadHistory();
  }, [loadBalance, loadHistory]);

  const openModal = () => {
    setStep(STEP.FORM);
    setAmount("");
    setDestinationLabel("");
    setFormError("");
    setResult(null);
    setModalOpen(true);
  };

  const goToReview = () => {
    const requestedAmount = Number(amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      setFormError("Enter a valid amount.");
      return;
    }
    if (balance && requestedAmount > balance.withdrawableBalance) {
      setFormError(`You can withdraw up to ${money(balance.withdrawableBalance)}.`);
      return;
    }
    if (balance?.minAmount && requestedAmount < balance.minAmount) {
      setFormError(`Minimum withdrawal amount is ${money(balance.minAmount)}.`);
      return;
    }
    if (!destinationLabel.trim()) {
      setFormError("Enter a payout destination (e.g. bank account ending 1234).");
      return;
    }
    setFormError("");
    setStep(STEP.REVIEW);
  };

  const confirmWithdrawal = async () => {
    setStep(STEP.SUBMITTING);
    try {
      const idempotencyKey = `wd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const res = await withdrawalApi.request({
        amount: Number(amount),
        destinationLabel: destinationLabel.trim(),
        idempotencyKey,
      });
      setResult({ ok: true, withdrawal: res.data?.withdrawal });
      setStep(STEP.DONE);
      loadBalance();
      loadHistory();
    } catch (error) {
      setResult({ ok: false, message: getApiErrorMessage(error) });
      setStep(STEP.DONE);
    }
  };

  return (
    <Card
      title="Withdraw Earnings"
      action={<Button size="sm" onClick={openModal} disabled={balanceLoading || !balance?.withdrawableBalance}>Withdraw</Button>}
    >
      {balanceLoading ? (
        <Skeleton rows={2} />
      ) : balanceError ? (
        <ErrorState title="Couldn't load your withdrawable balance" description={balanceError} onRetry={loadBalance} />
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard icon={Landmark} tone="success" label="Available to withdraw" value={money(balance?.withdrawableBalance)} caption="Settled earnings, ready now" />
          <MetricCard icon={Loader2} tone="warning" label="Pending withdrawal" value={money(balance?.pendingWithdrawal)} caption="Already requested, in progress" />
          <MetricCard icon={Landmark} tone="danger" label="Refund liability" value={money(balance?.refundLiability)} caption="Held back pending refund adjustments" />
          <MetricCard icon={Landmark} tone="info" label="Already withdrawn" value={money(balance?.alreadyWithdrawn)} caption="Lifetime completed withdrawals" />
        </div>
      )}

      <div className="mt-6">
        <p className="mb-2 text-sm font-bold text-slate-700">Withdrawal history</p>
        {historyLoading ? (
          <Skeleton rows={2} />
        ) : historyError ? (
          <ErrorState title="Couldn't load withdrawal history" description={historyError} onRetry={loadHistory} />
        ) : !history.length ? (
          <EmptyState title="No withdrawals yet" description="Your withdrawal requests will show up here." />
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {history.map((w) => (
              <div key={w._id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{money(w.requestedAmount)}</p>
                  <p className="text-xs text-slate-500">{w.destinationLabel} · {new Date(w.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
                  {w.status === "failed" && w.failureReason && (
                    <p className="mt-1 text-xs font-semibold text-rose-600">{w.failureReason}</p>
                  )}
                </div>
                <Badge tone={STATUS_TONE[w.status] || "neutral"}>{STATUS_LABEL[w.status] || w.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={modalOpen} title="Withdraw Earnings" onClose={() => setModalOpen(false)} size="md">
        {step === STEP.FORM && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Available to withdraw: <strong>{money(balance?.withdrawableBalance)}</strong></p>
            <Input
              label="Amount"
              name="amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
            />
            <Input
              label="Payout destination"
              name="destinationLabel"
              value={destinationLabel}
              onChange={(e) => setDestinationLabel(e.target.value)}
              placeholder="e.g. HDFC Bank account ending 4417"
            />
            {formError && <p className="text-sm font-semibold text-rose-600">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button onClick={goToReview}>Review</Button>
            </div>
          </div>
        )}

        {step === STEP.REVIEW && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-600">You are withdrawing</p>
              <p className="text-2xl font-black text-slate-950">{money(amount)}</p>
              <p className="mt-2 text-sm text-slate-600">To: <strong>{destinationLabel}</strong></p>
              <p className="mt-2 text-sm text-slate-600">
                Remaining available after this: <strong>{money((balance?.withdrawableBalance || 0) - Number(amount))}</strong>
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep(STEP.FORM)}>Back</Button>
              <Button onClick={confirmWithdrawal}>Confirm Withdrawal</Button>
            </div>
          </div>
        )}

        {step === STEP.SUBMITTING && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="animate-spin text-royal-600" size={28} />
            <p className="text-sm font-semibold text-slate-600">Submitting your request...</p>
          </div>
        )}

        {step === STEP.DONE && result && (
          <div className="space-y-4 text-center">
            {result.ok ? (
              <>
                <p className="text-lg font-bold text-emerald-700">Request submitted</p>
                <p className="text-sm text-slate-600">Your withdrawal request is being reviewed. You can track its status below.</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-rose-700">Withdrawal could not be completed</p>
                <p className="text-sm text-slate-600">{result.message}</p>
              </>
            )}
            <Button onClick={() => setModalOpen(false)}>Close</Button>
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default DoctorWithdrawalPanel;
