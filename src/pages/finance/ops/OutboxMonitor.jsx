import { RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../../api/adminApi";
import { getApiErrorMessage } from "../../../api/axios";
import EmptyState from "../../../components/shared/EmptyState";
import ErrorState from "../../../components/shared/ErrorState";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import ReasonDialog from "../../../components/ui/ReasonDialog";
import Loader from "../../../components/ui/Loader";
import MetricCard from "../../../components/ui/MetricCard";
import StatusBadge from "../../../components/ui/StatusBadge";
import { useToast } from "../../../context/ToastContext";

// Durable financial-event (email outbox) health. "queued" is not "delivered": only `sent`
// means the provider accepted the message. Exhausted rows can be re-queued with a reason.
function OutboxMonitor() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [target, setTarget] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      setData((await adminApi.getFinanceOutbox({ page, limit: 20 })).data);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [page]);
  useEffect(() => { load(); }, [load]);

  // The dialog owns the reason text and its validation (5-300, like the server). A rejection (e.g. 409 "no longer
  // exhausted") is shown INSIDE the dialog with the typed text kept; we refresh the list so the row reflects reality.
  const requeue = async ({ reason }) => {
    try {
      await adminApi.requeueFinanceOutboxEvent(target._id, reason);
    } catch (error) {
      await load();
      throw new Error(getApiErrorMessage(error), { cause: error });
    }
    toast.success("Event re-queued. It is delivered only when the provider accepts it.");
    setTarget(null);
    await load();
  };

  // Re-queuing the last row of the last page leaves the current page empty even though earlier pages still have rows.
  useEffect(() => {
    if (data && data.failed.length === 0 && page > 1) setPage((p) => Math.max(p - 1, 1));
  }, [data, page]);

  if (isLoading && !data) return <Loader label="Loading delivery health" />;
  if (loadError) return <ErrorState description={loadError} onRetry={load} />;
  const counts = data.counts;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Queued" value={counts.queued} />
        <MetricCard label="Retrying" value={counts.retrying} tone={counts.retrying ? "warning" : "neutral"} />
        <MetricCard label="Sending" value={counts.sending} caption={data.stuckSending ? `${data.stuckSending} look stuck` : "In flight"} tone={data.stuckSending ? "danger" : "neutral"} />
        <MetricCard label="Delivered" value={counts.sent} caption="Accepted by provider" />
        <MetricCard label="Exhausted" value={counts.failed} tone={counts.failed ? "danger" : "neutral"} caption="Needs operator action" />
      </div>
      <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={load}><RefreshCcw size={14} /> Refresh</Button></div>

      {data.failed.length === 0 ? (
        <EmptyState title="No exhausted events" description="Every financial notification is delivered or still within its retry budget." />
      ) : (
        <Card title="Exhausted events">
          <div className="space-y-2">
            {data.failed.map((row) => (
              <div key={row._id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-slate-200 bg-white p-3">
                <div>
                  <p className="break-all font-mono text-xs text-slate-700">{row.eventKey}</p>
                  <p className="text-xs text-slate-500">
                    {row.entityType || "event"} · {row.attempts} attempts · {row.lastErrorCategory || "unknown"} · re-queued {row.requeueCount || 0}×
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone="danger">exhausted</StatusBadge>
                  <Button size="sm" variant="secondary" onClick={() => setTarget(row)}>Re-queue</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-slate-500">Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} exhausted</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      )}

      <ReasonDialog
        isOpen={Boolean(target)}
        title="Re-queue this event?"
        description="The email is sent again with a fresh retry budget. This moves no money and is recorded in the audit log."
        fields={[{ name: "reason", label: "Reason", min: 5, max: 300, multiline: true }]}
        confirmLabel="Re-queue"
        onClose={() => setTarget(null)}
        onSubmit={requeue}
      />
    </div>
  );
}

export default OutboxMonitor;
