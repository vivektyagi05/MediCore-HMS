import { useEffect, useState } from "react";
import { Download, FileArchive } from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";
import { useRealtime } from "../../context/RealtimeContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Select from "../../components/ui/Select";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import ErrorState from "../../components/shared/ErrorState";
import EmptyState from "../../components/shared/EmptyState";

// ─────────────────────────────────────────────────────────────────────────
// PHASE UI-14, PART B5 — Data Export Center.
//
// exportAdminController.js is real but synchronous: it streams a
// CSV/PDF directly on the request, guarded by export_data, and logs a
// real writeAdminLog("export.run") entry — there is no ExportJob model,
// no persisted file, no async job queue, no download-history mechanism.
// Rather than invent any of that (a second export engine PART B7
// explicitly forbids), "Export History" below reads the one real audit
// log, filtered to export.run entries via the exact-match `action` filter
// added to activityAdminController.js this phase. Because nothing is
// retained server-side, history rows are honestly labelled as not
// re-downloadable instead of a fabricated Download button.
// ─────────────────────────────────────────────────────────────────────────

const DATASETS = [
  { value: "appointments", label: "Appointments" },
  { value: "payments", label: "Payments" },
  { value: "doctors", label: "Doctors" },
  { value: "patients", label: "Patients" },
];

function AdminExportCenter() {
  const toast = useToast();
  const { dashboardSyncTick } = useRealtime();

  const [dataset, setDataset] = useState("appointments");
  const [format, setFormat] = useState("csv");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [creating, setCreating] = useState(false);

  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState(null);

  useEffect(() => {
    loadHistory();
  }, [dashboardSyncTick]);

  async function loadHistory() {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await adminApi.getActivity({ action: "export.run", limit: 20 });
      setHistory(res.data?.logs || []);
    } catch (err) {
      setHistoryError(getApiErrorMessage(err));
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleCreateExport() {
    setCreating(true);
    try {
      const params = { resource: dataset, format };
      if (from) params.from = from;
      if (to) params.to = to;
      // Appointments/Payments datasets honor from/to server-side; the
      // Doctors/Patients datasets don't filter by date on the backend
      // (they always export the full set) — the date fields stay visible
      // for consistency but only affect the datasets that actually use
      // them, matching the real backend behavior rather than implying a
      // filter that silently does nothing.
      const blob = await adminApi.exportData(params);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${dataset}-export.${format}`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded.");
      await loadHistory();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-royal-600">Platform Administration</p>
        <h1 className="text-2xl font-black text-slate-950">Data Export Center</h1>
        <p className="mt-1 text-sm text-slate-500">Exports run immediately and download to your device — nothing is retained on the server.</p>
      </div>

      <Card title="Create Export">
        <div className="grid gap-4 md:grid-cols-4">
          <Select label="Dataset" value={dataset} onChange={(e) => setDataset(e.target.value)}>
            {DATASETS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </Select>
          <Select label="Format" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
          </Select>
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={handleCreateExport} isLoading={creating}>
            <FileArchive size={16} /> Create Export
          </Button>
        </div>
      </Card>

      <Card title="Export History">
        {loadingHistory ? (
          <Loader />
        ) : historyError ? (
          <ErrorState description={historyError} onRetry={loadHistory} />
        ) : !history.length ? (
          <EmptyState title="No exports found" description="Exports you run will appear here." />
        ) : (
          <div className="overflow-x-auto rounded-card border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-bold">Dataset</th>
                  <th className="px-4 py-3 font-bold">Format</th>
                  <th className="px-4 py-3 font-bold">Requested By</th>
                  <th className="px-4 py-3 font-bold">Created At</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {history.map((log) => (
                  <tr key={log._id}>
                    <td className="px-4 py-3 font-semibold text-slate-700 capitalize">{log.resourceType}</td>
                    <td className="px-4 py-3 text-slate-600 uppercase">{log.metadata?.format || "Not recorded"}</td>
                    <td className="px-4 py-3 text-slate-600">{log.actorId?.name || "Not recorded"}</td>
                    <td className="px-4 py-3 text-slate-600">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-600">
                      Completed
                      <span className="ml-2 text-xs text-slate-400">(not retained — re-run to download again)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default AdminExportCenter;
