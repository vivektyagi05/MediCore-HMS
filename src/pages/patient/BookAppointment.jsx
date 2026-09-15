import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  HeartPulse,
  Info,
  Loader2,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
  Upload,
  User as UserIcon,
  Users,
} from "lucide-react";

import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import { publicApi } from "../../api/publicApi";

import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import BookingStepIndicator from "../../components/patient/booking/BookingStepIndicator";
import { useToast } from "../../context/ToastContext";
import { downloadAppointmentICS } from "../../utils/icsGenerator";
import { normalizeDoctorConsultationModes } from "../../utils/consultationMode.js";

const STEP_LABELS = [
  "Consultation",
  "Date & Time",
  "Patient",
  "Visit Reason",
  "Medical History",
  "Reports",
  "Insurance",
  "Review",
];

const COMMON_CONCERNS = [
  "General check-up",
  "Follow-up visit",
  "New symptom",
  "Chronic condition review",
  "Prescription renewal",
  "Lab report discussion",
];

const COMMON_SYMPTOMS = [
  "Fever",
  "Headache",
  "Cough",
  "Fatigue",
  "Body ache",
  "Nausea",
  "Shortness of breath",
  "Skin rash",
  "Joint pain",
  "Dizziness",
];


// Doctor-producer consultation-mode label ("online" | "offline" |
// "home_visit" — see backend/constants/consultationMode.js). form.
// consultationMode holds this raw value throughout the wizard, so every
// place it's shown to the patient needs the real human meaning, not the
// raw string (e.g. "offline" read literally, or a generic underscore
// replace that never distinguishes home_visit from in-clinic).
const DOCTOR_MODE_LABELS = { online: "Online", offline: "In-Clinic", home_visit: "Home Visit" };
const doctorModeLabel = (mode) => (mode ? DOCTOR_MODE_LABELS[mode] || mode.replace("_", " ") : "Not selected");


