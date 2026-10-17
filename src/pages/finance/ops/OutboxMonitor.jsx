import { RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../../api/adminApi";
import { getApiErrorMessage } from "../../../api/axios";
import EmptyState from "../../../components/shared/EmptyState";
import ErrorState from "../../../components/shared/ErrorState";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import Modal from "../../../components/ui/Modal";
import Loader from "../../../components/ui/Loader";
import MetricCard from "../../../components/ui/MetricCard";
import StatusBadge from "../../../components/ui/StatusBadge";
import Textarea from "../../../components/ui/Textarea";
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
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const confirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await adminApi.requeueFinanceOutboxEvent(target._id, reason.trim());
      toast.success("Event re-queued. It is delivered only when the provider accepts it.");
      setTarget(null);
      setReason("");
    } catch (error) {
      toast.error(getApiErrorMessage(error));
      setTarget(null);
    } finally {
      setIsSubmitting(false);
      await load();
    }
  };
  const open = (row) => {
    setTarget(row);
    setReason("");
    setReasonError("");
  };

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
                  <Button size="sm" variant="secondary" onClick={() => open(row)}>Re-queue</Button>
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

      <Modal isOpen={Boolean(target)} title="Re-queue this event?" onClose={() => !isSubmitting && setTarget(null)}>
        <p className="mb-4 text-sm leading-6 text-slate-600">
          The email is sent again with a fresh retry budget. This moves no money and is recorded in the audit log.
        </p>
        <Textarea label="Reason (required)" name="outbox-reason" required rows={3} value={reason} error={reasonError} onChange={(e) => { setReason(e.target.value); setReasonError(""); }} />
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setTarget(null)} disabled={isSubmitting}>Cancel</Button>
          <Button
            isLoading={isSubmitting}
            onClick={() => {
              if (reason.trim().length < 5) { setReasonError("Enter a reason of at least 5 characters."); return; }
              confirm();
            }}
          >
            Re-queue
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default OutboxMonitor;
