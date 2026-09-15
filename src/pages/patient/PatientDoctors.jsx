import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bookmark, Star, Calendar, Trash2, Pencil, Scale, ShieldCheck,
  TrendingUp, TrendingDown, History, Search, X, CheckCircle2,
} from "lucide-react";

import { appointmentApi } from "../../api/appointmentApi";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import Modal from "../../components/ui/Modal";
import EmptyState from "../../components/shared/EmptyState";
import { StarRating } from "../../components/doctors/DoctorDiscoveryUI";

import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const MAX_COMPARE = 4;

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function PatientDoctors() {
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [savedDoctors, setSavedDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [compareIds, setCompareIds] = useState([]);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ notes: "", tags: "", isPrimaryPhysician: false });
  const [editLoading, setEditLoading] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [savedRes, apptRes] = await Promise.all([
        patientWorkflowApi.getSavedDoctors(),
        appointmentApi.getAppointments({ limit: 200 }),
      ]);
      setSavedDoctors(savedRes?.data?.savedDoctors || []);
      setAppointments(apptRes?.data?.appointments || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Real appointment history per doctor — used for "previously consulted",
  // last visit date, and a genuine "book again" quick action. Nothing here
  // is inferred beyond what the patient's own appointment records show.
  const historyByDoctor = useMemo(() => {
    const map = new Map();
    for (const appt of appointments) {
      const doctorId = appt.doctorId?._id || appt.doctorId;
      if (!doctorId) continue;
      const key = String(doctorId);
      const existing = map.get(key) || { total: 0, completed: 0, lastDate: null, upcoming: false };
      existing.total += 1;
      if (["completed", "consultation_completed", "review_eligible"].includes(appt.status)) {
        existing.completed += 1;
        if (!existing.lastDate || new Date(appt.date) > new Date(existing.lastDate)) {
          existing.lastDate = appt.date;
        }
      }
      if (["pending", "approved", "payment_pending", "payment_completed"].includes(appt.status)) {
        existing.upcoming = true;
      }
      map.set(key, existing);
    }
    return map;
  }, [appointments]);

  const allTags = useMemo(() => {
    const set = new Set();
    savedDoctors.forEach((s) => (s.tags || []).forEach((tg) => set.add(tg)));
    return Array.from(set);
  }, [savedDoctors]);

  const filtered = useMemo(() => {
    return savedDoctors.filter((s) => {
      const name = s.doctorId?.userId?.name?.toLowerCase() || "";
      const spec = s.doctorId?.specialization?.toLowerCase() || "";
      const matchesSearch = !search || name.includes(search.toLowerCase()) || spec.includes(search.toLowerCase());
      const matchesTag = !tagFilter || (s.tags || []).includes(tagFilter);
      return matchesSearch && matchesTag;
    });
  }, [savedDoctors, search, tagFilter]);

  // Primary physician first, then most recently saved.
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.isPrimaryPhysician !== b.isPrimaryPhysician) return a.isPrimaryPhysician ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [filtered]);

  const toggleCompare = (doctorId) => {
    setCompareIds((prev) => {
      if (prev.includes(doctorId)) return prev.filter((x) => x !== doctorId);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, doctorId];
    });
  };

  const removeSaved = async (doctorId) => {
    try {
      await patientWorkflowApi.removeSavedDoctor(doctorId);
      toast.success(t("ui.doctorRemoved"));
      loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const openEdit = (saved) => {
    setEditTarget(saved);
    setEditForm({
      notes: saved.notes || "",
      tags: (saved.tags || []).join(", "),
      isPrimaryPhysician: Boolean(saved.isPrimaryPhysician),
    });
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!editTarget) return;
    try {
      setEditLoading(true);
      const doctorId = editTarget.doctorId?._id || editTarget.doctorId;
      await patientWorkflowApi.updateSavedDoctor(doctorId, {
        notes: editForm.notes,
        tags: editForm.tags.split(",").map((s) => s.trim()).filter(Boolean),
        isPrimaryPhysician: editForm.isPrimaryPhysician,
      });
      toast.success("Saved doctor updated");
      setEditTarget(null);
      loadData();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setEditLoading(false);
    }
  };

  if (loading) return <Loader label={t("ui.loadingDoctors")} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Healthcare Shortlist</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Saved Doctors</h1>
          <p className="mt-2 text-sm text-slate-500">
            The doctors you trust — organize them, track your history, and book again in one tap.
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate("/patient/doctors")}>
          <Search size={16} /> Find more doctors
        </Button>
      </div>

      {savedDoctors.length > 0 && (
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search saved doctors..." />
            </div>
            {allTags.length > 0 && (
              <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}
                className="rounded-xl border border-slate-200 p-3 text-sm">
                <option value="">All tags</option>
                {allTags.map((tg) => <option key={tg} value={tg}>{tg}</option>)}
              </select>
            )}
          </div>
        </Card>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          title="No saved doctors yet"
          description="Bookmark doctors from the Doctors page to build your personal healthcare shortlist — favorites, your primary physician, and quick rebooking all live here."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((saved) => {
            const doctor = saved.doctorId;
            if (!doctor) return null;
            const doctorId = doctor._id;
            const history = historyByDoctor.get(String(doctorId));
            const feesChanged = saved.feesAtSave !== undefined && saved.feesAtSave !== null && Number(saved.feesAtSave) !== Number(doctor.fees);
            const specChanged = saved.specializationAtSave && saved.specializationAtSave !== doctor.specialization;

            return (
              <Card key={saved._id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-black text-slate-950">Dr. {doctor.userId?.name}</h3>
                      {saved.isPrimaryPhysician && (
                        <span className="flex items-center gap-1 rounded-lg bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                          <ShieldCheck size={11} /> Primary Physician
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{doctor.specialization}</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <StarRating rating={doctor.rating || 0} />
                      <span className="text-xs font-bold text-slate-600">{(doctor.rating || 0).toFixed(1)}</span>
                    </div>
                  </div>
                  <label className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                    <input type="checkbox" checked={compareIds.includes(String(doctorId))}
                      disabled={compareIds.length >= MAX_COMPARE && !compareIds.includes(String(doctorId))}
                      onChange={() => toggleCompare(String(doctorId))}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                    Compare
                  </label>
                </div>

                <p className="mt-3 text-sm">
                  Consultation Fee: <strong>₹{doctor.fees}</strong>
                  {feesChanged && (
                    <span className={`ml-2 inline-flex items-center gap-1 text-xs font-bold ${Number(doctor.fees) > Number(saved.feesAtSave) ? "text-amber-600" : "text-emerald-600"}`}>
                      {Number(doctor.fees) > Number(saved.feesAtSave) ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      was ₹{saved.feesAtSave}
                    </span>
                  )}
                </p>

                {specChanged && (
                  <p className="mt-1 text-xs font-semibold text-violet-600">
                    Specialization updated since you saved this doctor (was {saved.specializationAtSave})
                  </p>
                )}

                {(saved.tags || []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {saved.tags.map((tg) => (
                      <span key={tg} className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{tg}</span>
                    ))}
                  </div>
                )}

                {saved.notes && (
                  <p className="mt-3 rounded-xl bg-slate-50 p-2 text-xs text-slate-600">{saved.notes}</p>
                )}

                <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <History size={14} className="flex-shrink-0 text-slate-400" />
                  {history?.completed ? (
                    <span>
                      Previously consulted · {history.completed} visit{history.completed > 1 ? "s" : ""} · last on {formatDate(history.lastDate)}
                    </span>
                  ) : history?.total ? (
                    <span>{history.total} appointment{history.total > 1 ? "s" : ""} on record</span>
                  ) : (
                    <span>No appointments yet with this doctor</span>
                  )}
                </div>

                {history?.upcoming && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-blue-600">
                    <CheckCircle2 size={13} /> You have an active appointment with this doctor
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button className="flex-1" onClick={() => navigate(`/patient/appointments/book?doctorId=${doctorId}`)}>
                    <Calendar size={15} /> Book Again
                  </Button>
                  <Button variant="secondary" onClick={() => openEdit(saved)}>
                    <Pencil size={15} />
                  </Button>
                  <Button to={`/doctors/${doctorId}`} variant="secondary"><Bookmark size={15} /></Button>
                  <Button variant="danger" onClick={() => removeSaved(doctorId)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {compareIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Scale size={16} className="text-blue-600" /> {compareIds.length} of {MAX_COMPARE} selected to compare
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setCompareIds([])} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Clear</button>
              <Button disabled={compareIds.length < 2} onClick={() => navigate(`/doctors/compare?ids=${compareIds.join(",")}`)}>
                Compare Doctors
              </Button>
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={!!editTarget} title="Edit Saved Doctor" onClose={() => setEditTarget(null)}>
        <form onSubmit={submitEdit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">Notes</label>
            <textarea
              value={editForm.notes}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              rows={3}
              placeholder="e.g. Great with kids, prefers morning slots..."
              className="w-full rounded-xl border border-slate-200 p-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500 uppercase tracking-wider">Tags (comma separated)</label>
            <Input
              value={editForm.tags}
              onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
              placeholder="e.g. Family, Skin, Follow-up"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={editForm.isPrimaryPhysician}
              onChange={(e) => setEditForm({ ...editForm, isPrimaryPhysician: e.target.checked })}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
            Set as my primary physician
          </label>
          <Button type="submit" className="w-full" isLoading={editLoading}>Save Changes</Button>
        </form>
      </Modal>
    </div>
  );
}
