import { Activity, BarChart3, Download, Repeat, Star, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import DoctorMetricCard from "../../components/doctor/DoctorMetricCard";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

function DoctorAnalytics() {
  const [analytics, setAnalytics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    doctorWorkflowApi.getAnalytics()
      .then((response) => setAnalytics(response.data))
      .catch((error) => toast.error(getApiErrorMessage(error)))
      .finally(() => setIsLoading(false));
  }, [toast]);

  const trend = useMemo(() => {
    if (!analytics) return [];
    return [analytics.completed, analytics.revenue / 100 || 0, analytics.cancellationRate * 100, analytics.patientReturnRatio * 100];
  }, [analytics]);

  const exportData = async (resource, format) => {
    try {
      const blob = await doctorWorkflowApi.exportData({ resource, format });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${resource}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Export started");
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  if (isLoading) return <Loader label="Loading doctor analytics" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Doctor Analytics</p><h1 className="mt-2 text-3xl font-black text-slate-950">Clinical and revenue intelligence</h1></div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-5">
        <DoctorMetricCard icon={Activity} label="Completed" value={analytics.completed} />
        <DoctorMetricCard icon={Star} label="Average rating" value={analytics.averageRating} />
        <DoctorMetricCard icon={Repeat} label="Return ratio" value={`${Math.round(analytics.patientReturnRatio * 100)}%`} />
        <DoctorMetricCard icon={BarChart3} label="Revenue" value={`INR ${analytics.revenue}`} />
        <DoctorMetricCard icon={XCircle} label="Cancellation" value={`${Math.round(analytics.cancellationRate * 100)}%`} />
      </div>
      <Card title="Revenue Trend">
        <div className="flex h-72 items-end gap-4 rounded-2xl bg-white/50 p-5">
          {trend.map((value, index) => <div key={index} className="flex-1 rounded-t-xl bg-blue-600 shadow-lg" style={{ height: `${Math.max(value, 8)}%` }} />)}
        </div>
      </Card>
      <Card title="Exports">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => exportData("prescriptions", "csv")}><Download size={17} /> Prescriptions CSV</Button>
          <Button variant="secondary" onClick={() => exportData("prescriptions", "pdf")}>Prescriptions PDF</Button>
          <Button variant="secondary" onClick={() => exportData("schedules", "csv")}>Schedule CSV</Button>
        </div>
      </Card>
    </div>
  );
}

export default DoctorAnalytics;
