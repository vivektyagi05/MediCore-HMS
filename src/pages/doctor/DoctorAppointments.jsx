import { CalendarDays, Search, CheckCircle2, Clock3, ClipboardCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";

import { useToast } from "../../context/ToastContext";

const statusStyles = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function DoctorAppointments() {
  const toast = useToast();

  const [appointments, setAppointments] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");

  const loadAppointments = async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await appointmentApi.getAppointments({
        limit: 100,
      });

      setAppointments(
        response.data?.appointments || [],
      );
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAppointments();
  }, []);

  const updateStatus = async (id, status) => {
    setUpdatingId(id);

    try {
      await appointmentApi.updateAppointmentStatus(
        id,
        { status },
      );

      toast.success(
        `Appointment ${status} successfully`
      );

      await loadAppointments();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setUpdatingId("");
    }
  };

  const filteredAppointments = useMemo(() => {
    return appointments.filter((appointment) => {
      const patient =
        appointment.patientId?.name
          ?.toLowerCase()
          .includes(search.toLowerCase()) ||
        appointment.patientId?.email
          ?.toLowerCase()
          .includes(search.toLowerCase());

      const statusMatch =
        statusFilter === "all"
          ? true
          : appointment.status === statusFilter;

      return patient && statusMatch;
    });
  }, [
    appointments,
    search,
    statusFilter,
  ]);

  const stats = {
    total: appointments.length,

    pending: appointments.filter(
      (a) => a.status === "pending"
    ).length,

    approved: appointments.filter(
      (a) => a.status === "approved"
    ).length,

    completed: appointments.filter(
      (a) => a.status === "completed"
    ).length,
  };

  if (isLoading) {
    return (
      <Loader label="Loading appointments..." />
    );
  }

  return (
    <div className="space-y-6">

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">
            Doctor Appointments
          </p>

          <h1 className="mt-2 text-3xl font-black">
            Appointment Management
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Manage patient bookings and consultation workflow.
          </p>
        </div>

        <Button onClick={loadAppointments}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">

        <Card>
          <CalendarDays className="text-blue-600" />
          <p className="mt-4 text-3xl font-black">
            {stats.total}
          </p>
          <p className="text-sm font-bold text-slate-500">
            Total
          </p>
        </Card>

        <Card>
          <Clock3 className="text-amber-600" />
          <p className="mt-4 text-3xl font-black">
            {stats.pending}
          </p>
          <p className="text-sm font-bold text-slate-500">
            Pending
          </p>
        </Card>

        <Card>
          <CheckCircle2 className="text-blue-600" />
          <p className="mt-4 text-3xl font-black">
            {stats.approved}
          </p>
          <p className="text-sm font-bold text-slate-500">
            Approved
          </p>
        </Card>

        <Card>
          <ClipboardCheck className="text-emerald-600" />
          <p className="mt-4 text-3xl font-black">
            {stats.completed}
          </p>
          <p className="text-sm font-bold text-slate-500">
            Completed
          </p>
        </Card>

      </div>

      <Card title="Search & Filter">

        <div className="grid gap-4 md:grid-cols-2">

          <div className="relative">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              value={search}
              onChange={(e) =>
                setSearch(e.target.value)
              }
              placeholder="Search patient..."
              className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value)
            }
            className="rounded-2xl border border-slate-200 p-3"
          >
            <option value="all">All</option>
            <option value="pending">
              Pending
            </option>
            <option value="approved">
              Approved
            </option>
            <option value="completed">
              Completed
            </option>
            <option value="cancelled">
              Cancelled
            </option>
          </select>

        </div>

      </Card>

      <Card title="Appointments">

        {filteredAppointments.length === 0 ? (
          <EmptyState
            title="No appointments found"
            description="Appointments will appear here."
          />
        ) : (
          <div className="space-y-3">

            {filteredAppointments.map(
              (appointment) => (
                <div
                  key={appointment._id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

                    <div>
                      <h3 className="font-black">
                        {
                          appointment.patientId
                            ?.name
                        }
                      </h3>

                      <p className="text-sm text-slate-500">
                        {
                          appointment.patientId
                            ?.email
                        }
                      </p>

                      <p className="mt-2 text-sm">
                        {formatDate(
                          appointment.date
                        )}
                        {" • "}
                        {
                          appointment.timeSlot
                        }
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">

                      <span
                        className={`rounded-xl px-3 py-2 text-xs font-black capitalize ${statusStyles[appointment.status]}`}
                      >
                        {appointment.status}
                      </span>

                      {appointment.status ===
                        "pending" && (
                        <>
                          <Button
                            isLoading={
                              updatingId ===
                              appointment._id
                            }
                            onClick={() =>
                              updateStatus(
                                appointment._id,
                                "approved"
                              )
                            }
                          >
                            Approve
                          </Button>

                          <Button
                            variant="secondary"
                            isLoading={
                              updatingId ===
                              appointment._id
                            }
                            onClick={() =>
                              updateStatus(
                                appointment._id,
                                "cancelled"
                              )
                            }
                          >
                            Reject
                          </Button>
                        </>
                      )}

                      {appointment.status ===
                          "approved" &&

                      appointment.paymentStatus ===
                          "paid" && (
                          <Button
                            onClick={() =>
                              updateStatus(
                                appointment._id,
                                "completed"
                              )
                            }
                          >
                            Complete
                          </Button>
                          
                        )}
                    </div>

                    

                  </div>
                </div>
              )
            )}

          </div>
        )}

      </Card>

    </div>
  );
}

export default DoctorAppointments;