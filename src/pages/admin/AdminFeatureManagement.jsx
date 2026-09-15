import { useEffect, useState } from "react";
import { ToggleLeft } from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";
import { useRealtime } from "../../context/RealtimeContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import ErrorState from "../../components/shared/ErrorState";
import EmptyState from "../../components/shared/EmptyState";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import StatusBadge from "../../components/ui/StatusBadge";

// ─────────────────────────────────────────────────────────────────────────
// PHASE UI-14, PART B4 — Feature Management.
//
// featureAdminController.js (listFeatureToggles/updateFeatureToggle) was
// already real — a genuine FeatureToggle model, writeAdminLog audit, and
// an existing Automation Studio trigger (FEATURE_TOGGLE_CHANGED) — with
// zero frontend consumers. Only the 6 real seeded flags are shown; no
// "scope"/"environment" columns are invented since the model has neither.
// A flag with real platform-wide effect (registrations_paused) gets an
// explicit confirm step; the others don't need the extra friction.
// ─────────────────────────────────────────────────────────────────────────

const HIGH_IMPACT_KEYS = new Set(["registrations_paused"]);

function AdminFeatureManagement() {
  const toast = useToast();
  const { dashboardSyncTick } = useRealtime();

  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, [dashboardSyncTick]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getFeatures();
      setFeatures(res.data?.features || []);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function applyToggle(feature) {
    setBusy(true);
    try {
      await adminApi.updateFeature(feature.key, { isEnabled: !feature.isEnabled, rolloutPercentage: feature.rolloutPercentage });
      toast.success(`${feature.label} ${!feature.isEnabled ? "enabled" : "disabled"}.`);
      setConfirmTarget(null);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const handleToggleClick = (feature) => {
    if (HIGH_IMPACT_KEYS.has(feature.key)) {
      setConfirmTarget(feature);
    } else {
      applyToggle(feature);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-royal-600">Platform Administration</p>
        <h1 className="text-2xl font-black text-slate-950">Feature Management</h1>
        <p className="mt-1 text-sm text-slate-500">Real platform-wide feature flags — toggling here takes effect immediately.</p>
      </div>

      <Card>
        {loading ? (
          <Loader />
        ) : error ? (
          <ErrorState description={error} onRetry={load} />
        ) : !features.length ? (
          <EmptyState title="No feature flags configured" />
        ) : (
          <div className="space-y-3">
            {features.map((feature) => (
              <div key={feature.key} className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-slate-200 p-4">
                <div className="min-w-0 max-w-xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-slate-900">{feature.label}</p>
                    <StatusBadge tone={feature.isEnabled ? "success" : "neutral"}>{feature.isEnabled ? "Enabled" : "Disabled"}</StatusBadge>
                  </div>
                  <p className="mt-1 break-words text-sm text-slate-500">{feature.description || "No description recorded."}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">
                    Rollout: {feature.rolloutPercentage ?? 100}% · Last changed:{" "}
                    {feature.updatedAt ? new Date(feature.updatedAt).toLocaleString() : "Not recorded"}
                  </p>
                </div>
                <Button
                  variant={feature.isEnabled ? "secondary" : "primary"}
                  onClick={() => handleToggleClick(feature)}
                  isLoading={busy && confirmTarget?.key === feature.key}
                >
                  <ToggleLeft size={16} /> {feature.isEnabled ? "Disable" : "Enable"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        isOpen={Boolean(confirmTarget)}
        title={`${confirmTarget?.isEnabled ? "Disable" : "Enable"} ${confirmTarget?.label}?`}
        description="This is a platform-wide change and takes effect immediately for every user."
        tone="danger"
        confirmLabel={confirmTarget?.isEnabled ? "Disable" : "Enable"}
        isLoading={busy}
        onConfirm={() => applyToggle(confirmTarget)}
        onClose={() => setConfirmTarget(null)}
      />
    </div>
  );
}

export default AdminFeatureManagement;
