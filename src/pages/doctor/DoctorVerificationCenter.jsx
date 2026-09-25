import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock3, XCircle, AlertTriangle, RefreshCw, FileWarning } from "lucide-react";
import { practiceApi } from "../../api/practiceApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import PracticeManagementNav from "../../components/practice/PracticeManagementNav";
import { useRealtime } from "../../context/RealtimeContext";
import { useI18n } from "../../i18n/I18nContext";

const STATUS_META = {
  not_submitted: { icon: AlertTriangle, color: "text-slate-500", bg: "bg-slate-50 border-slate-200", label: "Not Submitted" },
  approved: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", label: "Approved" },
  pending: { icon: Clock3, color: "text-amber-600", bg: "bg-amber-50 border-amber-200", label: "Pending Review" },
  rejected: { icon: XCircle, color: "text-rose-600", bg: "bg-rose-50 border-rose-200", label: "Rejected" },
};

const DOC_STATUS_META = {
  verified: { icon: CheckCircle2, color: "text-emerald-600" },
  pending: { icon: Clock3, color: "text-amber-500" },
  rejected: { icon: XCircle, color: "text-rose-600" },
  not_uploaded: { icon: FileWarning, color: "text-slate-400" },
};

// Verification Center (Phase D4, Step 4) -- required compliance documents,
// verification timeline, and expiry alerts. Reads real Doctor.documents /
// verificationHistory data; document upload itself still happens on the
// existing Document Center page (Phase D2) which this doesn't duplicate.
export default function DoctorVerificationCenter() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { dashboardSyncTick } = useRealtime();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await practiceApi.getVerificationCenter();
      setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load, dashboardSyncTick]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="glass-card h-32 rounded-2xl bg-slate-100" />
        <div className="glass-card h-64 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card flex flex-col items-center justify-center gap-3 rounded-2xl py-16 text-center">
        <p className="text-sm font-semibold text-slate-500">{error}</p>
        <button onClick={load} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  const statusMeta = STATUS_META[data.verificationStatus] || STATUS_META.not_submitted;
  const StatusIcon = statusMeta.icon;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-950">Verification Center</h2>
        <p className="mt-1 text-sm text-slate-500">Compliance documents, verification status, and timeline</p>
      </div>

      <PracticeManagementNav active="verification" />

      <div className={`glass-card flex items-center gap-4 rounded-2xl border p-5 ${statusMeta.bg}`}>
        <StatusIcon size={28} className={statusMeta.color} />
        <div>
          <p className={`text-lg font-black ${statusMeta.color}`}>{statusMeta.label}</p>
          {data.verificationNotes && <p className="mt-0.5 text-sm text-slate-600">{data.verificationNotes}</p>}
        </div>
      </div>

      {(data.expired.length > 0 || data.expiringSoon.length > 0) && (
        <div className="glass-card space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="flex items-center gap-2 text-sm font-black text-amber-800"><AlertTriangle size={15} /> Document Expiry Alerts</p>
          {data.expired.map((doc) => (
            <p key={doc._id} className="text-sm text-rose-700">⚠ {doc.title} expired on {new Date(doc.expiryDate).toLocaleDateString()}</p>
          ))}
          {data.expiringSoon.map((doc) => (
            <p key={doc._id} className="text-sm text-amber-700">{doc.title} expires on {new Date(doc.expiryDate).toLocaleDateString()}</p>
          ))}
        </div>
      )}

      <div className="glass-card rounded-2xl p-6">
        <p className="mb-4 text-xs font-black uppercase tracking-wider text-slate-400">Required Documents</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.requiredDocuments.map((doc) => {
            const meta = DOC_STATUS_META[doc.status] || DOC_STATUS_META.not_uploaded;
            const Icon = meta.icon;
            return (
              <div key={doc.type} className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
                <Icon size={18} className={meta.color} />
                <div>
                  <p className="text-sm font-bold text-slate-800">{doc.label}</p>
                  <p className="text-xs text-slate-400 capitalize">{doc.status.replace("_", " ")}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {data.timeline?.length > 0 && (
        <div className="glass-card rounded-2xl p-6">
          <p className="mb-4 text-xs font-black uppercase tracking-wider text-slate-400">Verification Timeline</p>
          <div className="space-y-3 border-l-2 border-slate-200 pl-4">
            {data.timeline.map((entry, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-blue-600" />
                <p className="text-sm font-bold capitalize text-slate-800">{entry.status}</p>
                {entry.notes && <p className="text-sm text-slate-500">{entry.notes}</p>}
                <p className="text-xs text-slate-400">{new Date(entry.changedAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <AIDraftPanel title="Verification Advisor" actionLabel="What's Outstanding?" onGenerate={() => aiAssistApi.getVerificationAdvisor()} />
    </div>
  );
}
