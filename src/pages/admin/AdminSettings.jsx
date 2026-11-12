import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import SettingsTabs from "../../components/settings/SettingsTabs";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Checkbox from "../../components/ui/Checkbox";
import Loader from "../../components/ui/Loader";
import ErrorState from "../../components/shared/ErrorState";
import { useToast } from "../../context/ToastContext";
import { useConfirm } from "../../hooks/useConfirm";
import { validateSettingsUpdate } from "../../utils/settingsValidation";
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

// A number field keeps what the admin typed: an empty box is "" (invalid, never saved), not 0. The old
// `Number(e.target.value)` turned a cleared "Tax rate" into 0 and the autosave wrote that to the server.
const toNumber = (raw) => (raw === "" ? "" : Number(raw));

function AdminSettings() {
  const toast = useToast();
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const [settings, setSettings] = useState(null);
  const [activeTab, setActiveTab] = useState("profile");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveState, setSaveState] = useState(() => t("common.saved"));
  const lastSaved = useRef(null); // JSON of the last server-confirmed settings: never re-save what is already saved
  const saveSeq = useRef(0); // ignore the result of a save that a newer edit has superseded
  const pending = useRef(null); // latest unsaved valid settings, flushed on unmount so a quick navigation cannot lose an edit

  const errors = useMemo(() => (settings ? validateSettingsUpdate(settings) : {}), [settings]);
  const hasErrors = Object.keys(errors).length > 0;

  const loadSettings = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    adminApi
      .getSettings()
      .then((res) => { lastSaved.current = JSON.stringify(res.data.settings); setSettings(res.data.settings); })
      .catch((err) => setLoadError(getApiErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!settings || isLoading) return undefined;
    const snapshot = JSON.stringify(settings);
    if (snapshot === lastSaved.current) { pending.current = null; return undefined; } // nothing changed (also: opening the page no longer writes + audits a no-op save)
    if (hasErrors) { pending.current = null; setSaveState("Not saved: fix the highlighted fields"); return undefined; }
    pending.current = settings;
    setSaveState(t("common.saving"));
    const id = window.setTimeout(async () => {
      const seq = ++saveSeq.current;
      try {
        await adminApi.updateSettings(settings);
        if (seq !== saveSeq.current) return;
        lastSaved.current = snapshot;
        pending.current = null;
        setSaveState(t("common.saved"));
      } catch (err) {
        if (seq !== saveSeq.current) return;
        setSaveState(getApiErrorMessage(err) || t("common.error"));
        toast.error(getApiErrorMessage(err));
      }
    }, 700);
    return () => window.clearTimeout(id);
  }, [settings, isLoading, hasErrors, toast, t]);

  // Leaving the page inside the debounce window used to drop the edit silently.
  useEffect(() => () => {
    if (pending.current) adminApi.updateSettings(pending.current).catch(() => {});
  }, []);

  const retrySave = () => {
    // Nudging settings through a shallow clone re-triggers the debounced
    // save effect above without duplicating its request logic here.
    lastSaved.current = null;
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

  const toggleRefunds = async (checked) => {
    // Switching refunds OFF immediately blocks every patient refund request platform-wide: make it a deliberate act.
    if (!checked && !(await confirm({
      title: "Turn refunds off?",
      description: "While refunds are off, patients cannot request refunds and admins cannot approve them. Pending requests are not affected. This applies to the whole hospital immediately.",
      confirmLabel: "Turn refunds off",
    }))) return;
    update("paymentSettings.refundsEnabled", checked);
  };

  const saveFailed = saveState !== t("common.saved") && saveState !== t("common.saving");
  const err = (path) => errors[path];
  const tabHasError = (id) => Object.keys(errors).some((k) => ({
    profile: ["hospitalName", "logoUrl", "supportEmail", "phone", "timezone"].includes(k),
    appointments: k.startsWith("appointmentLimits"), payments: k.startsWith("paymentSettings"),
    operations: k.startsWith("operationsCapacity"), governance: k.startsWith("governancePolicy"),
  })[id]);

  return (
    <>
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Hospital Settings</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Central control panel</h1>
        <p className="mt-2 flex items-center gap-3 text-sm font-bold text-slate-500" role="status" aria-live="polite">
          {saveState}
          {saveFailed && !hasErrors && (
            <button type="button" onClick={retrySave} className="font-black text-blue-600 underline underline-offset-2">
              Retry
            </button>
          )}
        </p>
        {hasErrors && (
          <p role="alert" className="mt-2 text-sm font-semibold text-rose-600">
            Some values are invalid{["profile", "appointments", "payments", "operations", "governance"].filter(tabHasError).length ? ` (check: ${tabs.filter((tab) => tabHasError(tab.id)).map((tab) => tab.label).join(", ")})` : ""}. Nothing is saved until they are fixed.
          </p>
        )}
      </div>
      <SettingsTabs activeTab={activeTab} onChange={setActiveTab} tabs={tabs} />
      <Card>
        {activeTab === "profile" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Hospital name" name="hospitalName" maxLength={120} value={settings.hospitalName ?? ""} error={err("hospitalName")} onChange={(e) => update("hospitalName", e.target.value)} />
            <Input label="Logo URL" name="logoUrl" type="url" inputMode="url" placeholder="https://" value={settings.logoUrl || ""} error={err("logoUrl")} onChange={(e) => update("logoUrl", e.target.value)} />
            <Input label="Support email" name="supportEmail" type="email" autoComplete="off" value={settings.supportEmail ?? ""} error={err("supportEmail")} onChange={(e) => update("supportEmail", e.target.value)} />
            <Input label="Phone" name="phone" type="tel" value={settings.phone || ""} error={err("phone")} onChange={(e) => update("phone", e.target.value)} />
            <Input label="Timezone" name="timezone" placeholder="Asia/Kolkata" value={settings.timezone ?? ""} error={err("timezone")} onChange={(e) => update("timezone", e.target.value)} />
          </div>
        )}
        {activeTab === "appointments" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Daily limit per doctor" name="dailyPerDoctor" type="number" inputMode="numeric" min={1} max={500} step={1} helperText="1 to 500 appointments" value={settings.appointmentLimits.dailyPerDoctor} error={err("appointmentLimits.dailyPerDoctor")} onChange={(e) => update("appointmentLimits.dailyPerDoctor", toNumber(e.target.value))} />
            <Input label="Booking window days" name="bookingWindowDays" type="number" inputMode="numeric" min={1} max={365} step={1} helperText="How far ahead patients can book (1 to 365)" value={settings.appointmentLimits.bookingWindowDays} error={err("appointmentLimits.bookingWindowDays")} onChange={(e) => update("appointmentLimits.bookingWindowDays", toNumber(e.target.value))} />
          </div>
        )}
        {activeTab === "payments" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Currency" name="currency" maxLength={3} placeholder="INR" value={settings.paymentSettings.currency ?? ""} error={err("paymentSettings.currency")} onChange={(e) => update("paymentSettings.currency", e.target.value.toUpperCase())} />
            <Input label="Tax rate %" name="taxRate" type="number" inputMode="decimal" min={0} max={100} step="0.01" helperText="Applied to every new bill. 0 to 100" value={settings.paymentSettings.taxRate} error={err("paymentSettings.taxRate")} onChange={(e) => update("paymentSettings.taxRate", toNumber(e.target.value))} />
            <Checkbox label="Refunds enabled" checked={Boolean(settings.paymentSettings.refundsEnabled)} onChange={(e) => toggleRefunds(e.target.checked)} />
          </div>
        )}
        {activeTab === "operations" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Max open items per admin"
              name="maxOpenItemsPerAdmin"
              type="number" inputMode="numeric" min={1} max={200} step={1}
              helperText="Feeds Smart Assignment's workload/utilization scoring for every admin."
              value={settings.operationsCapacity.maxOpenItemsPerAdmin}
              error={err("operationsCapacity.maxOpenItemsPerAdmin")}
              onChange={(e) => update("operationsCapacity.maxOpenItemsPerAdmin", toNumber(e.target.value))}
            />
            <Input
              label="Overload threshold %"
              name="overloadThresholdPct"
              type="number" inputMode="numeric" min={1} max={100} step={1}
              helperText="Above this utilization, Smart Assignment flags an admin as overloaded."
              value={settings.operationsCapacity.overloadThresholdPct}
              error={err("operationsCapacity.overloadThresholdPct")}
              onChange={(e) => update("operationsCapacity.overloadThresholdPct", toNumber(e.target.value))}
            />
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
    {confirmDialog}
    </>
  );
}

export default AdminSettings;
