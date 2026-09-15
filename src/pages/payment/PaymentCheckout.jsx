import { ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
      setError(getApiErrorMessage(prepareError));
    } finally {
      setIsPreparing(false);
    }
  };

  const startPayment = async () => {
    setIsPaying(true);
    setWorkflowStep(3);
    try {
      if (gateway === "test") {
        const response = await paymentApi.completeTestPayment(order.id);
        setWorkflowStep(4);
        const verified = await paymentApi.verifyPayment(response.data);
        window.sessionStorage.removeItem(`hms-payment-${appointmentId}`);
        if (verified.data.invoice?._id) {
          navigate(`/invoices/${verified.data.invoice._id}`, { replace: true });
        } else {
          navigate("/patient/payments", { replace: true });
        }
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
        handler: async (response) => {
          setWorkflowStep(4);
          const verified = await paymentApi.verifyPayment({
            razorpayOrderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          });
          window.sessionStorage.removeItem(`hms-payment-${appointmentId}`);
          if (verified.data.invoice?._id) {
            navigate(`/invoices/${verified.data.invoice._id}`, { replace: true });
          } else {
            navigate("/patient/payments", { replace: true });
          }
        },
      });
      checkout.open();
    } catch (paymentError) {
      toast.error(getApiErrorMessage(paymentError));
      setWorkflowStep(3);
    } finally {
      setIsPaying(false);
    }
  };

  if (isLoading || isCheckingRecovery) return <Loader label="Checking your payment status..." />;

  // P23 Section 5 — recovery branches. SUCCESS/PENDING/REQUIRES_RECONCILIATION
  // all short-circuit the normal "prepare a new order" flow so we never
  // create a second payment while one already exists in an authoritative
  // non-fresh state.
  const recoveryState = recovery?.recoveryState;
  const showRecoveryBanner = recoveryState && recoveryState !== "NONE";

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

      {!error && recoveryState === "SUCCESS" && (
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

      {!error && recoveryState === "PENDING" && (
        <Card title="Checking your payment status...">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              We're confirming your payment with the payment provider. This can take a moment — please don't start a new payment.
            </p>
            <Button variant="secondary" onClick={checkRecovery}>Refresh status</Button>
          </div>
        </Card>
      )}

      {!error && recoveryState === "REQUIRES_RECONCILIATION" && (
        <Card title="We're reviewing this payment">
          <p className="text-sm text-slate-600">
            Something about this payment needs a closer look on our end before it can proceed. Our team has been notified —
            please contact support if this doesn't resolve shortly, and avoid starting a new payment in the meantime.
          </p>
        </Card>
      )}

      {!error && recoveryState === "FAILED" && (
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
            <Button onClick={retryPayment} isLoading={isRetrying}>Try Again</Button>
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
                        Available balance: {wallet?.currency || "INR"} {wallet?.balance || 0}
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
              <Button className="mt-6 w-full" onClick={startPayment} isLoading={isPaying} disabled={!order}>
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
