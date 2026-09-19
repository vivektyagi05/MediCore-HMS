// ─────────────────────────────────────────────────────────────────────────
// PHASE P6 — Clinical Workspace 2.0: Since Last Visit + Medication
// Reconciliation.
//
// Deliberately dependency-free (no model imports, no DB) — same pattern as
// doctorPatientRelationshipService.js / capacityAggregates.js — so the
// comparison logic is unit-testable in isolation. Both features share ONE
// engine (medication reconciliation is also the "Medication" row inside
// Since Last Visit) rather than two separate ad-hoc diff implementations,
// per the project's "no duplicate engine" rule.
//
// Every value here is derived only from real, already-fetched records
// (appointments/prescriptions/reports/certificates the caller passes in).
// If there isn't enough real history to support a comparison, this returns
// `available: false` / `null` rather than inventing one.
// ─────────────────────────────────────────────────────────────────────────

const norm = (value) => (value || "").trim().toLowerCase();
const describeDose = (medicine) => [medicine?.dosage, medicine?.frequency].filter(Boolean).join(" ") || "—";

// Compares the two most recent non-cancelled prescriptions (caller supplies
// them already sorted desc by createdAt — same order every existing
// Prescription.find({...}).sort({createdAt:-1}) query in this codebase
// already produces, so no second sort is introduced here).
export function buildMedicationReconciliation(prescriptions = []) {
  const active = (prescriptions || []).filter((p) => p.status !== "cancelled");
  if (active.length < 2) return null;

  const [current, previous] = active;
  const prevByName = new Map((previous.medicines || []).map((m) => [norm(m.name), m]));
  const currByName = new Map((current.medicines || []).map((m) => [norm(m.name), m]));

  const rows = [];
  for (const [key, medicine] of currByName) {
    const prevMedicine = prevByName.get(key);
    if (!prevMedicine) {
      rows.push({ name: medicine.name, status: "NEW", previous: null, current: describeDose(medicine) });
    } else if (norm(prevMedicine.dosage) !== norm(medicine.dosage) || norm(prevMedicine.frequency) !== norm(medicine.frequency)) {
      rows.push({ name: medicine.name, status: "DOSE_CHANGED", previous: describeDose(prevMedicine), current: describeDose(medicine) });
    } else {
      rows.push({ name: medicine.name, status: "CONTINUED", previous: describeDose(prevMedicine), current: describeDose(medicine) });
    }
  }
  for (const [key, medicine] of prevByName) {
    if (!currByName.has(key)) {
      rows.push({ name: medicine.name, status: "STOPPED", previous: describeDose(medicine), current: null });
    }
  }

  return {
    currentPrescriptionId: current._id,
    previousPrescriptionId: previous._id,
    currentDate: current.createdAt,
    previousDate: previous.createdAt,
    rows,
  };
}

// "Since Last Visit" — a real, source-backed comparison between the two
// most recent non-cancelled appointments. Returns `available: false` with
// an honest reason (never a fabricated table) when there isn't a second
// real visit to compare against.
export function buildSinceLastVisitComparison({ appointments = [], prescriptions = [], reports = [], certificates = [], followUp = null } = {}) {
  const nonCancelled = (appointments || [])
    .filter((a) => a.status !== "cancelled")
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (nonCancelled.length < 2) {
    return { available: false, reason: "Comparison unavailable — fewer than two recorded visits on file." };
  }

  const [current, previous] = nonCancelled;
  const currentTime = new Date(current.date).getTime();
  const previousTime = new Date(previous.date).getTime();

  const countUpTo = (list, dateField, upTo) =>
    (list || []).filter((item) => new Date(item[dateField] || item.createdAt).getTime() <= upTo).length;

  const reportsBefore = countUpTo(reports, "reportDate", previousTime);
  const reportsNow = countUpTo(reports, "reportDate", currentTime);
  const docsBefore = countUpTo(certificates, "createdAt", previousTime);
  const docsNow = countUpTo(certificates, "createdAt", currentTime);

  const medicationReconciliation = buildMedicationReconciliation(prescriptions);
  const medicationChanged = medicationReconciliation?.rows.some((row) => row.status !== "CONTINUED") || false;

  const followUpPrevious = followUp?.overdue || followUp?.upcoming ? "Planned" : "None";
  const followUpCurrent = followUp?.overdue ? "Overdue" : followUp?.upcoming ? "Planned" : "None";

  return {
    available: true,
    previousVisitDate: previous.date,
    currentVisitDate: current.date,
    rows: [
      {
        label: "Medication",
        previous: medicationReconciliation ? "On file" : "No prior prescription on file",
        current: medicationReconciliation ? `${medicationReconciliation.rows.length} medicine(s) reviewed` : "No prior prescription on file",
        status: medicationReconciliation ? (medicationChanged ? "CHANGED" : "UNCHANGED") : "UNAVAILABLE",
      },
      {
        label: "Reports",
        previous: String(reportsBefore),
        current: String(reportsNow),
        status: reportsNow > reportsBefore ? "NEW" : "UNCHANGED",
      },
      {
        label: "Follow-up",
        previous: followUpPrevious,
        current: followUpCurrent,
        status: followUp?.overdue ? "OVERDUE" : "UNCHANGED",
      },
      {
        label: "Documents",
        previous: String(docsBefore),
        current: String(docsNow),
        status: docsNow > docsBefore ? "NEW" : "UNCHANGED",
      },
    ],
    medicationReconciliation,
  };
}
