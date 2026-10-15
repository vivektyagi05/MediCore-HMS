// Phase 01: the few side-effect boundaries the payment-event pipeline calls
// that are NOT part of its own correctness (automation fan-out, and the
// controller's post-capture pipeline). Production uses the defaults; tests
// replace individual entries to inject failures or capture calls.
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";

export const paymentDeps = {
  emit: (...args) => emitAutomationTrigger(...args),
  postProcess: async (payment) => {
    const { completePaymentPostProcessing } = await import("../controllers/paymentController.js");
    return completePaymentPostProcessing(payment);
  },
};
