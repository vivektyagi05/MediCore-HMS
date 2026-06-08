import {
  Plus,
  Trash2,
  Stethoscope,
  Star,
  Users,
  Clock,
  ShieldCheck,
  CheckCircle,
  XCircle,
  Eye,
  FileText,
} from "lucide-react";

import { useEffect, useState } from "react";

import { doctorApi } from "../../api/doctorApi";
import { getApiErrorMessage } from "../../api/axios";

import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Modal from "../../components/ui/Modal";
import Loader from "../../components/ui/Loader";

import { useToast } from "../../context/ToastContext";

const initialForm = {
  userId: "",
  specialization: "",
  experience: 0,
  fees: 0,
};

function AdminDoctors() {
  const toast = useToast();

  const [doctors, setDoctors] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [showModal, setShowModal] =
    useState(false);

  const [editing, setEditing] =
    useState(null);

  const [form, setForm] =
    useState(initialForm);

const [pendingDoctors, setPendingDoctors] =
  useState([]);

const [selectedDoctor, setSelectedDoctor] =
  useState(null);

const [showProfileModal, setShowProfileModal] =
  useState(false);

const [showDocumentsModal, setShowDocumentsModal] =
  useState(false);

const [showRejectModal, setShowRejectModal] =
  useState(false);

const [rejectReason, setRejectReason] =
  useState("");

const [search, setSearch] =
  useState("");

  const loadData = async () => {
    try {
      setLoading(true);

      const [
        doctorRes,
        pendingRes,
        ] = await Promise.all([
        doctorApi.getDoctors({
            limit: 100,
        }),
        doctorApi.getPendingDoctors(),
        ]);

        setDoctors(
        doctorRes?.data?.doctors || []
        );

        setPendingDoctors(
        pendingRes?.data || []
        );
    } catch (error) {
      toast.error(
        getApiErrorMessage(error)
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
        <Loader label="Loading doctors..." />
    );
    }

  const openCreate = () => {
    setEditing(null);
    setForm(initialForm);
    setShowModal(true);
  };

  const openEdit = (doctor) => {
    setEditing(doctor);

    setForm({
      userId:
        doctor.userId?._id || "",
      specialization:
        doctor.specialization || "",
      experience:
        doctor.experience || 0,
      fees:
        doctor.fees || 0,
    });

    setShowModal(true);
  };

  const saveDoctor = async (e) => {
    e.preventDefault();

    try {
      if (editing) {
        await doctorApi.updateDoctor(
          editing._id,
          form
        );

        toast.success(
          "Doctor updated"
        );
      } else {
        await doctorApi.createDoctor(
          form
        );

        toast.success(
          "Doctor created"
        );
      }

      setShowModal(false);

      await loadData();
    } catch (error) {
      toast.error(
        getApiErrorMessage(error)
      );
    }
  };

  const deleteDoctor = async (
    doctor
  ) => {
    if (
      !window.confirm(
        "Delete doctor?"
      )
    )
      return;

    try {
      await doctorApi.deleteDoctor(
        doctor._id
      );

      toast.success(
        "Doctor deleted"
      );

      await loadData();
    } catch (error) {
      toast.error(
        getApiErrorMessage(error)
      );
    }
  };
const approveDoctor = async (
  doctorId
) => {

  try {

    await doctorApi.approveDoctor(
      doctorId
    );

    toast.success(
      "Doctor Approved Successfully"
    );

    await loadData();

  } catch (error) {

    toast.error(
      getApiErrorMessage(error)
    );

  }
};

const rejectDoctor = async () => {

  if(!rejectReason.trim()){

      toast.error(
        "Rejection reason required"
      );

      return;
    }

  try {

    if (!selectedDoctor)
      return;

    await doctorApi.rejectDoctor(
      selectedDoctor._id,
      rejectReason
    );

    toast.success(
      "Doctor Rejected"
    );

    setShowRejectModal(false);

    setRejectReason("");

    setSelectedDoctor(null);

    await loadData();

  } catch (error) {

    toast.error(
      getApiErrorMessage(error)
    );

  }
};


  return (
    <div className="space-y-6">

      <div className="flex justify-between items-center">

        <div className="grid gap-4 md:grid-cols-4">

        <Card>

          <div className="flex justify-between">

            <div>
              <p className="text-slate-500">
                Total Doctors
              </p>

              <h2 className="text-3xl font-black">
                {doctors.length}
              </h2>
            </div>

            <Users size={32} />
          </div>

        </Card>

        <Card>

          <div className="flex justify-between">

            <div>
              <p className="text-slate-500">
                Pending Verification
              </p>

              <h2 className="text-3xl font-black text-amber-600">
                {pendingDoctors.length}
              </h2>
            </div>

            <Clock
              size={32}
              className="text-amber-500"
            />

          </div>

        </Card>

        <Card>

          <div className="flex justify-between">

            <div>
              <p className="text-slate-500">
                Approved
              </p>

              <h2 className="text-3xl font-black text-green-600">

                {
                  doctors.filter(
                    (d) =>
                      d.verificationStatus ===
                      "approved"
                  ).length
                }

              </h2>

            </div>

            <ShieldCheck
              size={32}
              className="text-green-600"
            />

          </div>

        </Card>

        <Card>

          <div className="flex justify-between">

            <div>

              <p className="text-slate-500">
                Rejected
              </p>

              <h2 className="text-3xl font-black text-red-600">

                {
                  doctors.filter(
                    (d) =>
                      d.verificationStatus ===
                      "rejected"
                  ).length
                }

              </h2>

            </div>

            <XCircle
              size={32}
              className="text-red-600"
            />

          </div>

        </Card>

      </div>

        <div>
          <p className="text-blue-600 font-black uppercase">
            Doctors
          </p>

          <h1 className="text-3xl font-black">
            Doctor Management
          </h1>
        </div>

        <Button
          onClick={openCreate}
        >
          <Plus size={18} />
          Add Doctor
        </Button>
      </div>

      <Card>

        <Input
          placeholder="Search doctor by name, email, specialization..."
          value={search}
          onChange={(e) =>
            setSearch(
              e.target.value
            )
          }
        />

      </Card>

      <Card title="Pending Verification Requests">

        <div className="space-y-4">

          {
            pendingDoctors
              .filter((doctor) => {

                const text = `
                  ${doctor.userId?.name}
                  ${doctor.userId?.email}
                  ${doctor.specialization}
                  ${doctor.qualification}
                `.toLowerCase();

                return text.includes(
                  search.toLowerCase()
                );

              })
              .map(
              (doctor) => (

                <div
                  key={doctor._id}
                  className="rounded-xl border p-4 flex flex-col lg:flex-row justify-between gap-4"
                >

                  <div>

                    <div className="flex items-center gap-2">

                      <h3 className="font-black text-lg">
                        Dr. {doctor.userId?.name}
                      </h3>

                      <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                        Pending
                      </span>

                    </div>

                    <p>
                      {doctor.specialization}
                    </p>

                    <p>
                      {doctor.qualification}
                    </p>

                    <p>
                      Experience:
                      {doctor.experience} years
                    </p>

                    <p>
                      Documents:
                      {
                        doctor.documents
                          ?.length || 0
                      }
                    </p>

                    <div className="mt-2 flex gap-2 flex-wrap">

                      <span
                        className="
                          px-2 py-1
                          rounded-full
                          bg-blue-100
                          text-blue-700
                          text-xs
                          font-bold
                        "
                      >
                        {
                          doctor.documents?.length || 0
                        } Documents
                      </span>

                      <span
                        className="
                          px-2 py-1
                          rounded-full
                          bg-green-100
                          text-green-700
                          text-xs
                          font-bold
                        "
                      >
                        {
                          doctor.documents?.filter(
                            (doc) =>
                              doc.status ===
                              "verified"
                          ).length
                        } Verified
                      </span>

                      <span
                        className="
                          px-2 py-1
                          rounded-full
                          bg-amber-100
                          text-amber-700
                          text-xs
                          font-bold
                        "
                      >
                        {
                          doctor.documents?.filter(
                            (doc) =>
                              doc.status ===
                              "pending"
                          ).length
                        } Pending
                      </span>

                    </div>

                    <div className="mt-4">

                  <div className="flex justify-between text-sm font-semibold">

                    <span>
                      Verification Score
                    </span>

                    <span>

                      {
                        Math.min(
                          100,

                          (
                            (
                              doctor.documents
                                ?.length || 0
                            ) * 25
                          )
                        )
                      }%

                    </span>

                  </div>

                  <div
                    className="
                      mt-2
                      h-3
                      rounded-full
                      bg-slate-200
                      overflow-hidden
                    "
                  >

                    <div
                      className="
                        h-full
                        bg-green-500
                      "
                      style={{
                        width: `${
                          Math.min(
                            100,

                            (
                              (
                                doctor.documents
                                  ?.length || 0
                              ) * 25
                            )
                          )
                        }%`
                      }}
                    />

                  </div>

                </div>

                  </div>

                  <div className="flex gap-2 flex-wrap">

                    <Button
                      variant="secondary"
                      onClick={() => {

                        setSelectedDoctor(
                          doctor
                        );

                        setShowProfileModal(
                          true
                        );

                      }}
                    >
                      <Eye size={16} />
                      Profile
                    </Button>

                      <Button
                        variant="secondary"
                        onClick={() => {

                          setSelectedDoctor(
                            doctor
                          );

                          setShowDocumentsModal(
                            true
                          );

                        }}
                      >
                        <FileText size={16} />
                        Documents
                      </Button>

                      <Button
                        onClick={() =>
                          approveDoctor(
                            doctor._id
                          )
                        }
                      >
                        <CheckCircle size={16} />
                        Approve
                      </Button>

                      <Button
                        variant="secondary"
                        onClick={() => {

                          setSelectedDoctor(
                            doctor
                          );

                          setShowRejectModal(
                            true
                          );

                        }}
                      >
                        Reject
                      </Button>

                  </div>



                </div>
              )
            )
          }

        </div>

      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">

        

        {
          doctors
          .filter((doctor) => {

            const text = `
              ${doctor.userId?.name}
              ${doctor.userId?.email}
              ${doctor.specialization}
            `.toLowerCase();

            return text.includes(
              search.toLowerCase()
            );

          })
          .map((doctor) => (
          <Card key={doctor._id}>

            <div className="flex justify-between">

              <div className="mt-2">

                  {
                    doctor.verificationStatus ===
                    "approved" && (

                      <span
                        className="
                          px-3 py-1
                          rounded-full
                          bg-green-100
                          text-green-700
                          text-xs
                          font-bold
                        "
                      >
                        Approved
                      </span>

                    )
                  }

                  {
                    doctor.verificationStatus ===
                    "pending" && (

                      <span
                        className="
                          px-3 py-1
                          rounded-full
                          bg-amber-100
                          text-amber-700
                          text-xs
                          font-bold
                        "
                      >
                        Pending
                      </span>

                    )
                  }

                  {
                    doctor.verificationStatus ===
                    "rejected" && (

                      <span
                        className="
                          px-3 py-1
                          rounded-full
                          bg-red-100
                          text-red-700
                          text-xs
                          font-bold
                        "
                      >
                        Rejected
                      </span>

                    )
                  }

                </div>

              <div>

                <p className="text-lg font-black">
                  Dr.
                  {
                    doctor.userId
                      ?.name
                  }
                </p>

                <p className="text-slate-500">
                  {
                    doctor.specialization
                  }
                </p>

                <p className="mt-2">
                  Experience:
                  {
                    doctor.experience
                  } years
                </p>

                <p>
                  Fees: ₹
                  {doctor.fees}
                </p>

                <p className="flex gap-1 items-center mt-2 text-amber-500 font-bold">
                  <Star
                    size={16}
                    fill="currentColor"
                  />
                  {doctor.rating}
                </p>
              </div>

              <Stethoscope />
            </div>

            <div className="flex gap-2 mt-4">

              <Button
                variant="secondary"
                onClick={() =>
                  openEdit(
                    doctor
                  )
                }
              >
                Edit
              </Button>

              <Button
                variant="secondary"
                onClick={() =>
                  deleteDoctor(
                    doctor
                  )
                }
              >
                <Trash2
                  size={16}
                />
              </Button>
            </div>

          </Card>
        ))}
      </div>

      <Modal
        isOpen={showModal}
        title={
          editing
            ? "Edit Doctor"
            : "Add Doctor"
        }
        onClose={() =>
          setShowModal(false)
        }
      >
        <form
          onSubmit={saveDoctor}
          className="space-y-4"
        >
          {!editing && (
            <select
              className="w-full rounded-xl border p-3"
              value={form.userId}
              onChange={(e) =>
                setForm({
                  ...form,
                  userId:
                    e.target
                      .value,
                })
              }
            >
              <option value="">
                Select Doctor User
              </option>

              {doctors.map(
                (doctor) => (
                  <option
                    key={
                      doctor._id
                    }
                    value={
                      doctor._id
                    }
                  >
                    {doctor.userId.name}
                  </option>
                )
              )}
            </select>
          )}

          <Input
            label="Specialization"
            value={
              form.specialization
            }
            onChange={(e) =>
              setForm({
                ...form,
                specialization:
                  e.target
                    .value,
              })
            }
          />

          <Input
            type="number"
            label="Experience"
            value={
              form.experience
            }
            onChange={(e) =>
              setForm({
                ...form,
                experience:
                  e.target
                    .value,
              })
            }
          />

          <Input
            type="number"
            label="Fees"
            value={form.fees}
            onChange={(e) =>
              setForm({
                ...form,
                fees:
                  e.target
                    .value,
              })
            }
          />

          <Button type="submit">
            Save Doctor
          </Button>
        </form>
      </Modal>

<Modal
  isOpen={
    showProfileModal
  }
  title="Doctor Verification Profile"
  onClose={() =>
    setShowProfileModal(
      false
    )
  }
>

  {
    selectedDoctor && (

      <div className="space-y-4">

        <div className="rounded-xl bg-slate-50 p-4">

          <h2 className="text-xl font-black">

            Dr.
            {
              selectedDoctor
                .userId?.name
            }

          </h2>

          <p className="text-slate-500">

            {
              selectedDoctor
                .userId?.email
            }

          </p>

        </div>

        <div className="grid md:grid-cols-2 gap-3">

          <Card>

            <p className="font-bold">
              Specialization
            </p>

            <p>
              {
                selectedDoctor
                  .specialization
              }
            </p>

          </Card>

          <Card>

            <p className="font-bold">
              Qualification
            </p>

            <p>
              {
                selectedDoctor
                  .qualification
              }
            </p>

          </Card>

          <Card>

            <p className="font-bold">
              Experience
            </p>

            <p>

              {
                selectedDoctor
                  .experience
              }

              Years

            </p>

          </Card>

          <Card>

            <p className="font-bold">
              Fees
            </p>

            <p>

              ₹
              {
                selectedDoctor
                  .fees
              }

            </p>

          </Card>

        </div>

        <Card>

          <h3 className="font-black mb-3">

            Medical Verification

          </h3>

          <div className="space-y-2">

            <p>

              <strong>
                License:
              </strong>

              {" "}

              {
                selectedDoctor
                  .licenseNumber
              }

            </p>

            <p>

              <strong>
                Council:
              </strong>

              {" "}

              {
                selectedDoctor
                  .medicalCouncil
              }

            </p>

            <p>

              <strong>
                Hospital:
              </strong>

              {" "}

              {
                selectedDoctor
                  .hospitalName
              }

            </p>

          </div>

        </Card>

        <Card>

          <h3 className="font-black mb-3">

            Location

          </h3>

          <p>

            {
              selectedDoctor.city
            }

            ,

            {
              selectedDoctor.state
            }

          </p>

        </Card>

        <Card>

          <h3 className="font-black mb-3">

            Languages

          </h3>

          <div className="flex flex-wrap gap-2">

            {
              selectedDoctor
                .languages
                ?.map(
                  (
                    language
                  ) => (

                    <span
                      key={
                        language
                      }
                      className="
                        px-3
                        py-1
                        rounded-full
                        bg-blue-100
                        text-blue-700
                        text-sm
                      "
                    >

                      {
                        language
                      }

                    </span>

                  )
                )
            }

          </div>

        </Card>

        <Card>

          <h3 className="font-black mb-3">

            Doctor Bio

          </h3>

          <p>

            {
              selectedDoctor
                .bio
            }

          </p>

        </Card>

      </div>

    )
  }

</Modal>

<Modal
  isOpen={
    showDocumentsModal
  }
  title="Doctor Documents"
  onClose={() =>
    setShowDocumentsModal(
      false
    )
  }
>

  {selectedDoctor?.documents
    ?.length ? (

    <div className="space-y-3">

      {
        selectedDoctor.documents.map(
          (
            doc
          ) => (

            <div
              key={doc._id}
              className="border rounded-xl p-3"
            >

              <p className="font-bold">
                {doc.title}
              </p>

              <p>
                Type:
                {" "}
                {doc.type}
              </p>

              <p>
                Status:
                {" "}
                {doc.status}
              </p>

              <a
                href={`http://localhost:5000/${doc.filePath}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 font-semibold"
              >
                Open Document
              </a>

            </div>

          )
        )
      }

    </div>

  ) : (

    <p>
      No Documents Uploaded
    </p>

  )}

</Modal>

<Modal
  isOpen={
    showRejectModal
  }
  title="Reject Doctor"
  onClose={() =>
    setShowRejectModal(
      false
    )
  }
>

  <div className="space-y-4">

    <textarea
      rows="5"
      value={
        rejectReason
      }
      onChange={(e) =>
        setRejectReason(
          e.target.value
        )
      }
      className="w-full rounded-xl border p-3"
      placeholder="Enter rejection reason"
    />

    <Button
      className="w-full"
      onClick={
        rejectDoctor
      }
    >
      Reject Doctor
    </Button>

  </div>

</Modal>





    </div>
  );
}



export default AdminDoctors;