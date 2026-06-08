import { Activity, CalendarCheck, Stethoscope, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { doctorApi } from "../../api/doctorApi";
import EmptyState from "../../components/shared/EmptyState";
import Skeleton from "../../components/shared/Skeleton";
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

function appointmentDate(appointment) {
  return new Date(appointment.date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function AdminDashboard() {
  const [doctors, setDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const toast = useToast();
  const { dashboardSyncTick } = useRealtime();

  const loadDashboard = async () => {
    setIsLoading(true);
    setError("");

    try {
      const [doctorResponse, appointmentResponse] = await Promise.all([
        doctorApi.getDoctors({ limit: 100 }),
        appointmentApi.getAppointments({ limit: 100 }),
      ]);

      setDoctors(doctorResponse.data.doctors || []);
      setAppointments(appointmentResponse.data.appointments || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [dashboardSyncTick]);

  const uniquePatients = useMemo(
    () => new Set(appointments.map((item) => item.patientId?._id).filter(Boolean)).size,
    [appointments],
  );

  const stats = [
    { label: "Total Doctors", value: doctors.length, icon: Stethoscope },
    { label: "Patients With Bookings", value: uniquePatients, icon: UsersRound },
    { label: "Total Appointments", value: appointments.length, icon: CalendarCheck },
    {
      label: "Pending Requests",
      value: appointments.filter((item) => item.status === "pending").length,
      icon: Activity,
    },
  ];

  const updateStatus = async (id, status) => {
    setUpdatingId(id);

    try {
      await appointmentApi.updateAppointmentStatus(id, { status });
      toast.success(`Appointment ${status}`);
      await loadDashboard();
    } catch (statusError) {
      toast.error(getApiErrorMessage(statusError));
    } finally {
      setUpdatingId("");
    }
  };

  if (isLoading) return <Loader label="Loading admin dashboard" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Admin Dashboard</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Hospital command center</h1>
          <p className="mt-2 text-sm text-slate-600">Live operational metrics from the HMS API.</p>
        </div>
        <Button onClick={loadDashboard}>Refresh Data</Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-500">{stat.label}</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{stat.value}</p>
                <p className="mt-2 text-sm font-black text-blue-600">Synced from API</p>
              </div>
              <div className="rounded-xl bg-slate-950 p-3 text-white shadow-lg">
                <stat.icon size={20} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card title="All Appointments">
          {appointments.length ? (
            <div className="space-y-3">
              {appointments.map((appointment) => (
                <div key={appointment._id} className="rounded-2xl bg-white/60 p-4 shadow-lg">
                  <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                    <div>
                      <p className="font-black text-slate-950">
                        {appointment.patientId?.name || "Patient"} with Dr. {appointment.doctorId?.userId?.name || "Doctor"}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {appointmentDate(appointment)} at {appointment.timeSlot}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-xl px-3 py-2 text-xs font-black capitalize ${statusClass[appointment.status]}`}>
                        {appointment.status}
                      </span>
                      {appointment.status === "pending" && (
                        <>
                          <Button
                            onClick={() => updateStatus(appointment._id, "approved")}
                            isLoading={updatingId === appointment._id}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => updateStatus(appointment._id, "cancelled")}
                            isLoading={updatingId === appointment._id}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No appointments yet" description="Appointments booked by patients will appear here." />
          )}
        </Card>

        <Card title="Doctor Directory">
          {doctors.length ? (
            <div className="space-y-3">
              {doctors.slice(0, 6).map((doctor) => (
                <div key={doctor._id} className="rounded-2xl bg-white/60 p-4 shadow-lg">
                  <p className="font-black text-slate-950">Dr. {doctor.userId?.name}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500">{doctor.specialization}</p>
                  <p className="mt-2 text-sm font-black text-blue-600">${doctor.fees} fee</p>
                </div>
              ))}
            </div>
          ) : (
            <Skeleton rows={4} />
          )}
        </Card>
      </div>
    </div>
  );
}

export default AdminDashboard;
