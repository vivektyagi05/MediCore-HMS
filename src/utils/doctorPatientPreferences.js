// Doctor-side "Pinned Patients" and "Recently Viewed Patients" — client-only
// convenience state, mirroring the existing src/utils/recentlyViewed.js
// pattern used elsewhere in the app. Not backed by a model: this is UI
// convenience state, not clinical data, so no backend endpoint is needed.

const PINNED_KEY = "medicore_doctor_pinned_patients";
const RECENT_KEY = "medicore_doctor_recent_patients";
const MAX_RECENT = 8;

function readList(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // localStorage unavailable — fail silently, this is convenience state only
  }
}

export function getPinnedPatientIds() {
  return readList(PINNED_KEY);
}

export function togglePinnedPatient(patientId) {
  const current = readList(PINNED_KEY);
  const next = current.includes(patientId)
    ? current.filter((id) => id !== patientId)
    : [...current, patientId];
  writeList(PINNED_KEY, next);
  return next;
}

export function getRecentlyViewedPatients() {
  return readList(RECENT_KEY);
}

export function recordRecentlyViewedPatient(patient) {
  if (!patient?._id) return getRecentlyViewedPatients();
  const current = readList(RECENT_KEY).filter((p) => p._id !== patient._id);
  const next = [
    { _id: patient._id, name: patient.name, viewedAt: new Date().toISOString() },
    ...current,
  ].slice(0, MAX_RECENT);
  writeList(RECENT_KEY, next);
  return next;
}