const getBookingRequestId = (doctorId, date, timeSlot) => {
  const key = `medicore:booking-request:${doctorId}:${date}:${timeSlot}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return { key, id: existing };
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(key, id);
    return { key, id };
  } catch {
    return { key, id: null };
  }
};

const emptyDraft = {
  consultationMode: "",
  date: "",
  timeSlot: "",
  familyMemberId: "",
  reason: "",
  customReason: "",
  symptoms: [],
  symptomDuration: "",
  painLevel: 0,
  hasPreviousConsultation: false,
  existingConditions: "",
  currentMedications: "",
  allergies: "",
  preferredLanguage: "",
  specialAssistance: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  insuranceId: "",
  reportIds: [],
  consentAccepted: false,
};

function toDateInputValue(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function groupSlotsByPeriod(slots) {
  const groups = { Morning: [], Afternoon: [], Evening: [] };
  slots.forEach((slot) => {
    const startHour = Number(String(slot).split(/[-:]/)[0]);
    if (Number.isNaN(startHour)) {
      groups.Morning.push(slot);
    } else if (startHour < 12) {
      groups.Morning.push(slot);
    } else if (startHour < 17) {
      groups.Afternoon.push(slot);
    } else {
      groups.Evening.push(slot);
    }
  });
  return groups;
}

const csvToList = (value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function BookAppointment() {
  const [searchParams] = useSearchParams();
  const doctorId = searchParams.get("doctorId");
  const intentConsultationMode = searchParams.get("consultationMode") || "";
  const intentDate = searchParams.get("date") || "";
  const intentTimeSlot = searchParams.get("timeSlot") || "";
  const navigate = useNavigate();
  const toast = useToast();

  const [stepIndex, setStepIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [doctor, setDoctor] = useState(null);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [insurancePolicies, setInsurancePolicies] = useState([]);
  const [reports, setReports] = useState([]);

  const [form, setForm] = useState(emptyDraft);
  const [slots, setSlots] = useState([]);
  const [isSlotsLoading, setIsSlotsLoading] = useState(false);
  const [slotReason, setSlotReason] = useState("");
  const [isFindingNext, setIsFindingNext] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdAppointment, setCreatedAppointment] = useState(null);

  const [reportUpload, setReportUpload] = useState({ title: "", category: "", reportDate: "", file: null });
  const [isUploadingReport, setIsUploadingReport] = useState(false);
  const [insuranceForm, setInsuranceForm] = useState({ provider: "", policyNumber: "", policyHolder: "", validTill: "" });
  const [isSavingInsurance, setIsSavingInsurance] = useState(false);
  const [showInsuranceForm, setShowInsuranceForm] = useState(false);

  const fetchSlotsForDate = async (dateValue) => {
    if (!dateValue) return [];
    setIsSlotsLoading(true);
    setSlotReason("");
    try {
      const res = await appointmentApi.getAvailableSlots(doctorId, dateValue);
      setSlots(res.data.slots || []);
      setSlotReason(res.data.reason || "");
      return res.data.slots || [];
    } catch (err) {
      toast.error(getApiErrorMessage(err));
      return [];
    } finally {
      setIsSlotsLoading(false);
    }
  };

  // ── Initial load: doctor + family + insurance + reports + profile ──
  useEffect(() => {
    if (!doctorId) {
      setLoadError("No doctor was selected. Please go back and pick a doctor first.");
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const load = async () => {
      setIsLoading(true);
      setLoadError("");
      try {
        const [doctorRes, familyRes, insuranceRes, reportsRes, profileRes] = await Promise.all([
          publicApi.getDoctorProfile(doctorId),
          patientWorkflowApi.getFamily(),
          patientWorkflowApi.getInsurance(),
          patientWorkflowApi.getReports(),
          patientWorkflowApi.getProfileCompletion(),
        ]);

        if (!isMounted) return;

        setDoctor(doctorRes.data.doctor);
        setFamilyMembers(familyRes.data.familyMembers || []);
        setInsurancePolicies(insuranceRes.data.policies || []);
        setReports(reportsRes.data.reports || []);

        const profile = profileRes.data.profile || {};
        setForm((prev) => ({
          ...prev,
          allergies: (profile.allergies || []).join(", "),
          emergencyContactName: profile.emergencyContact?.name || "",
          emergencyContactPhone: profile.emergencyContact?.phone || "",
          // Never default to a raw legacy value ("both", "in_person")
          // straight off the Doctor document -- only a mode this
          // contract still recognizes may ever be pre-selected or
          // submitted. See src/utils/consultationMode.js.
          consultationMode: normalizeDoctorConsultationModes(doctorRes.data.doctor.consultationMode)[0] || "",
        }));

        // Restore any valid booking context that survived patient authentication.
        // The doctor is fetched first, so consultation mode can only be restored
        // when it is genuinely offered by this doctor.
        const offeredModes = normalizeDoctorConsultationModes(doctorRes.data.doctor.consultationMode);
        if (intentConsultationMode && offeredModes.includes(intentConsultationMode)) {
          setForm((prev) => ({ ...prev, consultationMode: intentConsultationMode }));
        }
        if (intentDate) {
          const available = await fetchSlotsForDate(intentDate);
          if (!available.includes(intentTimeSlot)) {
            setForm((prev) => ({ ...prev, date: intentDate, timeSlot: "" }));
          } else {
            setForm((prev) => ({ ...prev, date: intentDate, timeSlot: intentTimeSlot }));
          }
        }
      } catch (err) {
        if (isMounted) setLoadError(getApiErrorMessage(err));
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [doctorId, intentConsultationMode, intentDate, intentTimeSlot]);

  const selectedFamilyMember = useMemo(
    () => familyMembers.find((member) => member._id === form.familyMemberId) || null,
    [familyMembers, form.familyMemberId],
  );

  const selectedDayAvailability = useMemo(() => {
    if (!doctor?.availability?.length || !form.date) return null;
    const dayOfWeek = new Date(`${form.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    return doctor.availability.find((slot) => slot.dayOfWeek === dayOfWeek) || null;
  }, [doctor, form.date]);

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const pickDate = async (dateValue) => {
    update({ date: dateValue, timeSlot: "" });
    await fetchSlotsForDate(dateValue);
  };

  const quickPickToday = () => pickDate(toDateInputValue(new Date()));
  const quickPickTomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return pickDate(toDateInputValue(d));
  };
  const quickPickWeekend = () => {
    const d = new Date();
    const day = d.getDay();
    const daysUntilSaturday = (6 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSaturday);
    return pickDate(toDateInputValue(d));
  };

  const findNextAvailable = async () => {
    setIsFindingNext(true);
    try {
      // Phase DOC-07: single real backend search (was 14 sequential
      // /available-slots requests looped client-side) — same
      // buildDayCapacity engine the doctor's own Today view uses, so
      // "next available" can never disagree with what the doctor sees.
      const res = await appointmentApi.getNextAvailableSlot(doctorId, toDateInputValue(new Date()));
      if (res.data.date) {
        update({ date: res.data.date, timeSlot: "" });
        setSlots(res.data.slots || []);
        setSlotReason("");
        toast.success(`Next available: ${formatDisplayDate(res.data.date)}`);
      } else {
        toast.error("No availability found in the next 60 days");
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsFindingNext(false);
    }
  };

  const toggleSymptom = (symptom) => {
    update({
      symptoms: form.symptoms.includes(symptom)
        ? form.symptoms.filter((item) => item !== symptom)
        : [...form.symptoms, symptom],
    });
  };

  const toggleReport = (reportId) => {
    update({
      reportIds: form.reportIds.includes(reportId)
        ? form.reportIds.filter((id) => id !== reportId)
        : [...form.reportIds, reportId],
    });
  };

  // ── Step validation — keeps "Continue" honest instead of a no-op button ──
  const stepErrors = useMemo(() => {
    switch (stepIndex) {
      case 0:
        return form.consultationMode ? [] : ["Select how you'd like to consult"];
      case 1:
        return form.date && form.timeSlot ? [] : ["Pick a date and time slot"];
      case 3:
        return form.reason || form.customReason ? [] : ["Tell us the reason for this visit"];
      case 7:
        return form.consentAccepted === true
          ? []
          : ["Please confirm the consent checkbox to continue"];
      default:
        return [];
    }
  }, [stepIndex, form]);

  const goNext = () => {
    if (stepErrors.length) {
      toast.error(stepErrors[0]);
      return;
    }
    setStepIndex((i) => Math.min(i + 1, STEP_LABELS.length - 1));
  };
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const uploadNewReport = async () => {
    if (!reportUpload.title || !reportUpload.category || !reportUpload.reportDate || !reportUpload.file) {
      toast.error("Title, category, date, and file are all required");
      return;
    }
    setIsUploadingReport(true);
    try {
      const formData = new FormData();
      formData.append("title", reportUpload.title);
      formData.append("category", reportUpload.category);
      formData.append("reportDate", reportUpload.reportDate);
      formData.append("report", reportUpload.file);
      const res = await patientWorkflowApi.uploadReport(formData);
      const newReport = res.data.report;
      setReports((prev) => [newReport, ...prev]);
      update({ reportIds: [...form.reportIds, newReport._id] });
      setReportUpload({ title: "", category: "", reportDate: "", file: null });
      toast.success("Report uploaded and attached");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsUploadingReport(false);
    }
  };

  const saveNewInsurance = async () => {
    if (!insuranceForm.provider || !insuranceForm.policyNumber || !insuranceForm.policyHolder || !insuranceForm.validTill) {
      toast.error("Provider, policy number, holder, and validity are all required");
      return;
    }
    setIsSavingInsurance(true);
    try {
      const formData = new FormData();
      Object.entries(insuranceForm).forEach(([key, value]) => formData.append(key, value));
      const res = await patientWorkflowApi.createInsurance(formData);
      const newPolicy = res.data.policy;
      setInsurancePolicies((prev) => [newPolicy, ...prev]);
      update({ insuranceId: newPolicy._id });
      setShowInsuranceForm(false);
      toast.success("Insurance policy saved and attached");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSavingInsurance(false);
    }
  };

  const submitBooking = async () => {
    if (form.consentAccepted !== true) {
      toast.error("Please confirm the consent checkbox to continue");
      return;
    }
    setIsSubmitting(true);
    try {
      const reasonText = form.reason === "Other" || !form.reason ? form.customReason : form.reason;
      const request = getBookingRequestId(doctorId, form.date, form.timeSlot);
      const payload = {
          doctorId,
          bookingRequestId: request.id || undefined,
          date: form.date,
          timeSlot: form.timeSlot,
          familyMemberId: form.familyMemberId || undefined,
          notes: reasonText || "",
          consultationMode: form.consultationMode,
          reason: reasonText,
          symptoms: form.symptoms,
          symptomDuration: form.symptomDuration,
          painLevel: form.painLevel,
          hasPreviousConsultation: form.hasPreviousConsultation,
          existingConditions: csvToList(form.existingConditions),
          currentMedications: csvToList(form.currentMedications),
          allergies: csvToList(form.allergies),
          preferredLanguage: form.preferredLanguage,
          specialAssistance: form.specialAssistance,
          emergencyContact: {
            name: form.emergencyContactName,
            phone: form.emergencyContactPhone,
          },
          insuranceId: form.insuranceId || undefined,
          reportIds: form.reportIds,
          consentAccepted: form.consentAccepted === true,
        };
      const res = await appointmentApi.createAppointment(payload);
      setCreatedAppointment(res.data);
      if (request?.key) {
        try { sessionStorage.removeItem(request.key); } catch { /* storage unavailable */ }
      }
      toast.success("Appointment request sent to the doctor");
    } catch (err) {
      // Phase DOC-07 §10: a lost double-booking race must show the reason,
      // refresh real alternatives, and send the patient back to pick a new
      // time — never a dead-end toast the patient has to recover from
      // manually.
      if (err?.response?.data?.details?.code === "SLOT_CONFLICT") {
        toast.error(getApiErrorMessage(err));
        await fetchSlotsForDate(form.date);
        update({ timeSlot: "" });
        setStepIndex(1);
        return;
      }
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <Loader label="Preparing your booking..." />;

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{loadError}</div>
        <Button to="/patient/doctors">Browse doctors</Button>
      </div>
    );
  }

  if (createdAppointment) {
    return (
      <ConfirmationScreen
        appointment={createdAppointment}
        doctor={doctor}
        form={form}
        navigate={navigate}
      />
    );
  }

  const doctorInitials = (doctor?.name || "Dr")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  return (
    <div className="space-y-6">
      <Link to={`/doctors/${doctorId}`} className="inline-flex items-center gap-2 text-sm font-black text-blue-600">
        <ArrowLeft size={16} /> Back to doctor profile
      </Link>

      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Book an Appointment</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Let's get your visit scheduled</h1>
        <p className="mt-2 text-sm text-slate-500">
          A few quick steps — we'll explain why we ask for each piece of information along the way.
        </p>
      </div>

      <BookingStepIndicator steps={STEP_LABELS} currentIndex={stepIndex} />

      <div className="grid gap-6 xl:grid-cols-[1fr_0.62fr]">
        <Card>
          {stepIndex === 0 && (
            <StepConsultationType doctor={doctor} form={form} update={update} />
          )}
          {stepIndex === 1 && (
            <StepDateTime
              form={form}
              update={update}
              slots={slots}
              isSlotsLoading={isSlotsLoading}
              slotReason={slotReason}
              pickDate={pickDate}
              quickPickToday={quickPickToday}
              quickPickTomorrow={quickPickTomorrow}
              quickPickWeekend={quickPickWeekend}
              findNextAvailable={findNextAvailable}
              isFindingNext={isFindingNext}
              selectedDayAvailability={selectedDayAvailability}
            />
          )}
          {stepIndex === 2 && (
            <StepPatient familyMembers={familyMembers} form={form} update={update} />
          )}
          {stepIndex === 3 && <StepReason form={form} update={update} toggleSymptom={toggleSymptom} />}
          {stepIndex === 4 && (
            <StepMedicalHistory form={form} update={update} selectedFamilyMember={selectedFamilyMember} />
          )}
          {stepIndex === 5 && (
            <StepReports
              reports={reports}
              form={form}
              toggleReport={toggleReport}
              reportUpload={reportUpload}
              setReportUpload={setReportUpload}
              uploadNewReport={uploadNewReport}
              isUploadingReport={isUploadingReport}
            />
          )}
          {stepIndex === 6 && (
            <StepInsurance
              insurancePolicies={insurancePolicies}
              form={form}
              update={update}
              showInsuranceForm={showInsuranceForm}
              setShowInsuranceForm={setShowInsuranceForm}
              insuranceForm={insuranceForm}
              setInsuranceForm={setInsuranceForm}
              saveNewInsurance={saveNewInsurance}
              isSavingInsurance={isSavingInsurance}
            />
          )}
          {stepIndex === 7 && (
            <StepReview
              doctor={doctor}
              form={form}
              update={update}
              selectedFamilyMember={selectedFamilyMember}
              insurancePolicies={insurancePolicies}
              reports={reports}
            />
          )}

          <div className="mt-8 flex items-center justify-between border-t border-slate-200/60 pt-5">
            <Button variant="secondary" onClick={goBack} disabled={stepIndex === 0}>
              <ArrowLeft size={16} /> Back
            </Button>
            {stepIndex < STEP_LABELS.length - 1 ? (
              <Button onClick={goNext}>
                Continue <ArrowRight size={16} />
              </Button>
            ) : (
              <Button onClick={submitBooking} isLoading={isSubmitting}>
                Confirm & Send Request <ArrowRight size={16} />
              </Button>
            )}
          </div>
        </Card>

        {/* Sticky booking summary */}
        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card title="Your Booking">
            <div className="flex items-center gap-3 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white font-black text-sm">
                {doctorInitials}
              </span>
              <div>
                <p className="font-bold text-slate-950">Dr. {doctor?.name}</p>
                <p className="text-xs text-slate-500">{doctor?.specialization}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <SummaryRow icon={Stethoscope} label="Mode" value={doctorModeLabel(form.consultationMode)} />
              <SummaryRow icon={CalendarDays} label="Date" value={form.date ? formatDisplayDate(form.date) : "Not selected"} />
              <SummaryRow icon={Clock3} label="Time" value={form.timeSlot || "Not selected"} />
              <SummaryRow
                icon={Users}
                label="Patient"
                value={form.familyMemberId ? selectedFamilyMember?.name || "Family member" : "Myself"}
              />
              <SummaryRow icon={FileText} label="Reports attached" value={String(form.reportIds.length)} />
              <SummaryRow icon={ShieldCheck} label="Insurance" value={form.insuranceId ? "Attached" : "None"} />
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-white/60 p-3">
              <p className="text-xs font-bold text-slate-700">Consultation fee</p>
              <p className="mt-1 text-2xl font-black text-slate-950">₹{doctor?.fees ?? 0}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                You won't be charged now — payment opens only after the doctor approves this request.
              </p>
            </div>
          </Card>

          <Card>
            <div className="flex items-start gap-2 text-xs text-slate-500">
              <Info size={14} className="mt-0.5 flex-shrink-0 text-blue-500" />
              <p>Your progress is saved automatically on this device, so you can safely come back and finish later.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-slate-500">
        <Icon size={14} /> {label}
      </span>
      <span className="max-w-[55%] truncate text-right font-bold text-slate-900">{value}</span>
    </div>
  );
}

