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
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

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
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [payment, setPayment] = useState(null);
  const [order, setOrder] = useState(null);
  const [razorpayKeyId, setRazorpayKeyId] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponError, setCouponError] = useState("");
  const [walletAmount, setWalletAmount] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState("");

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
      toast.success("Coupon validated");
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
      toast.success("Secure payment order is ready");
    } catch (prepareError) {
      setError(getApiErrorMessage(prepareError));
    } finally {
      setIsPreparing(false);
    }
  };

  const startPayment = async () => {
    setIsPaying(true);

    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) throw new Error("Unable to load Razorpay checkout");

      const checkout = new window.Razorpay({
        key: razorpayKeyId,
        amount: order.amount,
        currency: order.currency,
        name: "HMS Pro",
        description: "Hospital appointment payment",
        order_id: order.id,
        prefill: {
          name: user?.name,
          email: user?.email,
        },
        theme: { color: "#2563eb" },
        handler: async (response) => {
          const verified = await paymentApi.verifyPayment({
            razorpayOrderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          });
          window.sessionStorage.removeItem(`hms-payment-${appointmentId}`);
          toast.success("Payment verified and invoice generated");
          navigate(`/invoices/${verified.data.invoice._id}`, { replace: true });
        },
      });

      checkout.open();
    } catch (paymentError) {
      toast.error(getApiErrorMessage(paymentError));
    } finally {
      setIsPaying(false);
    }
  };

  if (isLoading) return <Loader label="Preparing secure checkout" />;

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

      {!error && (
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

            <PaymentSummaryCard payment={payment} appointment={appointment} />
          </div>

          <Card title="Razorpay Payment">
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
