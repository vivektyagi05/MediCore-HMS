import { useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import SettingsTabs from "../../components/settings/SettingsTabs";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

const tabs = [
  { id: "profile", label: "Hospital" },
  { id: "appointments", label: "Appointments" },
  { id: "payments", label: "Payments" },
];

function AdminSettings() {
  const [settings, setSettings] = useState(null);
  const [activeTab, setActiveTab] = useState("profile");
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState("Saved");
  const toast = useToast();

  useEffect(() => {
    adminApi.getSettings().then((res) => setSettings(res.data.settings)).catch((err) => toast.error(getApiErrorMessage(err))).finally(() => setIsLoading(false));
  }, [toast]);

  useEffect(() => {
    if (!settings || isLoading) return;
    setSaveState("Saving...");
    const id = window.setTimeout(async () => {
      try {
        await adminApi.updateSettings(settings);
        setSaveState("Saved");
      } catch (err) {
        setSaveState("Save failed");
        toast.error(getApiErrorMessage(err));
      }
    }, 700);
    return () => window.clearTimeout(id);
  }, [settings, isLoading, toast]);

  if (isLoading) return <Loader label="Loading settings" />;

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

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Hospital Settings</p><h1 className="mt-2 text-3xl font-black text-slate-950">Central control panel</h1><p className="mt-2 text-sm font-bold text-slate-500">{saveState}</p></div>
      <SettingsTabs activeTab={activeTab} onChange={setActiveTab} tabs={tabs} />
      <Card>
        {activeTab === "profile" && <div className="grid gap-4 md:grid-cols-2"><Input label="Hospital name" value={settings.hospitalName} onChange={(e) => update("hospitalName", e.target.value)} /><Input label="Logo URL" value={settings.logoUrl || ""} onChange={(e) => update("logoUrl", e.target.value)} /><Input label="Support email" value={settings.supportEmail} onChange={(e) => update("supportEmail", e.target.value)} /><Input label="Phone" value={settings.phone || ""} onChange={(e) => update("phone", e.target.value)} /><Input label="Timezone" value={settings.timezone} onChange={(e) => update("timezone", e.target.value)} /></div>}
        {activeTab === "appointments" && <div className="grid gap-4 md:grid-cols-2"><Input label="Daily limit per doctor" type="number" value={settings.appointmentLimits.dailyPerDoctor} onChange={(e) => update("appointmentLimits.dailyPerDoctor", Number(e.target.value))} /><Input label="Booking window days" type="number" value={settings.appointmentLimits.bookingWindowDays} onChange={(e) => update("appointmentLimits.bookingWindowDays", Number(e.target.value))} /></div>}
        {activeTab === "payments" && <div className="grid gap-4 md:grid-cols-2"><Input label="Currency" value={settings.paymentSettings.currency} onChange={(e) => update("paymentSettings.currency", e.target.value)} /><Input label="Tax rate %" type="number" value={settings.paymentSettings.taxRate} onChange={(e) => update("paymentSettings.taxRate", Number(e.target.value))} /><label className="flex items-center gap-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={settings.paymentSettings.refundsEnabled} onChange={(e) => update("paymentSettings.refundsEnabled", e.target.checked)} /> Refunds enabled</label></div>}
      </Card>
    </div>
  );
}

export default AdminSettings;
