import {
  Calendar,
  Search,
  Star,
  Stethoscope,
  Bookmark,
  Filter,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { doctorApi } from "../../api/doctorApi";
import { appointmentApi } from "../../api/appointmentApi";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import Modal from "../../components/ui/Modal";

import { useToast } from "../../context/ToastContext";

function PatientDoctorsDirectory() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);

  const [doctors, setDoctors] = useState([]);
  const [savedDoctors, setSavedDoctors] = useState([]);

  const [search, setSearch] = useState("");
  const [specialization, setSpecialization] = useState("");

  const [selectedDoctor, setSelectedDoctor] = useState(null);

  const [bookingForm, setBookingForm] = useState({
    date: "",
    timeSlot: "",
  });

  const [bookingLoading, setBookingLoading] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);

      const [doctorRes, savedRes] = await Promise.all([
        doctorApi.getDoctors({ limit: 100 }),
        patientWorkflowApi.getSavedDoctors(),
      ]);

      setDoctors(doctorRes?.data?.doctors || []);
      setSavedDoctors(savedRes?.data?.savedDoctors || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const savedIds = useMemo(() => {
    return new Set(
      savedDoctors.map((item) => item?.doctorId?._id)
    );
  }, [savedDoctors]);

  const filteredDoctors = useMemo(() => {
    return doctors.filter((doctor) => {
      const doctorName =
        doctor?.userId?.name?.toLowerCase() || "";

      const doctorSpecialization =
        doctor?.specialization?.toLowerCase() || "";

      const matchesSearch =
        doctorName.includes(search.toLowerCase());

      const matchesSpecialization =
        specialization === ""
          ? true
          : doctorSpecialization.includes(
              specialization.toLowerCase()
            );

      return matchesSearch && matchesSpecialization;
    });
  }, [doctors, search, specialization]);

  const toggleSaveDoctor = async (doctorId) => {
    try {
      if (savedIds.has(doctorId)) {
        await patientWorkflowApi.removeSavedDoctor(
          doctorId
        );

        toast.success("Doctor removed");
      } else {
        await patientWorkflowApi.saveDoctor({
          doctorId,
        });

        toast.success("Doctor saved");
      }

      await loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const createAppointment = async (e) => {
    e.preventDefault();

    if (!selectedDoctor) return;

    try {
      setBookingLoading(true);

      await appointmentApi.createAppointment({
        doctorId: selectedDoctor._id,
        date: bookingForm.date,
        timeSlot: bookingForm.timeSlot,
      });

      toast.success(
        "Appointment request submitted"
      );

      setSelectedDoctor(null);

      setBookingForm({
        date: "",
        timeSlot: "",
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBookingLoading(false);
    }
  };

  if (loading) {
    return (
      <Loader label="Loading doctors directory" />
    );
  }

  return (
    <div className="space-y-6">

      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">
          Doctors Directory
        </p>

        <h1 className="mt-2 text-3xl font-black text-slate-950">
          Find & Book Doctors
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Search doctors, save favourites and
          book appointments.
        </p>
      </div>

      <Card>

        <div className="grid gap-4 md:grid-cols-2">

          <Input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="Search doctor name..."
          />

          <Input
            value={specialization}
            onChange={(e) =>
              setSpecialization(
                e.target.value
              )
            }
            placeholder="Filter specialization..."
          />

        </div>

      </Card>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">

        {filteredDoctors.map((doctor) => (

          <Card key={doctor._id}>

            <div className="flex items-start justify-between">

              <div>

                <div className="flex items-center gap-2">

                  <Stethoscope
                    size={18}
                    className="text-blue-600"
                  />

                  <h3 className="font-black text-slate-950">
                    Dr. {doctor.userId?.name}
                  </h3>

                </div>

                <p className="mt-2 text-sm text-slate-500">
                  {doctor.specialization}
                </p>

                <p className="mt-2 text-sm">
                  Experience:
                  {" "}
                  <strong>
                    {doctor.experience} Years
                  </strong>
                </p>

                <p className="mt-1 text-sm">
                  Consultation Fee:
                  {" "}
                  <strong>
                    ₹{doctor.fees}
                  </strong>
                </p>

                <div className="mt-3 flex items-center gap-1 text-amber-500">

                  <Star
                    size={16}
                    fill="currentColor"
                  />

                  <span className="font-bold">
                    {doctor.rating}
                  </span>

                </div>

              </div>

              <Button
                variant={
                  savedIds.has(doctor._id)
                    ? "primary"
                    : "secondary"
                }
                onClick={() =>
                  toggleSaveDoctor(
                    doctor._id
                  )
                }
              >
                <Bookmark size={16} />
              </Button>

            </div>

            <div className="mt-4">

              <p className="mb-2 text-xs font-bold uppercase text-slate-500">
                Availability
              </p>

              <div className="space-y-2">

                {doctor.availability?.map(
                  (slot, index) => (
                    <div
                      key={index}
                      className="rounded-xl bg-slate-100 p-2 text-sm"
                    >
                      <strong>
                        {slot.dayOfWeek}
                      </strong>

                      {" - "}

                      {slot.timeSlots?.join(
                        ", "
                      )}
                    </div>
                  )
                )}

              </div>

            </div>

            <Button
              className="mt-5 w-full"
              onClick={() =>
                setSelectedDoctor(
                  doctor
                )
              }
            >
              <Calendar size={16} />
              Book Appointment
            </Button>

          </Card>
        ))}

      </div>

      <Modal
        isOpen={!!selectedDoctor}
        title={
          selectedDoctor
            ? `Book Dr. ${selectedDoctor.userId?.name}`
            : ""
        }
        onClose={() =>
          setSelectedDoctor(null)
        }
      >

        <form
          onSubmit={
            createAppointment
          }
          className="space-y-4"
        >

          <Input
            type="date"
            required
            value={bookingForm.date}
            onChange={(e) =>
              setBookingForm({
                ...bookingForm,
                date: e.target.value,
              })
            }
          />

          <Input
            placeholder="09:00-01:00"
            required
            value={
              bookingForm.timeSlot
            }
            onChange={(e) =>
              setBookingForm({
                ...bookingForm,
                timeSlot:
                  e.target.value,
              })
            }
          />

          <Button
            type="submit"
            className="w-full"
            isLoading={
              bookingLoading
            }
          >
            Confirm Appointment
          </Button>

        </form>

      </Modal>

    </div>
  );
}

export default PatientDoctorsDirectory;