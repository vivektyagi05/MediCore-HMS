import { useEffect, useMemo, useState } from "react";

import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";

import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useToast } from "../../context/ToastContext";

const SEVERITY_STYLES = {
  info: "bg-blue-100 text-blue-700",
  warning: "bg-amber-100 text-amber-700",
  critical: "bg-rose-100 text-rose-700",
};

function AdminAudit() {
  const toast = useToast();
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const loadLogs = async (page = 1) => {
    try {
      setLoading(true);
      const params = { page, limit: 25 };
      if (severity !== "all") params.severity = severity;
      if (search) params.search = search;
      if (from) params.from = from;
      if (to) params.to = to;

      const response = await adminApi.getActivity(params);
      setLogs(response.data?.logs || []);
      setPagination(response.data?.pagination || { page: 1, limit: 25, total: 0, pages: 1 });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs(1);
  }, [severity]);

  const resourceTypes = useMemo(
    () => [...new Set(logs.map((log) => log.resourceType))].filter(Boolean),
    [logs]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-950">Audit Center</h1>
        <p className="text-sm text-slate-500">
          A searchable timeline of admin actions, authentication events, and system changes.
        </p>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <Input
              label="Search"
              placeholder="Search action or resource"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadLogs(1)}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm"
            >
              <option value="all">All</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button onClick={() => loadLogs(1)}>Apply Filters</Button>
        </div>

        {loading ? (
          <Loader label="Loading audit trail" />
        ) : logs.length === 0 ? (
          <EmptyState
            title="No matching activity"
            description="Try widening your date range or clearing filters."
          />
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log._id}
                className="flex flex-col gap-2 rounded-xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {log.action}{" "}
                    <span className="font-normal text-slate-500">on {log.resourceType}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {log.actorId?.name || "System"} ({log.actorId?.role || "—"}) ·{" "}
                    {new Date(log.createdAt).toLocaleString()}
                    {log.ip ? ` · ${log.ip}` : ""}
                  </p>
                </div>
                <span
                  className={`w-fit rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                    SEVERITY_STYLES[log.severity] || "bg-slate-100 text-slate-700"
                  }`}
                >
                  {log.severity}
                </span>
              </div>
            ))}
          </div>
        )}

        {pagination.pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <p>
              Page {pagination.page} of {pagination.pages} ({pagination.total} events)
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={pagination.page <= 1}
                onClick={() => loadLogs(pagination.page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={pagination.page >= pagination.pages}
                onClick={() => loadLogs(pagination.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {resourceTypes.length > 0 && (
        <Card title="Resource Types on This Page">
          <div className="flex flex-wrap gap-2">
            {resourceTypes.map((type) => (
              <span key={type} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {type}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default AdminAudit;
