import { CalendarDays, FileHeart, Stethoscope, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { doctorApi } from "../../api/doctorApi";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";

const initialBooking = {
  doctorId: "",
  date: "",
  timeSlot: "",
  notes: "",
  familyMemberId: "",
};

const statusClass = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

function dayOfWeek(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00Z`)
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    .toLowerCase();
}

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PatientDashboard() {
  const [doctors, setDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [booking, setBooking] = useState(initialBooking);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
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
      const familyResponse = await patientWorkflowApi.getFamily().catch(() => ({ data: { familyMembers: [] } }));
      setDoctors(doctorResponse.data.doctors || []);
      setAppointments(appointmentResponse.data.appointments || []);
      setFamilyMembers(familyResponse.data.familyMembers || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [dashboardSyncTick]);

  const selectedDoctor = useMemo(
    () => doctors.find((doctor) => doctor._id === booking.doctorId),
    [doctors, booking.doctorId],
  );

  const availableSlots = useMemo(() => {
    if (!selectedDoctor || !booking.date) return [];
    const slotDay = dayOfWeek(booking.date);
    return (
      selectedDoctor.availability.find((availability) => availability.dayOfWeek === slotDay)
        ?.timeSlots || []
    );
  }, [selectedDoctor, booking.date]);

  const updateBooking = (event) => {
    const { name, value } = event.target;
    setBooking((current) => ({
      ...current,
      [name]: value,
      ...(name === "doctorId" || name === "date" ? { timeSlot: "" } : {}),
    }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const validateBooking = () => {
    const nextErrors = {};

    if (!booking.doctorId) nextErrors.doctorId = "Select a doctor";
    if (!booking.date) nextErrors.date = "Select an appointment date";
    if (!booking.timeSlot) nextErrors.timeSlot = "Select an available time slot";

    return nextErrors;
  };

  const submitBooking = async (event) => {
    event.preventDefault();
    const validationErrors = validateBooking();

    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);

    try {
      await appointmentApi.createAppointment(booking);
      toast.success("Appointment booked successfully");
      setBooking(initialBooking);
      await loadDashboard();
    } catch (bookingError) {
      toast.error(getApiErrorMessage(bookingError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const upcomingAppointment = appointments.find((item) =>
    ["pending", "approved"].includes(item.status),
  );

  const canPay = (appointment) =>
    appointment.status === "approved" &&
    appointment.paymentStatus !== "paid";

  if (isLoading) return <Loader label="Loading patient dashboard" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Patient Dashboard</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Personal care overview</h1>
          <p className="mt-2 text-sm text-slate-600">Book visits and track appointment status from real HMS APIs.</p>
        </div>
        <Button onClick={loadDashboard}>Refresh</Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {[
          { label: "My Bookings", value: appointments.length, icon: CalendarDays },
          { label: "Available Doctors", value: doctors.length, icon: Stethoscope },
          { label: "Next Status", value: upcomingAppointment?.status || "None", icon: WalletCards },
        ].map((item) => (
          <Card key={item.label}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/25">
              <item.icon size={22} />
            </div>
            <p className="mt-5 text-sm font-bold text-slate-500">{item.label}</p>
            <p className="mt-2 text-xl font-black capitalize text-slate-950">{item.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card title="Book Appointment">
          <form className="grid gap-4" onSubmit={submitBooking}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Doctor</span>
              <select
                name="doctorId"
                value={booking.doctorId}
                onChange={updateBooking}
                className={`w-full rounded-xl border bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10 ${
                  errors.doctorId ? "border-red-500" : "border-slate-200"
                }`}
              >
                <option value="">Select doctor</option>
                {doctors.map((doctor) => (
                  <option key={doctor._id} value={doctor._id}>
                    Dr. {doctor.userId?.name} - {doctor.specialization} (${doctor.fees})
                  </option>
                ))}
              </select>
              {errors.doctorId && <span className="mt-2 block text-xs font-medium text-red-600">{errors.doctorId}</span>}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Booking for</span>
              <select
                name="familyMemberId"
                value={booking.familyMemberId}
                onChange={updateBooking}
                className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
              >
                <option value="">Myself</option>
                {familyMembers.map((member) => (
                  <option key={member._id} value={member._id}>
                    {member.name} ({member.relation})
                  </option>
                ))}
              </select>
            </label>

            <Input
              label="Date"
              name="date"
              type="date"
              value={booking.date}
              onChange={updateBooking}
              error={errors.date}
            />

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Time slot</span>
              <select
                name="timeSlot"
                value={booking.timeSlot}
                onChange={updateBooking}
                disabled={!availableSlots.length}
                className={`w-full rounded-xl border bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10 ${
                  errors.timeSlot ? "border-red-500" : "border-slate-200"
                }`}
              >
                <option value="">{availableSlots.length ? "Select slot" : "No slots for selected date"}</option>
                {availableSlots.map((slot) => (
                  <option key={slot} value={slot}>{slot}</option>
                ))}
              </select>
              {errors.timeSlot && <span className="mt-2 block text-xs font-medium text-red-600">{errors.timeSlot}</span>}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Notes</span>
              <textarea
                name="notes"
                value={booking.notes}
                onChange={updateBooking}
                className="min-h-24 w-full resize-none rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                placeholder="Briefly describe your concern"
              />
            </label>

            <Button type="submit" isLoading={isSubmitting} disabled={!doctors.length}>
              Book Appointment
            </Button>
          </form>
        </Card>

        <Card title="My Appointments">
          {appointments.length ? (
            <div className="space-y-3">
              {appointments.map((appointment) => (
                <div key={appointment._id} className="flex flex-col justify-between gap-3 rounded-2xl bg-white/60 p-4 shadow-lg sm:flex-row sm:items-center">
                  <div className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
                      <FileHeart size={18} />
                    </div>
                    <div>
                      <p className="font-black text-slate-950">Dr. {appointment.doctorId?.userId?.name || "Doctor"}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {formatDate(appointment.date)} at {appointment.timeSlot}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-xl px-3 py-2 text-xs font-black capitalize ${statusClass[appointment.status]}`}>
                      {appointment.status}
                    </span>
                    {canPay(appointment) && (
                      <Link
                        to={`/patient/payments/${appointment._id}`}
                        className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white shadow-lg transition hover:bg-blue-700"
                      >
                        Pay Now
                      </Link>
                    )}
                    {appointment.paymentStatus === "paid" && (
                      <span className="rounded-xl bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-700">
                        Paid
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No bookings yet" description="Select an available doctor and time slot to create your first booking." />
          )}
        </Card>
      </div>
    </div>
  );
}

export default PatientDashboard;
