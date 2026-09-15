import { useEffect, useMemo, useState } from "react";
import { CalendarDays, IndianRupee, Stethoscope, UsersRound, XCircle, CheckCircle2 } from "lucide-react";

import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";

import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useToast } from "../../context/ToastContext";

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function MiniBarSeries({ series, valueKey, formatValue }) {
  const max = Math.max(1, ...series.map((row) => row[valueKey] || 0));
  return (
    <div className="space-y-2">
      {series.map((row) => (
        <div key={row._id} className="flex items-center gap-3">
          <span className="w-20 flex-shrink-0 text-xs text-slate-500">{row._id}</span>
          <div className="h-2 flex-1 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-blue-600"
              style={{ width: `${Math.max(4, ((row[valueKey] || 0) / max) * 100)}%` }}
            />
          </div>
          <span className="w-20 flex-shrink-0 text-right text-xs font-semibold text-slate-700">
            {formatValue ? formatValue(row[valueKey]) : row[valueKey]}
          </span>
        </div>
      ))}
    </div>
  );
}

function AdminAnalytics() {
  const toast = useToast();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(30);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getAnalytics({ days: rangeDays });
      setAnalytics(response.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [rangeDays]);

  const recentAppointments = useMemo(
    () => (analytics?.appointmentsPerDay || []).slice(-14),
    [analytics]
  );
  const recentRevenue = useMemo(
    () => (analytics?.revenuePerDay || []).slice(-14),
    [analytics]
  );

  if (loading && !analytics) return <Loader label="Loading platform analytics" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Platform Analytics</h1>
          <p className="text-sm text-slate-500">
            Real trends computed from appointments, payments, doctors, and patients — no estimates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={rangeDays}
            onChange={(e) => setRangeDays(Number(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Button variant="secondary" onClick={loadAnalytics}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="flex items-center gap-3">
            <XCircle className="text-rose-600" size={20} />
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Cancellation Rate</p>
              <p className="text-xl font-black text-slate-950">{analytics?.cancellationRate ?? 0}%</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <CheckCircle2 className="text-emerald-600" size={20} />
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Approval Rate</p>
              <p className="text-xl font-black text-slate-950">{analytics?.approvalRate ?? 0}%</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <Stethoscope className="text-indigo-600" size={20} />
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">New Doctors</p>
              <p className="text-xl font-black text-slate-950">
                {(analytics?.doctorGrowth || []).reduce((sum, r) => sum + r.count, 0)}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <UsersRound className="text-blue-600" size={20} />
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">New Patients</p>
              <p className="text-xl font-black text-slate-950">
                {(analytics?.patientGrowth || []).reduce((sum, r) => sum + r.count, 0)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Appointments Per Day" action={<CalendarDays size={18} className="text-blue-600" />}>
          {recentAppointments.length ? (
            <MiniBarSeries series={recentAppointments} valueKey="count" />
          ) : (
            <EmptyState title="No appointment data yet" description="Trends will appear once bookings accumulate." />
          )}
        </Card>
        <Card title="Revenue Trend" action={<IndianRupee size={18} className="text-emerald-600" />}>
          {recentRevenue.length ? (
            <MiniBarSeries series={recentRevenue} valueKey="total" formatValue={formatCurrency} />
          ) : (
            <EmptyState title="No revenue data yet" description="Captured payments will appear here." />
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Top Specialties">
          {analytics?.topSpecialties?.length ? (
            <MiniBarSeries series={analytics.topSpecialties} valueKey="count" />
          ) : (
            <EmptyState title="No specialty data" description="Doctor specializations will rank here." />
          )}
        </Card>
        <Card title="Top Doctors by Completed Consultations">
          {analytics?.topDoctors?.length ? (
            <div className="space-y-2">
              {analytics.topDoctors.map((doc) => (
                <div key={doc._id} className="flex items-center justify-between rounded-xl bg-white/60 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Dr. {doc.name || "Unknown"}</p>
                    <p className="text-xs text-slate-500">{doc.specialization || "General Medicine"}</p>
                  </div>
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">
                    {doc.consultations} done
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No completed consultations yet" description="Rankings will appear as appointments complete." />
          )}
        </Card>
      </div>
    </div>
  );
}

export default AdminAnalytics;
