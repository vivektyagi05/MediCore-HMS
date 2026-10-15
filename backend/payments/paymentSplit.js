import { toPaise, fromPaise } from "./money.js";

/**
 * F-018: the one server-side wallet/gateway split. Integer paise. The gateway can
 * only charge >= INR 1, so a remainder in (0, 1) is pushed back to a INR 1 gateway
 * charge. walletOnly means the wallet covers the entire total (no gateway order).
 */
export const computePaymentSplit = ({ totalAmount, requestedWalletAmount, walletBalance }) => {
  const totalPaise = toPaise(totalAmount);
  const requestedPaise = Math.max(toPaise(requestedWalletAmount || 0), 0);
  let walletPaise = requestedPaise ? Math.min(requestedPaise, toPaise(walletBalance || 0), totalPaise) : 0;
  let gatewayPaise = totalPaise - walletPaise;
  if (gatewayPaise > 0 && gatewayPaise < 100) {
    walletPaise = Math.max(totalPaise - 100, 0);
    gatewayPaise = totalPaise - walletPaise;
    if (gatewayPaise < 100) return { error: "MIN_GATEWAY_AMOUNT" };
  }
  const walletOnly = gatewayPaise === 0 && walletPaise === totalPaise && walletPaise > 0;
  return { walletAmount: fromPaise(walletPaise), gatewayAmount: fromPaise(gatewayPaise), walletOnly, reconciles: walletPaise + gatewayPaise === totalPaise };
};
