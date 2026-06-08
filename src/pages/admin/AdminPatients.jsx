import {
  Users,
  Search,
  Eye,
  Activity,
  HeartPulse,
  Phone,
  MapPin,
  Mail,
  Calendar,
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import Loader from "../../components/ui/Loader";
import Input from "../../components/ui/Input";

import { useToast } from "../../context/ToastContext";

function AdminPatients() {
  const toast = useToast();

  const [patients, setPatients] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [search, setSearch] =
    useState("");

   const [statusFilter,
  setStatusFilter] =
  useState("all");

  const [bloodFilter,
  setBloodFilter] =
  useState("all");

  const [viewMode,
  setViewMode] =
  useState("grid");

  const [selectedPatient,
    setSelectedPatient] =
    useState(null);

    const [showEditModal,
  setShowEditModal] =
  useState(false);

const [editForm,
  setEditForm] =
  useState({
    name: "",
    email: "",
    bloodGroup: "",
    address: "",
    emergencyName: "",
    emergencyPhone: "",
  });

    const deletePatient =
  async (patientId) => {

    if (
      !window.confirm(
        "Delete patient?"
      )
    ) {
      return;
    }

    try {

      await adminApi
        .deleteUser(
          patientId
        );

      toast.success(
        "Patient deleted"
      );

      await loadPatients();

    } catch (error) {

      toast.error(
        getApiErrorMessage(
          error
        )
      );
    }
  };
  const toggleStatus =
  async (patientId) => {

    try {

      await adminApi
        .toggleUserStatus(
          patientId
        );

      toast.success(
        "Status updated"
      );

      await loadPatients();

    } catch (error) {

      toast.error(
        getApiErrorMessage(
          error
        )
      );
    }
  };

  const openEditModal =
  (patient) => {

    setEditForm({
      name:
        patient.name || "",

      email:
        patient.email || "",

      bloodGroup:
        patient.patientProfile
          ?.bloodGroup || "",

      address:
        patient.patientProfile
          ?.address || "",

      emergencyName:
        patient.patientProfile
          ?.emergencyContact
          ?.name || "",

      emergencyPhone:
        patient.patientProfile
          ?.emergencyContact
          ?.phone || "",
    });

    setSelectedPatient(
      patient
    );

    setShowEditModal(
      true
    );
  };

  const savePatient =
  async () => {

    try {

      await adminApi.updateUser(
        selectedPatient._id,
        {
          name:
            editForm.name,

          email:
            editForm.email,

          patientProfile: {

            bloodGroup:
              editForm.bloodGroup,

            address:
              editForm.address,

            emergencyContact: {

              name:
                editForm.emergencyName,

              phone:
                editForm.emergencyPhone,

            },
          },
        }
      );

      toast.success(
        "Patient updated"
      );

      setShowEditModal(
        false
      );

      await loadPatients();

    } catch (error) {

      toast.error(
        getApiErrorMessage(
          error
        )
      );
    }
  };

  const loadPatients =
    async () => {
      try {
        setLoading(true);

        const response =
          await adminApi.getUsers();

        const users =
          response?.data?.users || [];

        const patientUsers =
          users.filter(
            (user) =>
              user.role ===
              "patient"
          );

        setPatients(
          patientUsers
        );
      } catch (error) {
        toast.error(
          getApiErrorMessage(
            error
          )
        );
      } finally {
        setLoading(false);
      }
    };

  useEffect(() => {
    loadPatients();
  }, []);

  const filteredPatients =
    useMemo(() => {
      const keyword =
        search.toLowerCase();

      return patients.filter(
  (patient) => {

    const matchesSearch =
      patient.name
        ?.toLowerCase()
        .includes(keyword) ||

      patient.email
        ?.toLowerCase()
        .includes(keyword);

    const matchesStatus =

      statusFilter === "all"

        ? true

        : statusFilter === "active"

        ? patient.isActive

        : !patient.isActive;

    const patientBlood =
      patient
        ?.patientProfile
        ?.bloodGroup
        ?.toUpperCase();

    const matchesBlood =

      bloodFilter === "all"

        ? true

        : patientBlood ===
          bloodFilter;

    return (
      matchesSearch &&
      matchesStatus &&
      matchesBlood
    );
  }
);
    }, [patients, search]);

const bloodGroups =
  useMemo(() => {

    const groups =
      new Set();

    patients.forEach(
      (patient) => {

        const blood =
          patient
            ?.patientProfile
            ?.bloodGroup;

        if (blood) {
          groups.add(
            blood.toUpperCase()
          );
        }
      }
    );

    return Array.from(
      groups
    );

  }, [patients]);

  const analytics = {
    total:
      patients.length,

    active:
      patients.filter(
        (patient) =>
          patient.isActive
      ).length,

    inactive:
      patients.filter(
        (patient) =>
          !patient.isActive
      ).length,
  };

  if (loading) {
    return (
      <Loader label="Loading Patients..." />
    );
  }

  return (
    <div className="space-y-6">

      <div>
        <p className="font-black uppercase tracking-[0.18em] text-blue-600">
          Patient Management
        </p>

        <h1 className="mt-2 text-3xl font-black text-slate-950">
          Patients Center
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Manage and monitor
          all patient accounts
          from one place.
        </p>
      </div>

      {/* Analytics */}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>

          <div className="flex items-center justify-between">

            <div>
              <p className="text-sm text-slate-500">
                Total Patients
              </p>

              <h2 className="mt-2 text-4xl font-black">
                {
                  analytics.total
                }
              </h2>
            </div>

            <Users
              size={34}
            />

          </div>

        </Card>

        <Card>

          <div className="flex items-center justify-between">

            <div>
              <p className="text-sm text-slate-500">
                Active
              </p>

              <h2 className="mt-2 text-4xl font-black text-green-600">
                {
                  analytics.active
                }
              </h2>
            </div>

            <Activity
              size={34}
            />

          </div>

        </Card>

        <Card>

          <div className="flex items-center justify-between">

            <div>
              <p className="text-sm text-slate-500">
                Inactive
              </p>

              <h2 className="mt-2 text-4xl font-black text-red-600">
                {
                  analytics.inactive
                }
              </h2>
            </div>

            <HeartPulse
              size={34}
            />

          </div>

        </Card>

        <Card>

            <div className="flex items-center justify-between">

                <div>

                <p className="text-sm text-slate-500">
                    Blood Groups
                </p>

                <h2 className="mt-2 text-4xl font-black text-blue-600">
                    {bloodGroups.length}
                </h2>

                </div>

                <HeartPulse
                size={34}
                />

            </div>

            </Card>

      </div>

      {/* Search */}

      <Card>

        <div className="flex flex-col gap-3 md:flex-row">

            <div className="flex flex-1 items-center gap-3">

            <Search size={20} />

            <Input
                placeholder="Search patient..."
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
                All Patients
            </option>

            <option value="active">
                Active
            </option>

            <option value="inactive">
                Inactive
            </option>

            </select>

            <select
                value={bloodFilter}
                onChange={(e) =>
                    setBloodFilter(
                    e.target.value
                    )
                }
                className="rounded-xl border p-3"
                >

                <option value="all">
                    All Blood Groups
                </option>

                {bloodGroups.map(
                    (group) => (
                    <option
                        key={group}
                        value={group}
                    >
                        {group}
                    </option>
                    )
                )}

            </select>

            <div className="flex gap-2">

                <Button
                    variant={
                    viewMode === "grid"
                        ? "primary"
                        : "secondary"
                    }
                    onClick={() =>
                    setViewMode(
                        "grid"
                    )
                    }
                >
                    Grid
                </Button>

                <Button
                    variant={
                    viewMode === "table"
                        ? "primary"
                        : "secondary"
                    }
                    onClick={() =>
                    setViewMode(
                        "table"
                    )
                    }
                >
                    Table
                </Button>

                </div>

        </div>

        </Card>

      {/* Empty State */}

      {filteredPatients.length ===
        0 && (
        <Card>

          <div className="py-10 text-center">

            <Users
              size={48}
              className="mx-auto mb-4"
            />

            <h2 className="text-xl font-black">
              No Patients Found
            </h2>

            <p className="mt-2 text-slate-500">
              No matching
              patients are
              available.
            </p>

          </div>

        </Card>
      )}

      {viewMode === "table" && (

            <Card>

            <div className="overflow-x-auto">

                <table className="w-full">

                <thead>

                    <tr className="border-b">

                    <th className="p-3 text-left">
                        Name
                    </th>

                    <th className="p-3 text-left">
                        Email
                    </th>

                    <th className="p-3 text-left">
                        Blood
                    </th>

                    <th className="p-3 text-left">
                        Status
                    </th>

                    <th className="p-3 text-left">
                        Actions
                    </th>

                    </tr>

                </thead>

                <tbody>

                    {filteredPatients.map(
                    (patient) => (

                        <tr
                        key={
                            patient._id
                        }
                        className="border-b"
                        >

                        <td className="p-3 font-semibold">
                            {patient.name}
                        </td>

                        <td className="p-3">
                            {patient.email}
                        </td>

                        <td className="p-3">
                            {
                            patient
                                ?.patientProfile
                                ?.bloodGroup ||
                            "N/A"
                            }
                        </td>

                        <td className="p-3">

                            <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${
                                patient.isActive
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}
                            >
                            {
                                patient.isActive
                                ? "ACTIVE"
                                : "INACTIVE"
                            }
                            </span>

                        </td>

                        <td className="p-3">

                            <Button
                            onClick={() =>
                                setSelectedPatient(
                                patient
                                )
                            }
                            >
                            View
                            </Button>

                        </td>

                        </tr>

                    )
                    )}

                </tbody>

                </table>

            </div>

            </Card>

            )}

      {/* Patients Grid */}

      {viewMode === "grid" && (

<div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {filteredPatients.map(
          (patient) => (
            <Card
              key={
                patient._id
              }
            >

              <div className="space-y-4">

                <div>

                  <h3 className="text-lg font-black">
                    {
                      patient.name
                    }
                  </h3>

                  <p className="text-sm text-slate-500">
                    {
                      patient.email
                    }
                  </p>

                </div>

                <div className="space-y-2 text-sm">

                  <p>
                    <strong>
                      Blood Group:
                    </strong>{" "}
                    {
                      patient
                        .patientProfile
                        ?.bloodGroup ||
                      "N/A"
                    }
                  </p>

                  <p>
                    <strong>
                      Gender:
                    </strong>{" "}
                    {
                      patient
                        .patientProfile
                        ?.gender ||
                      "N/A"
                    }
                  </p>

                </div>

                <div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      patient.isActive
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {patient.isActive
                      ? "ACTIVE"
                      : "INACTIVE"}
                  </span>

                </div>

                <Button
                  onClick={() =>
                    setSelectedPatient(
                      patient
                    )
                  }
                >
                <Button
                    variant="secondary"
                    onClick={() =>
                        deletePatient(
                        patient._id
                        )
                    }
                    >
                    Delete
                    </Button>
                            <Eye
                           size={16}
                         />
                             View Details
                    </Button>

                    <Button
                        variant="secondary"
                        onClick={() =>
                            openEditModal(
                            patient
                            )
                        }
                        >
                        Edit
                        </Button>

                    <Button
                    variant="secondary"
                    onClick={() =>
                        toggleStatus(
                        patient._id
                        )
                    }
                    >
                    {patient.isActive
                        ? "Deactivate"
                        : "Activate"}
                    </Button>

              </div>

            </Card>
          )
        )}

      </div>

        )}

        {/* Details Modal */}

      <Modal
        isOpen={
          !!selectedPatient
        }
        title="Patient Details"
        onClose={() =>
          setSelectedPatient(
            null
          )
        }
      >

        {selectedPatient && (

          <div className="space-y-4">

            <Card title="Basic Information">

              <div className="space-y-3 text-sm">

                <div className="flex gap-2">
                  <Users
                    size={16}
                  />
                  <span>
                    {
                      selectedPatient.name
                    }
                  </span>
                </div>

                <div className="flex gap-2">
                  <Mail
                    size={16}
                  />
                  <span>
                    {
                      selectedPatient.email
                    }
                  </span>
                </div>

                <div className="flex gap-2">
                  <Calendar
                    size={16}
                  />
                  <span>
                    {new Date(
                      selectedPatient.createdAt
                    ).toLocaleDateString()}
                  </span>
                </div>

              </div>

            </Card>

            <Card title="Medical Profile">

              <div className="space-y-2 text-sm">

                <p>
                  <strong>
                    Blood Group:
                  </strong>{" "}
                  {
                    selectedPatient
                      .patientProfile
                      ?.bloodGroup ||
                    "N/A"
                  }
                </p>

                <p>
                  <strong>
                    Gender:
                  </strong>{" "}
                  {
                    selectedPatient
                      .patientProfile
                      ?.gender ||
                    "N/A"
                  }
                </p>

              </div>

            </Card>

            <Card title="Address">

              <div className="flex gap-2 text-sm">

                <MapPin
                  size={16}
                />

                <span>
                  {
                    selectedPatient
                      .patientProfile
                      ?.address ||
                    "No Address Available"
                  }
                </span>

              </div>

            </Card>

            <Card title="Emergency Contact">

              <div className="space-y-2 text-sm">

                <p>
                  <strong>
                    Name:
                  </strong>{" "}
                  {
                    selectedPatient
                      .patientProfile
                      ?.emergencyContact
                      ?.name ||
                    "N/A"
                  }
                </p>

                <div className="flex gap-2">

                  <Phone
                    size={16}
                  />

                  <span>
                    {
                      selectedPatient
                        .patientProfile
                        ?.emergencyContact
                        ?.phone ||
                      "N/A"
                    }
                  </span>

                </div>

                <p>
                  <strong>
                    Relation:
                  </strong>{" "}
                  {
                    selectedPatient
                      .patientProfile
                      ?.emergencyContact
                      ?.relation ||
                    "N/A"
                  }
                </p>

              </div>

            </Card>

          </div>

        )}

      </Modal>

      <Modal
  isOpen={
    showEditModal
  }
  title="Edit Patient"
  onClose={() =>
    setShowEditModal(
      false
    )
  }
>

  <div className="space-y-4">

    <Input
      label="Name"
      value={
        editForm.name
      }
      onChange={(e) =>
        setEditForm({
          ...editForm,
          name:
            e.target.value,
        })
      }
    />

    <Input
      label="Email"
      value={
        editForm.email
      }
      onChange={(e) =>
        setEditForm({
          ...editForm,
          email:
            e.target.value,
        })
      }
    />

    <Input
      label="Blood Group"
      value={
        editForm.bloodGroup
      }
      onChange={(e) =>
        setEditForm({
          ...editForm,
          bloodGroup:
            e.target.value,
        })
      }
    />

    <Input
      label="Address"
      value={
        editForm.address
      }
      onChange={(e) =>
        setEditForm({
          ...editForm,
          address:
            e.target.value,
        })
      }
    />

    <Input
      label="Emergency Name"
      value={
        editForm.emergencyName
      }
      onChange={(e) =>
        setEditForm({
          ...editForm,
          emergencyName:
            e.target.value,
        })
      }
    />

    <Input
      label="Emergency Phone"
      value={
        editForm.emergencyPhone
      }
      onChange={(e) =>
        setEditForm({
          ...editForm,
          emergencyPhone:
            e.target.value,
        })
      }
    />

    <Button
      onClick={
        savePatient
      }
      className="w-full"
    >
      Save Changes
    </Button>

  </div>

</Modal>

    </div>
  );
}

export default AdminPatients;