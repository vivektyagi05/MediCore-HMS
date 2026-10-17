import { ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { financeApi } from "../../api/financeApi";
import { paymentApi } from "../../api/paymentApi";
import { walletApi } from "../../api/walletApi";
import CouponBox from "../../components/payment/CouponBox";
import PaymentSummaryCard from "../../components/payment/PaymentSummaryCard";
import FinancialWorkflow from "../../components/finance/FinancialWorkflow";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";
import { classifyVerifyFailure, deriveCheckoutView, pollAuthoritativeStatus } from "./paymentConfirmation";

const loadRazorpayScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

const getIdempotencyKey = (appointmentId) => {
  const key = `hms-payment-${appointmentId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const randomPart = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const generated = `${appointmentId}-${randomPart}`;
  window.sessionStorage.setItem(key, generated);
  return generated;
};

function PaymentCheckout() {
  const { appointmentId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [payment, setPayment] = useState(null);
  const [order, setOrder] = useState(null);
  const [razorpayKeyId, setRazorpayKeyId] = useState("");
  const [gateway, setGateway] = useState("razorpay");
  const [workflowStep, setWorkflowStep] = useState(0);
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponError, setCouponError] = useState("");
  const [walletAmount, setWalletAmount] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState("");
  // P23 Section 5/6 — recovery + retry. `recovery` holds the authoritative
  // backend read for this appointment's most recent payment, fetched on
  // load so a returning patient (browser closed, callback missed) is
  // never shown a fresh "Prepare Secure Order" form while an unresolved
  // payment already exists, and never told "Payment failed" before the
  // backend has actually been asked.
  const [recovery, setRecovery] = useState(null);
  const [isCheckingRecovery, setIsCheckingRecovery] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  // Phase 01: "confirming" while we re-read authoritative backend state after a
  // callback/verification whose outcome is not yet known; "unknown" when the
  // bounded re-read budget ran out. Neither is ever shown as success or failure.
  const [confirmPhase, setConfirmPhase] = useState(null);
  // Phase 01: true while the gateway checkout is open or a verification is in
  // flight, so a second click cannot submit a duplicate payment.
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const appointment = useMemo(
    () => appointments.find((item) => item._id === appointmentId),
    [appointments, appointmentId],
  );

  const estimatedAmount = Number(appointment?.doctorId?.fees || appointment?.doctor?.fees || 0);

  useEffect(() => {
    const loadCheckout = async () => {
      setIsLoading(true);
      setError("");

      try {
        const [appointmentResponse, walletResponse] = await Promise.all([
          appointmentApi.getAppointments({ limit: 100 }),
          walletApi.getWallet(),
        ]);
        const appointmentList = appointmentResponse.data.appointments || [];
        setAppointments(appointmentList);
        setWallet(walletResponse.data.wallet);

        const selected = appointmentList.find((item) => item._id === appointmentId);
        if (!selected) throw new Error("Appointment was not found for your account");
        if (selected.paymentStatus === "paid") throw new Error("This appointment is already paid");
      } catch (loadError) {
        setError(getApiErrorMessage(loadError));
      } finally {
        setIsLoading(false);
      }
    };

    loadCheckout();
  }, [appointmentId]);

  const checkRecovery = async () => {
    setIsCheckingRecovery(true);
    try {
      const res = await paymentApi.getStatus(appointmentId);
      setRecovery(res.data);
    } catch {
      // Non-fatal — recovery is a courtesy read; fall back to a fresh order.
      setRecovery({ payment: null, attempts: [], recoveryState: "NONE" });
    } finally {
      setIsCheckingRecovery(false);
    }
  };

  useEffect(() => {
    checkRecovery();
  }, [appointmentId]);

  const retryPayment = async () => {
    if (!recovery?.payment?._id) return;
    setIsRetrying(true);
    setError("");
    try {
      const response = await paymentApi.retry(recovery.payment._id);
      if (response.data.walletOnly) {
        // F-018: the server settled this entirely from the wallet; there is no
        // gateway step. Success is only shown if the backend says it captured.
        window.sessionStorage.removeItem(`hms-payment-${appointmentId}`);
        const settledStatus = response.data.payment?.status;
        if (["captured", "completed"].includes(settledStatus)) {
          toast.success("Paid from wallet");
          navigate(response.data.invoice?._id ? `/invoices/${response.data.invoice._id}` : "/patient/payments", { replace: true });
        } else {
          setPayment(response.data.payment);
          await checkRecovery();
        }
        return;
      }
      setPayment(response.data.payment);
      setOrder(response.data.order);
      setRazorpayKeyId(response.data.razorpayKeyId);
      setGateway(response.data.gateway || "razorpay");
      setWorkflowStep(2);
      // Retry succeeded in creating a fresh gateway order — leave the
      // recovery banner behind and fall into the normal pay flow below.
      setRecovery({ ...recovery, recoveryState: "NONE" });
    } catch (retryError) {
      toast.error(getApiErrorMessage(retryError));
    } finally {
      setIsRetrying(false);
    }
  };

  const applyCoupon = async () => {
    setIsApplyingCoupon(true);
    setCouponError("");

    try {
      const response = await financeApi.validateCoupon({
        code: couponCode,
        appointmentId,
        amount: estimatedAmount,
      });
      setCouponDiscount(response.data.discountAmount);
      toast.success(t("payment.coupon"));
    } catch (applyError) {
      setCouponDiscount(0);
      setCouponError(getApiErrorMessage(applyError));
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const prepareOrder = async () => {
    if (isPreparing) return; // never start a second chargeable order while a request is active
    setIsPreparing(true);
    setError("");

    try {
      const response = await paymentApi.createOrder({
        appointmentId,
        couponCode: couponCode || undefined,
        walletAmount: Number(walletAmount) || 0,
        idempotencyKey: getIdempotencyKey(appointmentId),
      });
      setPayment(response.data.payment);
      setOrder(response.data.order);
      setRazorpayKeyId(response.data.razorpayKeyId);
      setGateway(response.data.gateway || "razorpay");
      setWorkflowStep(2);
      toast.success(t("paymentFlow.orderCreated"));
    } catch (prepareError) {
      if (["ACTIVE_PAYMENT_EXISTS", "PAYMENT_CREATION_IN_PROGRESS"].includes(prepareError?.response?.data?.details?.code)) {
        // A payment already exists for this appointment: show ITS authoritative state.
        await checkRecovery();
      } else if (prepareError?.response?.data?.details?.code === "WALLET_INSUFFICIENT") {
        // Phase 02: the server could not reserve the wallet portion. Show the AUTHORITATIVE
        // balance again instead of a stale one, and let the user choose a new amount.
        try { setWallet((await walletApi.getWallet()).data.wallet); } catch { /* keep the previous view */ }
        setWalletAmount("");
        setError("Your available wallet balance changed, so the wallet portion could not be reserved. Please review the amount and try again.");
      } else if (prepareError?.response?.data?.details?.code === "WALLET_PAYMENT_PENDING") {
        // The wallet payment may already have been taken: show its authoritative state, never start a new one.
        await checkRecovery();
        toast("Your payment is being finalised. Please check its status shortly.");
      } else {
        setError(getApiErrorMessage(prepareError));
      }
    } finally {
      setIsPreparing(false);
    }
  };

  const goToResult = (data) => {
    window.sessionStorage.removeItem(`hms-payment-${appointmentId}`);
    const invoiceId = data?.invoice?._id || data?.payment?.invoiceId?._id || data?.payment?.invoiceId;
    navigate(invoiceId ? `/invoices/${invoiceId}` : "/patient/payments", { replace: true });
  };

  // Re-read authoritative backend state (bounded backoff) after an outcome the
  // browser cannot decide. Success is shown ONLY when the backend says captured.
  const confirmWithBackend = async () => {
    setConfirmPhase("confirming");
    setWorkflowStep(4);
    const result = await pollAuthoritativeStatus({
      fetchStatus: () => paymentApi.getStatus(appointmentId),
      shouldStop: () => !mountedRef.current,
    });
    if (!mountedRef.current) return;
    if (result.state === "success") {
      setConfirmPhase(null);
      toast.success("Payment confirmed");
      goToResult({ payment: result.data?.payment });
      return;
    }
    setRecovery(result.data || { payment: null, attempts: [], recoveryState: "NONE" });
    setConfirmPhase(result.state === "unknown" ? "unknown" : null);
    if (result.state === "failed") toast.error("The payment provider did not complete this payment.");
  };

  // The gateway callback is only a hint. Every branch below is decided by what
  // the backend reports; a timeout is never presented as a failed payment.
  const verifyAndRoute = async (gatewayResponse) => {
    setWorkflowStep(4);
    setCheckoutBusy(true);
    try {
      const verified = await paymentApi.verifyPayment(gatewayResponse);
      if (verified.data?.confirming) {
        await confirmWithBackend(); // HTTP 202: provider has not finished; keep confirming
        return;
      }
      goToResult(verified.data);
    } catch (verifyError) {
      const kind = classifyVerifyFailure(verifyError);
      if (kind === "ambiguous") {
        toast.info("Confirming your payment with the provider...");
        await confirmWithBackend();
      } else {
        toast.error(getApiErrorMessage(verifyError));
        setWorkflowStep(3);
        await checkRecovery();
      }
    } finally {
      if (mountedRef.current) setCheckoutBusy(false);
    }
  };

  const startPayment = async () => {
    if (checkoutBusy || isPaying || confirmPhase) return; // no duplicate checkout submission
    setIsPaying(true);
    setCheckoutBusy(true);
    setWorkflowStep(3);
    try {
      if (gateway === "test") {
        const response = await paymentApi.completeTestPayment(order.id);
        await verifyAndRoute(response.data);
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded) throw new Error(t("paymentFlow.gatewayUnavailable"));
      const checkout = new window.Razorpay({
        key: razorpayKeyId,
        amount: order.amount,
        currency: order.currency,
        name: "MediCore",
        description: "Hospital appointment payment",
        order_id: order.id,
        prefill: { name: user?.name, email: user?.email },
        modal: {
          // Closing the checkout proves nothing (the provider may already have captured):
          // re-enable the button and re-read the backend rather than assuming failure.
          ondismiss: () => {
            if (!mountedRef.current) return;
            setCheckoutBusy(false);
            setIsPaying(false);
            checkRecovery();
          },
        },
        handler: (response) => {
          // F-017: this callback runs outside the surrounding try/catch; verifyAndRoute
          // handles every failure itself and falls back to the authoritative status read.
          setIsPaying(false);
          verifyAndRoute({
            razorpayOrderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          });
        },
      });
      checkout.open();
    } catch (paymentError) {
      toast.error(getApiErrorMessage(paymentError));
      setWorkflowStep(3);
      setCheckoutBusy(false);
      setIsPaying(false);
    }
  };

  // Resume an unpaid order the backend says is still awaiting checkout (refresh/reconnect).
  const resumeFromRecovery = () => {
    if (!recovery?.currentOrder || !recovery?.payment) return;
    setPayment(recovery.payment);
    setOrder(recovery.currentOrder);
    setRazorpayKeyId(recovery.razorpayKeyId || "");
    setGateway(recovery.gateway || "razorpay");
    setWorkflowStep(2);
    setRecovery({ ...recovery, recoveryState: "NONE" });
  };

  if (isLoading || isCheckingRecovery) return <Loader label="Checking your payment status..." />;

  // P23 Section 5 — recovery branches. SUCCESS/PENDING/REQUIRES_RECONCILIATION
  // all short-circuit the normal "prepare a new order" flow so we never
  // create a second payment while one already exists in an authoritative
  // non-fresh state.
  const view = confirmPhase ? "confirming" : deriveCheckoutView(recovery);
  const recoveryState = recovery?.recoveryState;
  const showRecoveryBanner = confirmPhase || (recoveryState && recoveryState !== "NONE");

  return (
    <div className="space-y-6">
      <Link to="/patient/dashboard" className="inline-flex items-center gap-2 text-sm font-black text-blue-600">
        <ArrowLeft size={17} /> Back to dashboard
      </Link>

      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Secure Checkout</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Complete appointment payment</h1>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      {!error && !confirmPhase && view === "success" && (
        <Card title="Payment already completed">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">This appointment has already been paid for.</p>
            {recovery.payment?.invoiceId?._id ? (
              <Button to={`/invoices/${recovery.payment.invoiceId._id}`}>View invoice</Button>
            ) : (
              <Button to="/patient/payments">View payment history</Button>
            )}
          </div>
        </Card>
      )}

      {!error && (view === "confirming" || confirmPhase === "unknown") && (
        <Card title={confirmPhase === "unknown" ? "Still confirming your payment" : "Confirming your payment..."}>
          <div className="space-y-3" role="status" aria-live="polite">
            <p className="text-sm text-slate-600">
              {confirmPhase === "unknown"
                ? "We have not received a final answer from the payment provider yet. If money was deducted it will be matched to this appointment automatically. Please don't start a new payment."
                : "We're confirming your payment with the payment provider. This can take a moment. Please don't start a new payment or close this page."}
            </p>
            <Button variant="secondary" onClick={confirmWithBackend} disabled={confirmPhase === "confirming"}>Refresh status</Button>
          </div>
        </Card>
      )}

      {!error && !confirmPhase && view === "continue" && (
        <Card title="Your payment is ready">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">A secure payment order was already created for this appointment. You can continue where you left off.</p>
            <Button onClick={resumeFromRecovery}>Continue payment</Button>
          </div>
        </Card>
      )}

      {!error && !confirmPhase && view === "reconciliation" && (
        <Card title="We're reviewing this payment">
          <p className="text-sm text-slate-600">
            Something about this payment needs a closer look on our end before it can proceed. Our team has been notified —
            please contact support if this doesn't resolve shortly, and avoid starting a new payment in the meantime.
          </p>
        </Card>
      )}

      {!error && !confirmPhase && view === "failed" && (
        <Card title="Payment failed">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Your last payment attempt didn't go through
              {recovery?.attempts?.length > 0 && ` (Attempt ${recovery.attempts.length})`}.
            </p>
            {recovery?.attempts?.length > 0 && (
              <div className="space-y-1">
                {recovery.attempts.map((a) => (
                  <p key={a._id} className="text-xs font-semibold text-slate-500">
                    Attempt {a.attemptNumber} — {a.status?.replace(/_/g, " ")}
                  </p>
                ))}
              </div>
            )}
            {recovery?.retryAvailable === false ? (
              <p className="text-sm font-semibold text-slate-600">The retry limit for this payment was reached. Please start a new payment from your appointments.</p>
            ) : (
              <Button onClick={retryPayment} isLoading={isRetrying}>Try Again</Button>
            )}
          </div>
        </Card>
      )}

      {!error && !showRecoveryBanner && payment && (
        <Card title="Payment breakdown">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs font-bold text-slate-500">Total</p>
              <p className="text-lg font-black text-slate-950">₹{payment.totalAmount}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">Wallet</p>
              <p className="text-lg font-black text-blue-600">₹{payment.walletAmount || 0}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">Pay now (gateway)</p>
              <p className="text-lg font-black text-emerald-600">₹{payment.gatewayAmount ?? payment.totalAmount}</p>
            </div>
          </div>
        </Card>
      )}

      {!error && !showRecoveryBanner && (
        <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-6">
            <Card title="Billing Controls">
              <div className="space-y-4">
                <CouponBox
                  couponCode={couponCode}
                  discountAmount={couponDiscount}
                  error={couponError}
                  isLoading={isApplyingCoupon}
                  onApply={applyCoupon}
                  onChange={(value) => {
                    setCouponCode(value);
                    setPayment(null);
                    setOrder(null);
                  }}
                />
                <div className="rounded-2xl border border-white/60 bg-white/60 p-4 shadow-lg">
                  <div className="flex items-center gap-3">
                    <span className="rounded-xl bg-blue-600/10 p-2 text-blue-600">
                      <ShieldCheck size={20} />
                    </span>
                    <div>
                      <p className="font-black text-slate-950">Wallet contribution</p>
                      <p className="text-xs font-semibold text-slate-500">
                        Available balance: {wallet?.currency || "INR"} {wallet?.availableBalance ?? wallet?.balance ?? 0}
                      </p>
                    </div>
                  </div>
                  <Input
                    className="mt-4"
                    min="0"
                    type="number"
                    placeholder="0"
                    value={walletAmount}
                    onChange={(event) => {
                      setWalletAmount(event.target.value);
                      setPayment(null);
                      setOrder(null);
                    }}
                  />
                </div>
                <Button className="w-full" onClick={prepareOrder} isLoading={isPreparing}>
                  Prepare Secure Order
                </Button>
              </div>
            </Card>

            {payment && (
              <Card title={t("paymentFlow.payment")}>
                <FinancialWorkflow
                  current={workflowStep}
                  steps={[
                    { key: "appointment", label: t("paymentFlow.appointment") },
                    { key: "bill", label: t("paymentFlow.bill") },
                    { key: "payment", label: t("paymentFlow.orderCreated") },
                    { key: "verification", label: t("paymentFlow.verifying") },
                    { key: "completion", label: t("paymentFlow.completion") },
                  ]}
                />
              </Card>
            )}
            <PaymentSummaryCard payment={payment} appointment={appointment} />
          </div>

          <Card title={t("payment.heading")}>
            <div className="rounded-2xl bg-white/60 p-5 shadow-lg">
              <CheckCircle2 className="text-blue-600" size={28} />
              <p className="mt-4 text-sm leading-6 text-slate-600">
                Payment is verified only by the backend using Razorpay signature validation.
                Webhooks, invoice generation, wallet ledger, and email receipts are handled server-side.
              </p>
              <Button className="mt-6 w-full" onClick={startPayment} isLoading={isPaying} disabled={!order || checkoutBusy || Boolean(confirmPhase)}>
                Pay Securely
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default PaymentCheckout;
