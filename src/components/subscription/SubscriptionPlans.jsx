import { CheckCircle2 } from "lucide-react";
import Button from "../ui/Button";

function SubscriptionPlans({ plans, isLoading, onSubscribe }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {plans.map((plan) => (
        <div key={plan.planCode} className="rounded-2xl border border-white/70 bg-white/50 p-6 shadow-xl backdrop-blur-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em] text-blue-600">{plan.interval}</p>
              <h3 className="mt-2 text-2xl font-black text-slate-950">{plan.planName}</h3>
            </div>
            <CheckCircle2 className="text-blue-600" />
          </div>
          <p className="mt-6 text-4xl font-black text-slate-950">INR {plan.amount}</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">Premium healthcare SaaS billing architecture ready for renewals.</p>
          <Button className="mt-6 w-full" onClick={() => onSubscribe(plan.planCode)} isLoading={isLoading}>
            Activate Plan
          </Button>
        </div>
      ))}
    </div>
  );
}

export default SubscriptionPlans;
