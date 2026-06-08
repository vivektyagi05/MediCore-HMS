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

function WalletRechargeModal({ isOpen, onClose, onSuccess }) {
  const { user } = useAuth();
  const toast = useToast();
  const [amount, setAmount] = useState("1000");
  const [isLoading, setIsLoading] = useState(false);

  const recharge = async () => {
    setIsLoading(true);
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
        handler: async (result) => {
          await financeApi.verifyWalletRecharge({
            razorpayOrderId: result.razorpay_order_id,
            paymentId: result.razorpay_payment_id,
            signature: result.razorpay_signature,
          });
          toast.success("Wallet recharged successfully");
          onSuccess();
          onClose();
        },
      });
      checkout.open();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
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
        <Button className="w-full" onClick={recharge} isLoading={isLoading} disabled={Number(amount) < 1}>
          Continue to Razorpay
        </Button>
      </div>
    </Modal>
  );
}

export default WalletRechargeModal;
