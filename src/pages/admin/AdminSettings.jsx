import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import SettingsTabs from "../../components/settings/SettingsTabs";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Checkbox from "../../components/ui/Checkbox";
import Loader from "../../components/ui/Loader";
import ErrorState from "../../components/shared/ErrorState";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const tabs = [
  { id: "profile", label: "Hospital" },
  { id: "appointments", label: "Appointments" },
  { id: "payments", label: "Payments" },
  { id: "operations", label: "Operations Capacity" },
  { id: "governance", label: "Governance Policy" },
];

// Same low/medium/high/critical vocabulary as
// backend/process-governance/governancePolicy.js's TIER_RANK — not
// re-invented here.
const RISK_TIERS = ["low", "medium", "high", "critical"];

function TierCheckboxRow({ label, hint, value, onChange }) {
  const toggle = (tier) => {
    const next = value.includes(tier) ? value.filter((t) => t !== tier) : [...value, tier];
    onChange(next);
  };
  return (
    <div>
      <p className="text-sm font-bold text-slate-800">{label}</p>
      {hint && <p className="text-xs font-medium text-slate-500">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-4">
        {RISK_TIERS.map((tier) => (
          <Checkbox key={tier} label={tier} checked={value.includes(tier)} onChange={() => toggle(tier)} />
        ))}
      </div>
    </div>
  );
}

function AdminSettings() {
  const toast = useToast();
  const { t } = useI18n();
  const [settings, setSettings] = useState(null);
  const [activeTab, setActiveTab] = useState("profile");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveState, setSaveState] = useState(() => t("common.saved"));

  const loadSettings = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    adminApi
      .getSettings()
      .then((res) => setSettings(res.data.settings))
      .catch((err) => setLoadError(getApiErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!settings || isLoading) return;
    setSaveState(t("common.saving"));
    const id = window.setTimeout(async () => {
      try {
        await adminApi.updateSettings(settings);
        setSaveState(t("common.saved"));
      } catch (err) {
        setSaveState(getApiErrorMessage(err) || t("common.error"));
        toast.error(getApiErrorMessage(err));
      }
    }, 700);
    return () => window.clearTimeout(id);
  }, [settings, isLoading, toast, t]);

  const retrySave = () => {
    // Nudging settings through a shallow clone re-triggers the debounced
    // save effect above without duplicating its request logic here.
    setSettings((current) => ({ ...current }));
  };

  if (isLoading) return <Loader label="Loading settings" />;

  // BUG FIX: previously, a failed initial load left `settings` null while
  // `isLoading` became false, and the render below immediately dereferenced
  // `settings.hospitalName` etc. — an unhandled crash, not the
  // Loading/Success/Empty/Error/Retry states every admin section requires.
  if (loadError || !settings) {
    return <ErrorState title="Settings unavailable" description={loadError || "Settings could not be loaded."} onRetry={loadSettings} />;
  }

  const update = (path, value) => {
    setSettings((current) => {
      const next = structuredClone(current);
      const keys = path.split(".");
      let ref = next;
      keys.slice(0, -1).forEach((key) => { ref = ref[key]; });
      ref[keys.at(-1)] = value;
      return next;
    });
  };

  const saveFailed = saveState !== t("common.saved") && saveState !== t("common.saving");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Hospital Settings</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Central control panel</h1>
        <p className="mt-2 flex items-center gap-3 text-sm font-bold text-slate-500">
          {saveState}
          {saveFailed && (
            <button type="button" onClick={retrySave} className="font-black text-blue-600 underline underline-offset-2">
              Retry
            </button>
          )}
        </p>
      </div>
      <SettingsTabs activeTab={activeTab} onChange={setActiveTab} tabs={tabs} />
      <Card>
        {activeTab === "profile" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Hospital name" value={settings.hospitalName} onChange={(e) => update("hospitalName", e.target.value)} />
            <Input label="Logo URL" value={settings.logoUrl || ""} onChange={(e) => update("logoUrl", e.target.value)} />
            <Input label="Support email" value={settings.supportEmail} onChange={(e) => update("supportEmail", e.target.value)} />
            <Input label="Phone" value={settings.phone || ""} onChange={(e) => update("phone", e.target.value)} />
            <Input label="Timezone" value={settings.timezone} onChange={(e) => update("timezone", e.target.value)} />
          </div>
        )}
        {activeTab === "appointments" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Daily limit per doctor" type="number" value={settings.appointmentLimits.dailyPerDoctor} onChange={(e) => update("appointmentLimits.dailyPerDoctor", Number(e.target.value))} />
            <Input label="Booking window days" type="number" value={settings.appointmentLimits.bookingWindowDays} onChange={(e) => update("appointmentLimits.bookingWindowDays", Number(e.target.value))} />
          </div>
        )}
        {activeTab === "payments" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Currency" value={settings.paymentSettings.currency} onChange={(e) => update("paymentSettings.currency", e.target.value)} />
            <Input label="Tax rate %" type="number" value={settings.paymentSettings.taxRate} onChange={(e) => update("paymentSettings.taxRate", Number(e.target.value))} />
            <Checkbox label="Refunds enabled" checked={settings.paymentSettings.refundsEnabled} onChange={(e) => update("paymentSettings.refundsEnabled", e.target.checked)} />
          </div>
        )}
        {activeTab === "operations" && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Input
                label="Max open items per admin"
                type="number"
                value={settings.operationsCapacity.maxOpenItemsPerAdmin}
                onChange={(e) => update("operationsCapacity.maxOpenItemsPerAdmin", Number(e.target.value))}
              />
              <p className="mt-1 text-xs font-medium text-slate-500">Feeds Smart Assignment&apos;s workload/utilization scoring for every admin.</p>
            </div>
            <div>
              <Input
                label="Overload threshold %"
                type="number"
                value={settings.operationsCapacity.overloadThresholdPct}
                onChange={(e) => update("operationsCapacity.overloadThresholdPct", Number(e.target.value))}
              />
              <p className="mt-1 text-xs font-medium text-slate-500">Above this utilization, Smart Assignment flags an admin as overloaded.</p>
            </div>
          </div>
        )}
        {activeTab === "governance" && (
          <div className="space-y-6">
            <TierCheckboxRow
              label="Approval required for"
              hint="These risk tiers require sign-off before a process change can go live."
              value={settings.governancePolicy.approvalRequiredTiers}
              onChange={(next) => update("governancePolicy.approvalRequiredTiers", next)}
            />
            <TierCheckboxRow
              label="Simulation required for"
              hint="These risk tiers must be simulated before publishing."
              value={settings.governancePolicy.simulationRequiredTiers}
              onChange={(next) => update("governancePolicy.simulationRequiredTiers", next)}
            />
            <TierCheckboxRow
              label="Documentation required for"
              hint="These risk tiers must have change documentation attached."
              value={settings.governancePolicy.documentationRequiredTiers}
              onChange={(next) => update("governancePolicy.documentationRequiredTiers", next)}
            />
            <TierCheckboxRow
              label="Segregation of duties required for"
              hint="For these risk tiers, the approver can't be the same admin who made the change."
              value={settings.governancePolicy.segregationOfDutiesTiers}
              onChange={(next) => update("governancePolicy.segregationOfDutiesTiers", next)}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

export default AdminSettings;
