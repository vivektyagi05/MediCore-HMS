import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { refundApi } from "../../api/refundApi";
import { getApiErrorMessage } from "../../api/axios";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import { useToast } from "../../context/ToastContext";

const formatMoney = (value, currency = "INR") =>
  `${currency === "INR" ? "\u20b9" : `${currency} `}${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const CANCELLATION_REASONS = [
  { value: "patient_cancellation", label: "I'm cancelling this appointment" },
  { value: "doctor_cancelled", label: "The doctor cancelled" },
];

const PROBLEM_REASONS = [
  { value: "doctor_no_show", label: "The doctor didn't show up" },
  { value: "consultation_not_completed", label: "The consultation wasn't completed" },
  { value: "wrong_service", label: "I was charged for the wrong service" },
  { value: "duplicate_charge", label: "I was charged twice" },
  { value: "payment_issue", label: "There was a payment problem" },
  { value: "technical_failure", label: "A technical failure prevented my consultation" },
  { value: "other", label: "Something else" },
];

// P23 Section 14 — safe step labels only, no internal state names surfaced.
function RefundTrackerView({ requestId }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    refundApi.getDetail(requestId)
      .then((res) => { if (active) setDetail(res.data); })
      .catch((err) => { if (active) setError(getApiErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requestId]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-royal-600" /></div>;
  if (error) return <p className="text-sm font-semibold text-rose-600">{error}</p>;
  if (!detail) return null;

  const { refundRequest, timelineSteps, terminalIssue, fundingAllocation } = detail;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-600">Requested amount</p>
        <p className="text-2xl font-black text-slate-950">{formatMoney(refundRequest.requestedAmount, refundRequest.paymentId?.currency)}</p>
      </div>

      <ol className="space-y-2">
        {timelineSteps.map((step) => (
          <li key={step.state} className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${step.completed ? "bg-emerald-500" : "bg-slate-200"}`} />
            <span className={`text-sm font-semibold ${step.completed ? "text-slate-900" : "text-slate-400"}`}>{step.label}</span>
          </li>
        ))}
      </ol>

      {terminalIssue && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{terminalIssue.label}</p>
      )}

      {(fundingAllocation.walletRefundAmount > 0 || fundingAllocation.gatewayRefundAmount > 0) && (
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="mb-2 text-xs font-bold uppercase text-slate-500">Refund breakdown</p>
          {fundingAllocation.walletRefundAmount > 0 && (
            <p className="text-sm text-slate-700">Wallet: {formatMoney(fundingAllocation.walletRefundAmount)}</p>
          )}
          {fundingAllocation.gatewayRefundAmount > 0 && (
            <p className="text-sm text-slate-700">Original payment method: {formatMoney(fundingAllocation.gatewayRefundAmount)}</p>
          )}
        </div>
      )}
    </div>
  );
}

// P23 Section 10 Case A — eligible cancellation refund request.
function EligibleRefundForm({ payment, eligibility, onSubmitted, onClose }) {
  const [amount, setAmount] = useState(eligibility.maximumRefundAmount);
  const [reasonCode, setReasonCode] = useState("patient_cancellation");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setSubmitting(true);
    try {
      await refundApi.createRequest(payment._id, { amount, reasonCode, description });
      toast.success("Refund request submitted.");
      onSubmitted();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Eligible amount: <span className="font-black text-slate-950">{formatMoney(eligibility.maximumRefundAmount, payment.currency)}</span>
      </p>
      <Input
        label="Refund amount"
        type="number"
        max={eligibility.maximumRefundAmount}
        min={0}
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
      />
      <Select label="Reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
        {CANCELLATION_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </Select>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-700">Additional details (optional)</span>
        <textarea
          className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button isLoading={submitting} onClick={submit}>Submit refund request</Button>
      </div>
    </div>
  );
}

// P23 Section 11 — Report a problem wizard (Case B/D entry point).
function ReportProblemWizard({ payment, onSubmitted, onClose }) {
  const [wizardStep, setWizardStep] = useState(1);
  const [reasonCode, setReasonCode] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const submit = async () => {
    if (!description.trim()) {
      toast.error("Please describe what went wrong.");
      return;
    }
    setSubmitting(true);
    try {
      await refundApi.reportProblem(payment._id, { reasonCode, description });
      toast.success("Report submitted. Our team will review it.");
      onSubmitted();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {wizardStep === 1 && (
        <>
          <p className="text-sm font-bold text-slate-700">What went wrong?</p>
          <Select label="Category" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
            <option value="">Select a category</option>
            {PROBLEM_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={!reasonCode} onClick={() => setWizardStep(2)}>Next</Button>
          </div>
        </>
      )}
      {wizardStep === 2 && (
        <>
          <p className="text-sm font-bold text-slate-700">Describe the problem</p>
          <textarea
            className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell us what happened, with as much detail as you can."
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setWizardStep(1)}>Back</Button>
            <Button isLoading={submitting} onClick={submit}>Submit report</Button>
          </div>
        </>
      )}
    </div>
  );
}

function RefundActionModal({ payment, onClose, onSubmitted }) {
  const [eligibility, setEligibility] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!payment) return;
    let active = true;
    setLoading(true);
    setError("");
    refundApi.getEligibility(payment._id)
      .then((res) => { if (active) setEligibility(res.data); })
      .catch((err) => { if (active) setError(getApiErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [payment]);

  if (!payment) return null;

  const handleSubmitted = () => onSubmitted();

  let title = "Refund";
  let body;

  if (loading) {
    body = <div className="flex justify-center py-10"><Loader2 className="animate-spin text-royal-600" size={28} /></div>;
  } else if (error) {
    body = <p className="text-sm font-semibold text-rose-600">{error}</p>;
  } else if (eligibility?.uiCase === "TRACK_EXISTING") {
    title = "Refund status";
    body = <RefundTrackerView requestId={eligibility.existingRequestId} />;
  } else if (eligibility?.uiCase === "ELIGIBLE_CANCELLATION") {
    title = "Refund available";
    body = <EligibleRefundForm payment={payment} eligibility={eligibility} onSubmitted={handleSubmitted} onClose={onClose} />;
  } else if (eligibility?.uiCase === "COMPLETED_CONSULTATION") {
    title = "Report a problem";
    body = <ReportProblemWizard payment={payment} onSubmitted={handleSubmitted} onClose={onClose} />;
  } else {
    title = "Refund";
    const message = eligibility?.reasonCode === "CAPACITY_EXCEEDED"
      ? "This payment has already been fully refunded."
      : "This payment isn't eligible for a refund right now.";
    body = (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{message}</p>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  return (
    <Modal isOpen title={title} onClose={onClose}>
      {body}
    </Modal>
  );
}

export default RefundActionModal;
