import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  appointmentApi,
} from "../../api/appointmentApi";

import {
  getApiErrorMessage,
} from "../../api/axios";

import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Modal from "../../components/ui/Modal";
import Loader from "../../components/ui/Loader";

import {
  useToast,
} from "../../context/ToastContext";

function AdminAppointments() {

  const toast =
    useToast();

  const [appointments,
    setAppointments] =
    useState([]);

  const [loading,
    setLoading] =
    useState(true);

  const [search,
    setSearch] =
    useState("");

  const [statusFilter,
    setStatusFilter] =
    useState("all");

  const [selectedAppointment,
    setSelectedAppointment] =
    useState(null);

    const [doctorFilter,
  setDoctorFilter] =
  useState("all");

  const [dateFilter,
  setDateFilter] =
  useState("all");
    
const loadAppointments = async () => {
  try {
    setLoading(true);

    const response =
      await appointmentApi.getAppointments({
        limit: 100,
      });

    setAppointments(
      response.data?.appointments || []
    );
  } catch (error) {
    toast.error(
      getApiErrorMessage(error)
    );
  } finally {
    setLoading(false);
  }
};

const analytics = useMemo(() => ({
  total: appointments.length,
  pending: appointments.filter(a => a.status === "pending").length,
  approved: appointments.filter(a => a.status === "approved").length,
  completed: appointments.filter(a => a.status === "completed").length,
  cancelled: appointments.filter(a => a.status === "cancelled").length,
}), [appointments]);

const completionRate =
  appointments.length

    ? Math.round(
        (
          analytics.completed /
          appointments.length
        ) * 100
      )

    : 0;

const doctors =
  [
    ...new Set(
      appointments.map(
        (a) =>
          a.doctorId
            ?.userId
            ?.name
      )
    ),
  ].filter(Boolean);

const filteredAppointments = useMemo(() => {
  const keyword = search.toLowerCase();

  return appointments.filter((appointment) => {

    const patientName =
      appointment.patientId?.name?.toLowerCase() || "";

    const doctorName =
      appointment.doctorId?.userId?.name?.toLowerCase() || "";

    const matchesSearch =
      patientName.includes(keyword) ||
      doctorName.includes(keyword);

    const matchesStatus =
      statusFilter === "all"
        ? true
        : appointment.status === statusFilter;
    const matchesDoctor =
  doctorFilter === "all"
    ? true
    : doctorName ===
      doctorFilter
        .toLowerCase();

    const today =
  new Date();

today.setHours(
  0,
  0,
  0,
  0
);

const appointmentDate =
  new Date(
    appointment.date
  );

appointmentDate.setHours(
  0,
  0,
  0,
  0
);

const matchesDate =

  dateFilter === "all"

    ? true

    : dateFilter === "today"

    ? appointmentDate.getTime() ===
      today.getTime()

    : dateFilter === "upcoming"

    ? appointmentDate >= today

    : appointmentDate < today;

    return (
    matchesSearch &&
    matchesStatus &&
    matchesDoctor &&    
    matchesDate
    );
  });
}, [appointments, search, statusFilter]);


const updateStatus = async (
  appointment,
  status
) => {

  try {

    await appointmentApi.updateAppointmentStatus(
      appointment._id,
      { status }
    );

    toast.success(
      `Appointment ${status}`
    );

    await loadAppointments();

  } catch (error) {

    toast.error(
      getApiErrorMessage(error)
    );
  }
};

useEffect(() => {
  loadAppointments();
}, []);

if (loading) {
  return (
    <Loader
      label="Loading appointments..."
    />
  );
}

return (
  <div className="space-y-6">

    {/* Header */}

    <div className="flex items-center justify-between">

      <div>

        <p className="text-blue-600 font-black uppercase">
          Appointments
        </p>

        <h1 className="text-3xl font-black">
          Appointment Management
        </h1>

      </div>

      <Button
        onClick={loadAppointments}
      >
        Refresh
      </Button>

    </div>

    {/* Analytics */}

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">

      <Card>
        <p className="text-slate-500">
          Total
        </p>

        <h2 className="text-4xl font-black">
          {analytics.total}
        </h2>
      </Card>

      <Card>
        <p className="text-slate-500">
          Pending
        </p>

        <h2 className="text-4xl font-black text-amber-500">
          {analytics.pending}
        </h2>
      </Card>

      <Card>
        <p className="text-slate-500">
          Approved
        </p>

        <h2 className="text-4xl font-black text-blue-600">
          {analytics.approved}
        </h2>
      </Card>

      <Card>
        <p className="text-slate-500">
          Completed
        </p>

        <h2 className="text-4xl font-black text-green-600">
          {analytics.completed}
        </h2>
      </Card>

      <Card>
        <p className="text-slate-500">
          Cancelled
        </p>

        <h2 className="text-4xl font-black text-red-600">
          {analytics.cancelled}
        </h2>
      </Card>



      <Card>

        <p className="text-slate-500">
            Estimated Revenue
        </p>

        <h2 className="text-4xl font-black text-emerald-600">

            ₹
            {
            appointments.filter(
                (a) =>
                a.paymentStatus ===
                "paid"
            ).length * 1500
            }

        </h2>

        </Card>

        <Card title="Recent Activity">

  <div className="space-y-3">

    {appointments
      .slice(0, 5)
      .map(
        (appointment) => (

          <div
            key={
              appointment._id
            }
            className="rounded-xl border p-3"
          >

            <p className="font-bold">

              {
                appointment
                  .patientId
                  ?.name
              }

            </p>

            <p className="text-sm text-slate-500">

              {
                appointment.status
              }

              {" • "}

              {
                new Date(
                  appointment.createdAt
                ).toLocaleString()
              }

            </p>

          </div>

        )
      )}

  </div>

</Card>

<Card>

  <p className="text-slate-500">
    Completion Rate
  </p>

  <h2 className="text-4xl font-black text-indigo-600">
    {completionRate}%
  </h2>

</Card>

    </div>

    {/* Filters */}

    <Card>

      <div className="flex flex-col gap-4 md:flex-row">

        <div className="flex-1">

          <Input
            placeholder="Search patient or doctor..."
            value={search}
            onChange={(e) =>
              setSearch(
                e.target.value
              )
            }
          />

        </div>

        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(
              e.target.value
            )
          }
          className="rounded-xl border p-3"
        >

          <option value="all">
            All Status
          </option>

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

        <select
            value={doctorFilter}
            onChange={(e) =>
                setDoctorFilter(
                e.target.value
                )
            }
            className="rounded-xl border p-3"
            >

            <option value="all">
                All Doctors
            </option>

            {doctors.map(
                (doctor) => (
                <option
                    key={doctor}
                    value={doctor}
                >
                    {doctor}
                </option>
                )
            )}

        </select>

        <select
            value={dateFilter}
            onChange={(e) =>
                setDateFilter(
                e.target.value
                )
            }
            className="rounded-xl border p-3"
            >

            <option value="all">
                All Dates
            </option>

            <option value="today">
                Today
            </option>

            <option value="upcoming">
                Upcoming
            </option>

            <option value="past">
                Past
            </option>

        </select>

      </div>

    </Card>

    <Card>

  <div className="overflow-x-auto">

    <table className="w-full">

      <thead>

        <tr className="border-b">

          <th className="p-3 text-left">
            Patient
          </th>

          <th className="p-3 text-left">
            Doctor
          </th>

          <th className="p-3 text-left">
            Date
          </th>

          <th className="p-3 text-left">
            Slot
          </th>

          <th className="p-3 text-left">
            Status
          </th>

          <th className="p-3 text-left">
            Payment
          </th>

          <th className="p-3 text-left">
            Actions
          </th>

        </tr>

      </thead>

      <tbody>

        {filteredAppointments.length === 0 && (
        <tr>
            <td
            colSpan="7"
            className="p-8 text-center text-slate-500"
            >
            No appointments found
            </td>
        </tr>
        )}

        {filteredAppointments.map(
          (appointment) => (

            <tr
              key={
                appointment._id
              }
              className="border-b"
            >

              <td className="p-3">

                {
                  appointment
                    .patientId
                    ?.name
                }

              </td>

              <td className="p-3">

                {
                  appointment
                    .doctorId
                    ?.userId
                    ?.name ||

                  "Doctor Removed"
                }

              </td>

              <td className="p-3">

                {new Date(
                  appointment.date
                ).toLocaleDateString()}

              </td>

              <td className="p-3">

                {
                  appointment.timeSlot
                }

              </td>

              <td className="p-3">

                <span
                    className={`rounded-full px-3 py-1 text-xs font-bold text-white
                    ${
                        appointment.status === "pending"
                        ? "bg-amber-500"
                        : appointment.status === "approved"
                        ? "bg-blue-600"
                        : appointment.status === "completed"
                        ? "bg-green-600"
                        : "bg-red-600"
                    }`}
                    >
                    {appointment.status}
                    </span>

              </td>

              <td className="p-3">

                {
                  appointment.paymentStatus
                }

              </td>

              <td className="p-3">

                <div className="flex gap-2">

                  <div className="flex flex-wrap gap-2">

                        <div className="flex flex-wrap gap-2">

                            <Button
                                variant="secondary"
                                onClick={() =>
                                setSelectedAppointment(
                                    appointment
                                )
                                }
                            >
                                View
                            </Button>

                            {appointment.status ===
                                "pending" && (
                                <Button
                                onClick={() =>
                                    updateStatus(
                                    appointment,
                                    "approved"
                                    )
                                }
                                >
                                Approve
                                </Button>
                            )}

                            {appointment.status ===
                                "approved" && (
                                <Button
                                onClick={() =>
                                    updateStatus(
                                    appointment,
                                    "completed"
                                    )
                                }
                                >
                                Complete
                                </Button>
                            )}

                            {(appointment.status ===
                                "pending" ||
                                appointment.status ===
                                "approved") && (
                                <Button
                                variant="secondary"
                                onClick={() =>
                                    updateStatus(
                                    appointment,
                                    "cancelled"
                                    )
                                }
                                >
                                Cancel
                                </Button>
                            )}

                            </div>

                        {appointment.status ===
                            "pending" && (
                            <Button
                            onClick={() =>
                                updateStatus(
                                appointment,
                                "approved"
                                )
                            }
                            >
                            Approve
                            </Button>
                        )}

                        {appointment.status ===
                            "approved" && (
                            <Button
                            onClick={() =>
                                updateStatus(
                                appointment,
                                "completed"
                                )
                            }
                            >
                            Complete
                            </Button>
                        )}

                        {(appointment.status ===
                            "pending" ||
                            appointment.status ===
                            "approved") && (
                            <Button
                            variant="secondary"
                            onClick={() =>
                                updateStatus(
                                appointment,
                                "cancelled"
                                )
                            }
                            >
                            Cancel
                            </Button>
                        )}

                        </div>

                </div>

              </td>

            </tr>

          )
        )}

      </tbody>

    </table>

  </div>

</Card>



<Modal
  isOpen={
    !!selectedAppointment
  }
  title="Appointment Details"
  onClose={() =>
    setSelectedAppointment(
      null
    )
  }
>

  {selectedAppointment && (

    <div className="space-y-4">

      <p>
        <strong>
          Patient:
        </strong>{" "}
        {
          selectedAppointment
            .patientId
            ?.name
        }
      </p>

      <p>
        <strong>
          Doctor:
        </strong>{" "}
        {
          selectedAppointment
            .doctorId
            ?.userId
            ?.name ||

          "Doctor Removed"
        }
      </p>

      <p>
        <strong>
          Date:
        </strong>{" "}
        {
          new Date(
            selectedAppointment.date
          ).toLocaleDateString()
        }
      </p>

      <p>
        <strong>
          Time:
        </strong>{" "}
        {
          selectedAppointment.timeSlot
        }
      </p>

      <p>
        <strong>
          Status:
        </strong>{" "}
        {
          selectedAppointment.status
        }
      </p>

      <p>
        <strong>
          Notes:
        </strong>{" "}
        {
          selectedAppointment.notes ||
          "No Notes"
        }
      </p>

      <p>
        <strong>
            Payment:
        </strong>{" "}
        {
            selectedAppointment
            .paymentStatus
        }
        </p>

        <p>
        <strong>
            Created:
        </strong>{" "}
        {
            new Date(
            selectedAppointment.createdAt
            ).toLocaleString()
        }
        </p>

    </div>

  )}

</Modal>

<div className="flex flex-wrap gap-2 pt-4">

  <Button
    onClick={() =>
      updateStatus(
        selectedAppointment,
        "approved"
      )
    }
  >
    Approve
  </Button>

  <Button
    onClick={() =>
      updateStatus(
        selectedAppointment,
        "completed"
      )
    }
  >
    Complete
  </Button>

  <Button
    variant="secondary"
    onClick={() =>
      updateStatus(
        selectedAppointment,
        "cancelled"
      )
    }
  >
    Cancel
  </Button>

</div>

  </div>
  );
}

export default AdminAppointments;