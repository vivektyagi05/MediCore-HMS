import { Search, Users, UserCheck, Clock3, Activity } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { doctorApi } from "../../api/doctorApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";

import { useToast } from "../../context/ToastContext";

function formatDate(value) {
  if (!value) return "N/A";

  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function DoctorPatients() {
  const toast = useToast();

  const [patients, setPatients] = useState([]);
  const [analytics, setAnalytics] = useState({});

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");

  const loadPatients = async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await doctorApi.getPatients();

      setPatients(response.data?.patients || []);
      setAnalytics(response.data?.analytics || {});
    } catch (err) {
      setError(getApiErrorMessage(err));
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPatients();
  }, []);

  const filteredPatients = useMemo(() => {
    const query = search.toLowerCase();

    return patients.filter((patient) => {
      return (
        patient.name?.toLowerCase().includes(query) ||
        patient.email?.toLowerCase().includes(query) ||
        patient.bloodGroup?.toLowerCase().includes(query)
      );
    });
  }, [patients, search]);

  if (isLoading) {
    return <Loader label="Loading patients..." />;
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
            Doctor Patients
          </p>

          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
            Patient Relationship Center
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Monitor patients, follow-ups and visit history.
          </p>
        </div>

        <Button onClick={loadPatients}>
          Refresh Patients
        </Button>
      </div>

      {/* ERROR */}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      {/* ANALYTICS */}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <Users size={28} className="text-blue-600" />

          <p className="mt-4 text-3xl font-black">
            {analytics.totalPatients || 0}
          </p>

          <p className="text-sm font-bold text-slate-500">
            Total Patients
          </p>
        </Card>

        <Card>
          <UserCheck size={28} className="text-emerald-600" />

          <p className="mt-4 text-3xl font-black">
            {analytics.activePatients || 0}
          </p>

          <p className="text-sm font-bold text-slate-500">
            Active Patients
          </p>
        </Card>

        <Card>
          <Clock3 size={28} className="text-amber-600" />

          <p className="mt-4 text-3xl font-black">
            {analytics.followUps || 0}
          </p>

          <p className="text-sm font-bold text-slate-500">
            Follow Ups
          </p>
        </Card>

        <Card>
          <Activity size={28} className="text-purple-600" />

          <p className="mt-4 text-3xl font-black">
            {analytics.newPatientsThisMonth || 0}
          </p>

          <p className="text-sm font-bold text-slate-500">
            New This Month
          </p>
        </Card>
      </div>

      {/* SEARCH */}

      <Card title="Search Patients">
        <div className="relative">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or blood group..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-medium outline-none transition focus:border-blue-500"
          />
        </div>
      </Card>

      {/* PATIENTS */}

      {filteredPatients.length === 0 ? (
        <EmptyState
          title="No patients found"
          description="Patients will appear after appointments are booked."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredPatients.map((patient) => (
            <Card key={patient._id}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-black text-slate-950">
                    {patient.name}
                  </h3>

                  <p className="mt-1 text-sm text-slate-500">
                    {patient.email}
                  </p>
                </div>

                {patient.needsFollowUp && (
                  <span className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-black text-amber-700">
                    Follow Up
                  </span>
                )}
              </div>

              <div className="mt-5 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">
                    Gender
                  </span>

                  <span className="font-bold capitalize">
                    {patient.gender || "N/A"}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">
                    Blood Group
                  </span>

                  <span className="font-bold">
                    {patient.bloodGroup || "N/A"}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">
                    Total Visits
                  </span>

                  <span className="font-black text-blue-600">
                    {patient.appointmentCount}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">
                    Last Visit
                  </span>

                  <span className="font-bold">
                    {formatDate(patient.lastVisit)}
                  </span>
                </div>
              </div>

              {/* QUICK ACTIONS */}

              <div className="mt-6 grid grid-cols-2 gap-2">
                <Button variant="secondary">
                  View Profile
                </Button>

                <Button variant="secondary">
                  History
                </Button>

                <Button>
                  Chat
                </Button>

                <Button>
                  Follow Up
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default DoctorPatients;