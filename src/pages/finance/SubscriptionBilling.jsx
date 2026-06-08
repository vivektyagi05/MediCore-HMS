import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { financeApi } from "../../api/financeApi";
import EmptyState from "../../components/shared/EmptyState";
import SubscriptionPlans from "../../components/subscription/SubscriptionPlans";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

function SubscriptionBilling() {
  const toast = useToast();
  const [plans, setPlans] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [error, setError] = useState("");

  const loadBilling = async () => {
    setIsLoading(true);
    setError("");
    try {
      const [plansResponse, subscriptionsResponse] = await Promise.all([
        financeApi.getPlans(),
        financeApi.getSubscriptions(),
      ]);
      setPlans(plansResponse.data.plans || []);
      setSubscriptions(subscriptionsResponse.data.subscriptions || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBilling();
  }, []);

  const subscribe = async (planCode) => {
    setIsSubscribing(true);
    try {
      await financeApi.createSubscription({ planCode });
      toast.success("Subscription activated");
      loadBilling();
    } catch (subscribeError) {
      toast.error(getApiErrorMessage(subscribeError));
    } finally {
      setIsSubscribing(false);
    }
  };

  if (isLoading) return <Loader label="Loading subscriptions" />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Subscriptions</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Doctor premium billing</h1>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      <SubscriptionPlans plans={plans} isLoading={isSubscribing} onSubscribe={subscribe} />

      <Card title="Billing History">
        {subscriptions.length ? (
          <div className="space-y-3">
            {subscriptions.map((subscription) => (
              <div key={subscription._id} className="flex flex-col justify-between gap-3 rounded-2xl bg-white/60 p-4 shadow-lg sm:flex-row sm:items-center">
                <div>
                  <p className="font-black text-slate-950">{subscription.planName}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500">Next billing: {subscription.nextBillingAt ? new Date(subscription.nextBillingAt).toLocaleDateString() : "Not scheduled"}</p>
                </div>
                <span className="rounded-xl bg-blue-600/10 px-3 py-2 text-sm font-black capitalize text-blue-600">
                  {subscription.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No subscriptions" description="Premium doctor billing plans will appear here." />
        )}
      </Card>
    </div>
  );
}

export default SubscriptionBilling;