function StepConsultationType({ doctor, form, update }) {
  // Root cause of the reported "Both" button: this used to read
  // doctor.consultationMode straight off the Doctor document with no
  // filtering, so a doctor whose stored data still held a legacy value
  // (e.g. "both", from before the practice-settings contract was fixed)
  // rendered that raw string as a selectable option here -- capitalized by
  // CSS into literally "Both" -- and picking it produced the invalid
  // "both" value that POST /api/appointments then rejected. Only values
  // this contract still recognizes may ever be offered to a patient. See
  // src/utils/consultationMode.js.
  const normalizedModes = normalizeDoctorConsultationModes(doctor?.consultationMode);
  const modes = normalizedModes.length ? normalizedModes : ["online"];
  // Doctor-producer values ("online" | "offline" | "home_visit" — see
  // backend/constants/consultationMode.js). This step reads straight off
  // Doctor.consultationMode, so "offline" and "home_visit" must each get
  // their own correct human meaning — collapsing everything non-online into
  // one "In-Person Visit" label previously mislabeled home_visit doctors.
  const MODE_TITLES = { online: "Online Video Consultation", offline: "In-Clinic Visit", home_visit: "Home Visit" };
  const MODE_DESCRIPTIONS = {
    online: "Consult from anywhere over a secure video call once approved.",
    offline: `Visit the clinic in person${doctor?.hospitalName ? ` at ${doctor.hospitalName}` : ""}.`,
    home_visit: "The doctor will visit you at your address for this consultation.",
  };
  return (
    <div>
      <StepHeading
        icon={Stethoscope}
        title="How would you like to consult?"
        help="This determines whether you'll get a video link or an in-clinic slot — pick whichever suits you."
      />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {modes.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => update({ consultationMode: mode })}
            className={`rounded-2xl border-2 p-5 text-left transition ${
              form.consultationMode === mode ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white/60 hover:border-slate-300"
            }`}
          >
            <p className="font-black text-slate-950 capitalize">{MODE_TITLES[mode] || mode.replace("_", " ")}</p>
            <p className="mt-2 text-xs text-slate-500">
              {MODE_DESCRIPTIONS[mode] || ""}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepDateTime({
  form,
  update,
  slots,
  isSlotsLoading,
  slotReason,
  pickDate,
  quickPickToday,
  quickPickTomorrow,
  quickPickWeekend,
  findNextAvailable,
  isFindingNext,
  selectedDayAvailability,
}) {
  const grouped = groupSlotsByPeriod(slots);
  const minDate = toDateInputValue(new Date());

  return (
    <div>
      <StepHeading
        icon={CalendarDays}
        title="Pick a date and time"
        help="We only show slots the doctor is genuinely free for — no double-booking risk."
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={quickPickToday}>Today</Button>
        <Button variant="secondary" onClick={quickPickTomorrow}>Tomorrow</Button>
        <Button variant="secondary" onClick={quickPickWeekend}>This Weekend</Button>
        <Button variant="secondary" onClick={findNextAvailable} isLoading={isFindingNext}>
          <Sparkles size={14} /> Next Available
        </Button>
      </div>

      <div className="mt-4">
        <Input
          label="Or choose a specific date"
          type="date"
          min={minDate}
          value={form.date}
          onChange={(e) => pickDate(e.target.value)}
        />
      </div>

      {form.date && (
        <div className="mt-6">
          {isSlotsLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Checking live availability...
            </div>
          ) : slots.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-700">
              {slotReason === "blocked_date"
                ? "The doctor is unavailable on this date."
                : slotReason === "on_leave"
                  ? "The doctor is on approved leave for this date."
                  : slotReason === "past_date"
                    ? "Please choose a date from today onward."
                    : "Fully booked — try another date or use Next Available."}
            </div>
          ) : (
            <div className="space-y-4">
              {slots.length <= 3 && (
                <p className="text-xs font-bold text-amber-600">⚡ Filling fast — only {slots.length} slot(s) left today.</p>
              )}
              {Object.entries(grouped).map(([period, periodSlots]) =>
                periodSlots.length ? (
                  <div key={period}>
                    <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">{period}</p>
                    <div className="flex flex-wrap gap-2">
                      {periodSlots.map((slot, idx) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => update({ timeSlot: slot })}
                          className={`relative rounded-xl border-2 px-4 py-2 text-sm font-bold transition ${
                            form.timeSlot === slot ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white/60 text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          {slot}
                          {period === "Morning" && idx === 0 && periodSlots === grouped.Morning && slots[0] === slot && (
                            <span className="absolute -top-2 -right-2 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black text-white">
                              Recommended
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          )}

          {selectedDayAvailability && (
            <div className="mt-5 grid gap-2 rounded-xl border border-slate-200 bg-white/60 p-4 text-xs text-slate-600 sm:grid-cols-3">
              <span>
                <strong className="block text-slate-950">{selectedDayAvailability.slotDurationMinutes || "—"} min</strong>
                Consultation duration
              </span>
              <span>
                <strong className="block text-slate-950">{selectedDayAvailability.bufferMinutes || 0} min</strong>
                Buffer between patients
              </span>
              <span>
                <strong className="block text-slate-950">{selectedDayAvailability.emergencySlotsPerDay > 0 ? "Available" : "None"}</strong>
                Emergency slots (call reception)
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepPatient({ familyMembers, form, update }) {
  return (
    <div>
      <StepHeading icon={Users} title="Who is this appointment for?" help="Booking for a family member keeps everyone's records organized separately." />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => update({ familyMemberId: "" })}
          className={`rounded-2xl border-2 p-5 text-left transition ${
            !form.familyMemberId ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white/60 hover:border-slate-300"
          }`}
        >
          <UserIcon className="text-blue-600" size={22} />
          <p className="mt-2 font-black text-slate-950">Myself</p>
        </button>
        {familyMembers.map((member) => (
          <button
            key={member._id}
            type="button"
            onClick={() => update({ familyMemberId: member._id })}
            className={`rounded-2xl border-2 p-5 text-left transition ${
              form.familyMemberId === member._id ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white/60 hover:border-slate-300"
            }`}
          >
            <Users className="text-blue-600" size={22} />
            <p className="mt-2 font-black text-slate-950">{member.name}</p>
            <p className="text-xs text-slate-500 capitalize">{member.relation} • {member.age} yrs</p>
          </button>
        ))}
      </div>
      <Link to="/patient/family" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-blue-600">
        <PlusCircle size={14} /> Add a new family member
      </Link>
    </div>
  );
}

function StepReason({ form, update, toggleSymptom }) {
  return (
    <div>
      <StepHeading icon={HeartPulse} title="What brings you in?" help="This helps the doctor prepare before your visit — the more specific, the better." />

      <p className="mb-2 mt-4 text-xs font-black uppercase tracking-wide text-slate-400">Primary concern</p>
      <div className="flex flex-wrap gap-2">
        {[...COMMON_CONCERNS, "Other"].map((concern) => (
          <button
            key={concern}
            type="button"
            onClick={() => update({ reason: concern })}
            className={`rounded-full border-2 px-4 py-2 text-xs font-bold transition ${
              form.reason === concern ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            {concern}
          </button>
        ))}
      </div>
      {form.reason === "Other" && (
        <Input
          className="mt-3"
          placeholder="Briefly describe the reason for your visit"
          value={form.customReason}
          onChange={(e) => update({ customReason: e.target.value })}
        />
      )}

      <p className="mb-2 mt-6 text-xs font-black uppercase tracking-wide text-slate-400">Symptoms (optional)</p>
      <div className="flex flex-wrap gap-2">
        {COMMON_SYMPTOMS.map((symptom) => (
          <button
            key={symptom}
            type="button"
            onClick={() => toggleSymptom(symptom)}
            className={`rounded-full border-2 px-4 py-2 text-xs font-bold transition ${
              form.symptoms.includes(symptom) ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            {symptom}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Input
          label="How long have you had these symptoms?"
          placeholder="e.g. 3 days"
          value={form.symptomDuration}
          onChange={(e) => update({ symptomDuration: e.target.value })}
        />
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">Pain level: {form.painLevel}/10</span>
          <input
            type="range"
            min={0}
            max={10}
            value={form.painLevel}
            onChange={(e) => update({ painLevel: Number(e.target.value) })}
            className="w-full accent-blue-600"
          />
        </label>
      </div>

      <label className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-700">
        <input
          type="checkbox"
          checked={form.hasPreviousConsultation}
          onChange={(e) => update({ hasPreviousConsultation: e.target.checked })}
          className="h-4 w-4 accent-blue-600"
        />
        I've consulted a doctor about this before
      </label>
    </div>
  );
}

function StepMedicalHistory({ form, update, selectedFamilyMember }) {
  return (
    <div>
      <StepHeading
        icon={Stethoscope}
        title="Medical history"
        help="Shared only with your doctor — this helps them avoid interactions and prepare the right care."
      />
      <div className="mt-4 grid gap-4">
        <Input
          label="Existing medical conditions (comma separated)"
          placeholder={selectedFamilyMember?.medicalConditions?.length ? selectedFamilyMember.medicalConditions.join(", ") : "e.g. Diabetes, Hypertension"}
          value={form.existingConditions}
          onChange={(e) => update({ existingConditions: e.target.value })}
        />
        <Input
          label="Current medications (comma separated)"
          placeholder="e.g. Metformin 500mg"
          value={form.currentMedications}
          onChange={(e) => update({ currentMedications: e.target.value })}
        />
        <Input
          label="Allergies (comma separated)"
          placeholder="e.g. Penicillin"
          value={form.allergies}
          onChange={(e) => update({ allergies: e.target.value })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Preferred language for consultation"
            placeholder="e.g. English, Hindi"
            value={form.preferredLanguage}
            onChange={(e) => update({ preferredLanguage: e.target.value })}
          />
          <Input
            label="Special assistance required (optional)"
            placeholder="e.g. Wheelchair access"
            value={form.specialAssistance}
            onChange={(e) => update({ specialAssistance: e.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Emergency contact name"
            value={form.emergencyContactName}
            onChange={(e) => update({ emergencyContactName: e.target.value })}
          />
          <Input
            label="Emergency contact phone"
            value={form.emergencyContactPhone}
            onChange={(e) => update({ emergencyContactPhone: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function StepReports({ reports, form, toggleReport, reportUpload, setReportUpload, uploadNewReport, isUploadingReport }) {
  return (
    <div>
      <StepHeading icon={FileText} title="Attach relevant reports" help="Optional, but sharing recent reports helps the doctor prepare before you arrive." />

      {reports.length > 0 && (
        <div className="mt-4 space-y-2">
          {reports.map((report) => (
            <label
              key={report._id}
              className={`flex cursor-pointer items-center justify-between rounded-xl border-2 p-3 text-sm transition ${
                form.reportIds.includes(report._id) ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white/60"
              }`}
            >
              <span>
                <span className="font-bold text-slate-900">{report.title}</span>
                <span className="ml-2 text-xs text-slate-500">{report.category}</span>
              </span>
              <input
                type="checkbox"
                checked={form.reportIds.includes(report._id)}
                onChange={() => toggleReport(report._id)}
                className="h-4 w-4 accent-blue-600"
              />
            </label>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-4">
        <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-400">Upload a new report</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Title" value={reportUpload.title} onChange={(e) => setReportUpload((p) => ({ ...p, title: e.target.value }))} />
          <Input placeholder="Category (e.g. Blood Test)" value={reportUpload.category} onChange={(e) => setReportUpload((p) => ({ ...p, category: e.target.value }))} />
          <Input type="date" value={reportUpload.reportDate} onChange={(e) => setReportUpload((p) => ({ ...p, reportDate: e.target.value }))} />
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => setReportUpload((p) => ({ ...p, file: e.target.files?.[0] || null }))}
            className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm"
          />
        </div>
        <Button className="mt-3" variant="secondary" onClick={uploadNewReport} isLoading={isUploadingReport}>
          <Upload size={14} /> Upload & attach
        </Button>
        <p className="mt-2 text-[11px] text-slate-400">PDF, PNG, or JPG — up to 8MB.</p>
      </div>
    </div>
  );
}

function StepInsurance({ insurancePolicies, form, update, showInsuranceForm, setShowInsuranceForm, insuranceForm, setInsuranceForm, saveNewInsurance, isSavingInsurance }) {
  return (
    <div>
      <StepHeading icon={ShieldCheck} title="Insurance (optional)" help="Attach a policy if you'd like the visit referenced against your coverage." />

      <div className="mt-4 space-y-2">
        <label
          className={`flex cursor-pointer items-center justify-between rounded-xl border-2 p-3 text-sm transition ${
            !form.insuranceId ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white/60"
          }`}
        >
          <span className="font-bold text-slate-900">No insurance for this visit</span>
          <input type="radio" checked={!form.insuranceId} onChange={() => update({ insuranceId: "" })} className="h-4 w-4 accent-blue-600" />
        </label>
        {insurancePolicies.map((policy) => (
          <label
            key={policy._id}
            className={`flex cursor-pointer items-center justify-between rounded-xl border-2 p-3 text-sm transition ${
              form.insuranceId === policy._id ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white/60"
            }`}
          >
            <span>
              <span className="font-bold text-slate-900">{policy.provider}</span>
              <span className="ml-2 text-xs text-slate-500">Policy #{policy.policyNumber}</span>
            </span>
            <input type="radio" checked={form.insuranceId === policy._id} onChange={() => update({ insuranceId: policy._id })} className="h-4 w-4 accent-blue-600" />
          </label>
        ))}
      </div>

      {!showInsuranceForm ? (
        <button type="button" onClick={() => setShowInsuranceForm(true)} className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-blue-600">
          <PlusCircle size={14} /> Add a new insurance policy
        </button>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Provider" value={insuranceForm.provider} onChange={(e) => setInsuranceForm((p) => ({ ...p, provider: e.target.value }))} />
            <Input placeholder="Policy number" value={insuranceForm.policyNumber} onChange={(e) => setInsuranceForm((p) => ({ ...p, policyNumber: e.target.value }))} />
            <Input placeholder="Policy holder name" value={insuranceForm.policyHolder} onChange={(e) => setInsuranceForm((p) => ({ ...p, policyHolder: e.target.value }))} />
            <Input type="date" placeholder="Valid till" value={insuranceForm.validTill} onChange={(e) => setInsuranceForm((p) => ({ ...p, validTill: e.target.value }))} />
          </div>
          <Button className="mt-3" variant="secondary" onClick={saveNewInsurance} isLoading={isSavingInsurance}>
            Save policy
          </Button>
        </div>
      )}
    </div>
  );
}

function StepReview({ doctor, form, update, selectedFamilyMember, insurancePolicies, reports }) {
  const selectedPolicy = insurancePolicies.find((p) => p._id === form.insuranceId);
  const attachedReports = reports.filter((r) => form.reportIds.includes(r._id));
  const reasonText = form.reason === "Other" ? form.customReason : form.reason;

  return (
    <div>
      <StepHeading icon={CheckCircle2} title="Review your request" help="Please confirm everything looks right before sending it to the doctor." />

      <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white/60 p-4 text-sm">
        <ReviewLine label="Doctor" value={`Dr. ${doctor?.name} — ${doctor?.specialization}`} />
        {doctor?.hospitalName && <ReviewLine label="Hospital" value={doctor.hospitalName} />}
        <ReviewLine label="Consultation mode" value={doctorModeLabel(form.consultationMode)} />
        <ReviewLine label="Date & time" value={`${formatDisplayDate(form.date)} • ${form.timeSlot}`} />
        <ReviewLine label="Patient" value={form.familyMemberId ? `${selectedFamilyMember?.name} (${selectedFamilyMember?.relation})` : "Myself"} />
        <ReviewLine label="Reason" value={reasonText || "—"} />
        {form.symptoms.length > 0 && <ReviewLine label="Symptoms" value={form.symptoms.join(", ")} />}
        {form.allergies && <ReviewLine label="Allergies" value={form.allergies} />}
        <ReviewLine label="Reports attached" value={attachedReports.length ? attachedReports.map((r) => r.title).join(", ") : "None"} />
        <ReviewLine label="Insurance" value={selectedPolicy ? `${selectedPolicy.provider} (#${selectedPolicy.policyNumber})` : "None"} />
        <ReviewLine label="Consultation fee" value={`₹${doctor?.fees ?? 0}`} />
      </div>

      <div className="mt-5 space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-slate-600">
        <p className="font-bold text-slate-800">Before you confirm</p>
        <p>• This sends a request — the doctor must approve it before payment opens.</p>
        <p>• You can cancel anytime before payment at no cost from My Appointments.</p>
        <p>• Once approved, you'll receive a notification and can pay securely to lock in the slot.</p>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm font-semibold text-slate-700">
        <input
          type="checkbox"
          checked={form.consentAccepted}
          onChange={(e) => update({ consentAccepted: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-blue-600"
        />
        <span>I confirm the information above is accurate and I agree to the applicable appointment terms.</span>
      </label>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Please review the <Link to="/terms" className="font-bold text-blue-700 underline-offset-4 hover:underline">Terms of Service</Link>, <Link to="/privacy-policy" className="font-bold text-blue-700 underline-offset-4 hover:underline">Privacy Policy</Link>, and <Link to="/medical-disclaimer" className="font-bold text-blue-700 underline-offset-4 hover:underline">Medical Disclaimer</Link>.
      </p>
    </div>
  );
}

function ReviewLine({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[65%] text-right font-bold text-slate-900">{value}</span>
    </div>
  );
}

function StepHeading({ icon: Icon, title, help }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600">
          <Icon size={18} />
        </span>
        <h2 className="text-xl font-black text-slate-950">{title}</h2>
      </div>
      {help && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
          <Info size={13} className="mt-0.5 flex-shrink-0" /> {help}
        </p>
      )}
    </div>
  );
}

function ConfirmationScreen({ appointment, doctor, form, navigate }) {
  const handleDownloadCalendar = () => {
    downloadAppointmentICS({
      date: appointment.date,
      timeSlot: appointment.timeSlot,
      doctorName: doctor?.name,
      specialization: doctor?.specialization,
      hospitalName: doctor?.hospitalName,
      consultationMode: form.consultationMode,
      reason: appointment.reason,
    });
  };

  const handleShare = async () => {
    const text = `Appointment requested with Dr. ${doctor?.name} on ${formatDisplayDate(form.date)} at ${form.timeSlot}.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Appointment request", text });
        return;
      } catch {
        // user cancelled share sheet — fall through to clipboard
      }
    }
    await navigator.clipboard?.writeText(text);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <div className="flex flex-col items-center text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 size={32} />
          </span>
          <h1 className="mt-4 text-2xl font-black text-slate-950">Request sent to Dr. {doctor?.name}</h1>
          <p className="mt-2 text-sm text-slate-500">
            You'll get a notification the moment the doctor approves — then you can complete secure payment to lock in your slot.
          </p>
        </div>

        <div className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-white/60 p-4 text-sm">
          <ReviewLine label="Date & time" value={`${formatDisplayDate(form.date)} • ${form.timeSlot}`} />
          <ReviewLine label="Consultation mode" value={doctorModeLabel(form.consultationMode)} />
          <ReviewLine label="Status" value="Awaiting doctor approval" />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" onClick={handleDownloadCalendar}>
            <CalendarDays size={16} /> Add to calendar
          </Button>
          <Button variant="secondary" onClick={handleShare}>
            <Star size={16} /> Share appointment
          </Button>
        </div>

        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-slate-600">
          <p className="font-bold text-slate-800">What happens next</p>
          <p className="mt-1">1. The doctor reviews and approves your request (usually within a few hours).</p>
          <p>2. You'll be notified here and by email — then payment opens on your appointment.</p>
          <p>3. Once paid, you're all set — arrive 10 minutes early or join your video call on time.</p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button className="flex-1 justify-center" onClick={() => navigate("/patient/appointments")}>
            View my appointments
          </Button>
          <Button className="flex-1 justify-center" variant="secondary" onClick={() => navigate("/patient/doctors")}>
            Continue browsing
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default BookAppointment;
