import { CalendarCheck, Clock3, FileText, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";

const statusClass = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function DoctorDashboard() {
  const [appointments, setAppointments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const toast = useToast();
  const { dashboardSyncTick } = useRealtime();

  const loadAppointments = async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await appointmentApi.getAppointments({ limit: 100 });
      setAppointments(response.data.appointments || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAppointments();
  }, [dashboardSyncTick]);

  const earnings = useMemo(
    () =>
      appointments
        .filter((appointment) => appointment.status === "completed")
        .reduce((total, appointment) => total + Number(appointment.doctorId?.fees || 0), 0),
    [appointments],
  );

  const updateStatus = async (id, status) => {
    setUpdatingId(id);

    try {
      await appointmentApi.updateAppointmentStatus(id, { status });
      toast.success(`Appointment ${status}`);
      await loadAppointments();
    } catch (statusError) {
      toast.error(getApiErrorMessage(statusError));
    } finally {
      setUpdatingId("");
    }
  };

  if (isLoading) return <Loader label="Loading doctor dashboard" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Doctor Dashboard</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Today&apos;s clinical schedule</h1>
          <p className="mt-2 text-sm text-slate-600">Appointments assigned to your doctor profile.</p>
        </div>
        <Button onClick={loadAppointments}>Refresh Schedule</Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {[
          { label: "My Appointments", value: appointments.length, icon: CalendarCheck },
          { label: "Pending Review", value: appointments.filter((item) => item.status === "pending").length, icon: FileText },
          { label: "Earnings", value: `$${earnings}`, icon: WalletCards },
        ].map((item) => (
          <Card key={item.label}>
            <item.icon className="text-blue-600" size={26} />
            <p className="mt-5 text-3xl font-black text-slate-950">{item.value}</p>
            <p className="mt-1 text-sm font-bold text-slate-500">{item.label}</p>
          </Card>
        ))}
      </div>

      <Card title="Appointment Workflow">
        {appointments.length ? (
          <div className="space-y-3">
            {appointments.map((appointment) => (
              <div key={appointment._id} className="rounded-2xl bg-white/60 p-4 shadow-lg">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                  <div>
                    <p className="font-black text-slate-950">{appointment.patientId?.name || "Patient"}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {formatDate(appointment.date)} at {appointment.timeSlot}
                    </p>
                    {appointment.notes && <p className="mt-2 text-sm text-slate-600">{appointment.notes}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-xl px-3 py-2 text-xs font-black capitalize ${statusClass[appointment.status]}`}>
                      {appointment.status}
                    </span>
                    {appointment.status === "pending" && (
                      <>
                        <Button onClick={() => updateStatus(appointment._id, "approved")} isLoading={updatingId === appointment._id}>
                          Approve
                        </Button>
                        <Button variant="secondary" onClick={() => updateStatus(appointment._id, "cancelled")} isLoading={updatingId === appointment._id}>
                          Reject
                        </Button>
                      </>
                    )}
                    {appointment.status === "approved" && (
                      <Button onClick={() => updateStatus(appointment._id, "completed")} isLoading={updatingId === appointment._id}>
                        Complete
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No appointments assigned"
            description="Appointments will appear after patients book slots with your doctor profile."
          />
        )}
      </Card>

      <Card title="Operational Note">
        <div className="flex items-start gap-4 rounded-2xl bg-slate-950 p-5 text-white">
          <Clock3 className="mt-1 text-blue-400" size={24} />
          <p className="text-sm leading-6 text-slate-300">
            Appointment approvals and completions are sent directly to the backend and reflected after each refresh.
          </p>
        </div>
      </Card>
    </div>
  );
}

export default DoctorDashboard;
