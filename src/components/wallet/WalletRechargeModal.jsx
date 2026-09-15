import { useState } from "react";
import { financeApi } from "../../api/financeApi";
import { getApiErrorMessage } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Modal from "../ui/Modal";

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

// P23 BUG 2 FIX. The old modal only ever wired up Razorpay's `handler`
// callback (checkout SUCCESS) and treated calling verify as the end of the
// story — a valid signature was shown to the patient as "recharged
// successfully" regardless of what the backend actually did with it. This
// rewrite handles every real outcome (Section 6/7):
//   - success            -> verify; backend may still say "captured" or
//                           "still pending" (202) — both are shown honestly
//   - checkout dismissed -> cancelWalletRecharge; order preserved for
//                           recovery, never treated as a credit
//   - payment failure inside checkout -> shown as a real failure, never
//                           silently retried and never credited
//   - network/verify failure -> the order is never lost; the wallet page's
//                           recharge history + status recovery can resolve
//                           it later without the patient paying twice
function WalletRechargeModal({ isOpen, onClose, onSuccess }) {
  const { user } = useAuth();
  const toast = useToast();
  const [amount, setAmount] = useState("1000");
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const recharge = async () => {
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) throw new Error("Unable to load Razorpay checkout");

      const response = await financeApi.createWalletRechargeOrder({ amount: Number(amount) });
      const { order, razorpayKeyId } = response.data;

      const checkout = new window.Razorpay({
        key: razorpayKeyId,
        amount: order.amount,
        currency: order.currency,
        name: "HMS Pro Wallet",
        description: "Wallet recharge",
        order_id: order.id,
        prefill: { name: user?.name, email: user?.email },
        theme: { color: "#2563eb" },
        // Checkout dismissed without a success callback (closed tab/modal,
        // or the patient backed out). Never credit the wallet for this —
        // preserve the order so it can be recovered/retried later.
        modal: {
          ondismiss: async () => {
            try {
              await financeApi.cancelWalletRecharge({ gatewayOrderId: order.id });
            } catch {
              // Best-effort — even if this call fails, the recharge history
              // / status-check recovery path still exists.
            }
            setIsLoading(false);
            toast.info("Recharge cancelled. No amount was added to your wallet.");
          },
        },
        handler: async (result) => {
          try {
            const verifyResponse = await financeApi.verifyWalletRecharge({
              razorpayOrderId: result.razorpay_order_id,
              paymentId: result.razorpay_payment_id,
              signature: result.razorpay_signature,
            });
            if (verifyResponse?.data?.recharge?.status === "pending") {
              setStatusMessage("Payment is still being confirmed by the provider. Check your wallet's recharge history for the latest status.");
              toast.error("Payment confirmation is still pending — no amount has been added yet.");
            } else {
              toast.success("Wallet recharged successfully");
              onSuccess();
              onClose();
            }
          } catch (verifyError) {
            // The recharge order still exists server-side (never lost) even
            // though this specific call failed/timed out — surface that
            // honestly instead of claiming success or silently retrying.
            setStatusMessage(getApiErrorMessage(verifyError));
            toast.error(getApiErrorMessage(verifyError));
          } finally {
            setIsLoading(false);
          }
        },
      });

      // Razorpay's own in-checkout failure event — the provider itself
      // reports the payment did not go through.
      checkout.on?.("payment.failed", async (failure) => {
        try {
          await financeApi.getWalletRechargeStatus(order.id);
        } catch {
          // ignore — recovery just re-checks, never fabricates
        }
        setStatusMessage(failure?.error?.description || "Payment failed at the provider.");
        toast.error("Payment failed. No amount was added to your wallet.");
        setIsLoading(false);
      });

      checkout.open();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Recharge Wallet" onClose={onClose}>
      <div className="space-y-4">
        <Input
          label="Amount"
          min="1"
          type="number"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        {statusMessage && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{statusMessage}</p>
        )}
        <Button className="w-full" onClick={recharge} isLoading={isLoading} disabled={Number(amount) < 1}>
          Continue to Razorpay
        </Button>
      </div>
    </Modal>
  );
}

export default WalletRechargeModal;
