import {
  Building2,
  GraduationCap,
  BriefcaseMedical,
  FileBadge,
  Globe,
  UserRound,
  Upload,
  FileText,
  CheckCircle,
} from "lucide-react";

import { useCallback, useEffect, useMemo, useState } from "react";

import { doctorApi } from "../../api/doctorApi";
import { masterDataApi } from "../../api/masterDataApi";
import DoctorLocationFields from "../../components/doctor/DoctorLocationFields";
import { EMPTY_LOCATION, LOCATION_KEYS, buildLocationPayload, locationFromDoctor } from "../../utils/doctorLocation";
import { getOnboardingMissingRequirements, describeMissingRequirements } from "../../utils/doctorOnboardingValidation";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";

import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";
import { useAuth } from "../../context/AuthContext";


const initialForm = {
  specialization: "",
  qualification: "",
  collegeName: "",
  graduationYear: "",

  experience: "",
  fees: "",

  hospitalName: "",

  medicalCouncil: "",
  licenseNumber: "",

  ...EMPTY_LOCATION,
  specializationMasterId: "",
  specializationType: "MASTER",
  specializationOther: "",

  languages: "",
  bio: "",
};



function DoctorOnboarding() {
  const [form, setForm] = useState(initialForm);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [status, setStatus] =
    useState("not_started");

  const [documents, setDocuments] =
    useState([]);
  const [master, setMaster] = useState({ specializations: [] });
  const [specializationsLoading, setSpecializationsLoading] = useState(true);
  const [specializationsError, setSpecializationsError] = useState(false);

  // ONB-001 frontend mirror (see src/utils/doctorOnboardingValidation.js):
  // errors only render once the doctor has tried to submit at least once,
  // so an empty fresh form doesn't open already covered in red.
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [locationStatus, setLocationStatus] = useState({ loading: true, error: false });

  const handleLocationStatusChange = useCallback((loading, error) => {
    setLocationStatus((prev) => (prev.loading === loading && prev.error === error ? prev : { loading, error }));
  }, []);

    const [uploading, setUploading] =
    useState(false);

  const loadProfile = async () => {
    try {
      const response =
        await doctorApi.getOnboarding();

    const docs =
      await doctorApi.getDocuments();

    setDocuments(
      docs.data.documents || []
    );

      const doctor =
        response?.data || {};

      setForm({
        specialization:
          doctor.specialization || "",
        specializationMasterId: doctor.specializationMasterId || "",
        specializationType: doctor.specializationMasterId ? "MASTER" : (doctor.specializationOther ? "OTHER" : "MASTER"),
        specializationOther: doctor.specializationOther || "",

        qualification:
          doctor.qualification || "",

        collegeName:
          doctor.collegeName || "",

        graduationYear:
          doctor.graduationYear || "",

        experience:
          doctor.experience || "",

        fees:
          doctor.fees || "",

        hospitalName:
          doctor.hospitalName || "",

        medicalCouncil:
          doctor.medicalCouncil || "",

        licenseNumber:
          doctor.licenseNumber || "",

        // Restores the canonical ids/types too; without them the saved
        // state/district vanished from the form after every refresh.
        ...locationFromDoctor(doctor),

        languages:
          doctor.languages?.join(", ") || "",

        bio:
          doctor.bio || "",
      });

      setStatus(
        doctor.verificationStatus ||
          "not_started"
      );
    } catch (error) {
      toast.error(
        getApiErrorMessage(error)
      );
    } finally {
      setLoading(false);
    }
  };

const uploadDocument =
  async (event) => {

  const file =
    event.target.files[0];

  if (!file) return;

  try {

    setUploading(true);

    const formData =
      new FormData();

    formData.append(
      "document",
      file
    );

    formData.append(
      "title",
      file.name
    );

    formData.append(
      "type",
      "certification"
    );

    await doctorApi.uploadDocument(
      formData
    );

    toast.success(
      t("ui.documentUploaded")
    );

    const docs =
      await doctorApi.getDocuments();

    setDocuments(
      docs.data.documents || []
    );

  } catch (error) {

    toast.error(
      getApiErrorMessage(error)
    );

  } finally {

    setUploading(false);

  }
};
  const toast = useToast();
  const { t } = useI18n();
  const { refreshUser } = useAuth();

  useEffect(() => {
    let active = true;
    masterDataApi.getSpecializations()
      .then((specializations) => {
        if (!active) return;
        setMaster({ specializations: Array.isArray(specializations) ? specializations : [] });
        setSpecializationsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSpecializationsLoading(false);
        setSpecializationsError(true);
      });
    loadProfile();
    return () => { active = false; };
  }, []);

  const updateField = (e) => {
    const { name, value } = e.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const selectMaster = (field, id) => {
    const item = master.specializations.find((entry) => String(entry._id) === String(id));
    setForm((current) => ({
      ...current,
      specializationMasterId: id,
      specializationType: "MASTER",
      specializationOther: "",
      specialization: item?.name || "",
    }));
  };

  const selectOther = () => {
    setForm((current) => ({ ...current, specializationType: "OTHER", specializationMasterId: "", specialization: "Other" }));
  };

  // ONB-001 frontend mirror. This changes UX only (what the doctor sees
  // before submitting) — the backend gate in
  // backend/controllers/doctorOnboardingController.js
  // (getOnboardingMissingRequirements) is the authoritative check and
  // rejects an incomplete submission independently of this.
  const missingFields = useMemo(
    () => getOnboardingMissingRequirements(form, documents),
    [form, documents],
  );
  const dependenciesLoading = locationStatus.loading || specializationsLoading;
  const dependenciesFailed = locationStatus.error || specializationsError;
  const hasError = (field) => attemptedSubmit && missingFields.includes(field);

  const submitForm = async (e) => {
    e.preventDefault();
    setAttemptedSubmit(true);

    // Duplicate-submit guard: the submit button is already disabled while
    // `saving`, but this closes the gap between a fast double-click/double-
    // Enter and that disabled state actually re-rendering.
    if (saving || status === "pending" || status === "approved") return;

    if (dependenciesLoading) {
      toast.warning("Please wait for specialization and location data to finish loading, then submit again.");
      return;
    }
    if (dependenciesFailed) {
      toast.error("Required reference data (specializations or location list) failed to load. Reload the page before submitting.");
      return;
    }
    if (missingFields.length > 0) {
      toast.error(`Required before you can submit: ${describeMissingRequirements(missingFields).join(", ")}.`);
      return;
    }

    try {
      setSaving(true);

      const payload = {
        ...form,
        ...buildLocationPayload(form),

        experience:
          Number(form.experience),

        fees:
          Number(form.fees),

        graduationYear:
          Number(
            form.graduationYear
          ),

        languages:
          form.languages
            .split(",")
            .map((item) =>
              item.trim()
            )
            .filter(Boolean),
      };

      await doctorApi.submitOnboarding(
        payload
      );

      toast.success("Application submitted successfully. Your profile is now under review.");
      setStatus("pending");
      await refreshUser();
    } catch (error) {
      toast.error(
        getApiErrorMessage(error)
      );
    } finally {
      setSaving(false);
    }
  };

  const locationValue = Object.fromEntries(LOCATION_KEYS.map((key) => [key, form[key] ?? ""]));

  if (loading) {
    return (
      <Loader label={t("ui.loadingOnboarding")} />
    );
  }

  return (
    <div className="space-y-6">

      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">
          Doctor Verification
        </p>

        <h1 className="mt-2 text-3xl font-black text-slate-950">
          Complete Doctor Onboarding
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          Fill your professional details.
          Your account will be reviewed
          by the hospital administration.
        </p>
      </div>

      {status === "pending" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-700">
          Application submitted successfully. Your profile is now under review.
          We will notify you when a decision is made.
        </div>
      )}

      {status === "approved" && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">
          Your doctor application is approved. Your approved-only clinical workspace is now available.
        </div>
      )}

      {status === "rejected" && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
          Your application was rejected. Update the information below and submit again for review.
        </div>
      )}

      <form
        onSubmit={submitForm}
        className="space-y-6"
      >

        <Card
          title={t("ui.professionalInfo")}
        >
          <div className="grid gap-4 md:grid-cols-2">

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                {t("common.specialization")}
                <span className="ml-1 text-rose-600">*</span>
              </span>
              <select
                value={form.specializationType === "OTHER" ? "__other__" : form.specializationMasterId}
                onChange={(e) => e.target.value === "__other__" ? selectOther() : selectMaster("specialization", e.target.value)}
                disabled={specializationsLoading}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">{specializationsLoading ? "Loading specializations…" : "Select specialization"}</option>
                {master.specializations.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                <option value="__other__">Other</option>
              </select>
              {form.specializationType === "OTHER" && <Input label="Other specialization" name="specializationOther" value={form.specializationOther} onChange={updateField} required />}
              {specializationsError && <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">Could not load the specialization list. Reload the page to retry.</p>}
              {hasError("specialization") && !specializationsError && <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">Specialization is required.</p>}
            </label>

            <Input
              label={t("common.qualification")}
              name="qualification"
              value={form.qualification}
              onChange={updateField}
              required
              error={hasError("qualification") ? "Qualification is required." : undefined}
            />

            <Input
              label="College Name"
              name="collegeName"
              value={form.collegeName}
              onChange={updateField}
              required
              error={hasError("collegeName") ? "College name is required." : undefined}
            />

            <Input
              label="Graduation Year"
              name="graduationYear"
              type="number"
              value={form.graduationYear}
              onChange={updateField}
              required
              error={hasError("graduationYear") ? "Graduation year is required." : undefined}
            />
          </div>
        </Card>

        <Card
          title="Experience & Fees"
        >
          <div className="grid gap-4 md:grid-cols-2">

            <Input
              label="Experience (Years)"
              name="experience"
              type="number"
              value={form.experience}
              onChange={updateField}
            />

            <Input
              label="Consultation Fees"
              name="fees"
              type="number"
              value={form.fees}
              onChange={updateField}
            />

            <Input
              label="Hospital Name"
              name="hospitalName"
              value={form.hospitalName}
              onChange={updateField}
            />

          </div>
        </Card>

        <Card
          title="Verification Details"
        >
          <div className="grid gap-4 md:grid-cols-2">

            <Input
              label="Medical Council"
              name="medicalCouncil"
              value={form.medicalCouncil}
              onChange={updateField}
              required
              error={hasError("medicalCouncil") ? "Medical council is required." : undefined}
            />

            <Input
              label="License Number"
              name="licenseNumber"
              value={form.licenseNumber}
              onChange={updateField}
              required
              error={hasError("licenseNumber") ? "License number is required." : undefined}
            />

          </div>
        </Card>

        <Card title="Location">
          <DoctorLocationFields
            value={locationValue}
            onChange={(next) => setForm((current) => ({ ...current, ...next }))}
            onStatusChange={handleLocationStatusChange}
          />
          {locationStatus.error && (
            <p role="alert" className="mt-3 text-xs font-medium text-rose-600">
              Could not load part of the location list. Reload the page before submitting.
            </p>
          )}
          {attemptedSubmit && !locationStatus.error && (hasError("state") || hasError("district") || hasError("city")) && (
            <p role="alert" className="mt-3 text-xs font-medium text-rose-600">
              {["state", "district", "city"].filter((f) => hasError(f)).map((f) => f[0].toUpperCase() + f.slice(1)).join(", ")} {hasError("state") && hasError("district") && hasError("city") ? "are" : "is"} required.
            </p>
          )}
        </Card>

        <Card title="Profile Details">

          <div className="grid gap-4">

            <Input
              label="Languages"
              placeholder="English, Hindi"
              name="languages"
              value={form.languages}
              onChange={updateField}
            />

            <label>

              <span className="mb-2 block text-sm font-semibold text-slate-700">
                Biography
              </span>

              <textarea
                rows="5"
                name="bio"
                value={form.bio}
                onChange={updateField}
                className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm"
              />

            </label>

          </div>

        </Card>

        <Card title="Documents">

            <div className="space-y-4">

                {hasError("documents") && (
                  <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-600">
                    Required verification documents are missing.
                  </p>
                )}

                <label
                className="
                flex
                items-center
                gap-3
                rounded-xl
                border-2
                border-dashed
                p-5
                cursor-pointer
                "
                >

                <Upload size={20} />

                <span>
                    Upload Degree /
                    License /
                    Certificate
                </span>

                <input
                    type="file"
                    className="hidden"
                    onChange={
                    uploadDocument
                    }
                />

                </label>

                {uploading && (
                <p>
                    Uploading...
                </p>
                )}

                <div className="space-y-2">

                {documents.map(
                    (doc) => (

                    <div
                        key={doc._id}
                        className="
                        flex
                        justify-between
                        rounded-xl
                        border
                        p-3
                        "
                    >

                        <div>

                        <p className="font-bold">
                            {doc.title}
                        </p>

                        <p className="text-xs text-slate-500">
                            {doc.type}
                        </p>

                        </div>

                        <CheckCircle
                        size={18}
                        className="
                        text-green-600
                        "
                        />

                    </div>

                    )
                )}

                </div>

            </div>

            </Card>

        <Button
          type="submit"
          isLoading={saving}
          disabled={saving || status === "pending" || status === "approved" || dependenciesLoading}
        >
          {status === "pending"
            ? "Application Under Review"
            : status === "approved"
              ? "Application Approved"
              : dependenciesLoading
                ? "Loading required data…"
                : "Submit For Verification"}
        </Button>

        {attemptedSubmit && !dependenciesLoading && !dependenciesFailed && missingFields.length > 0 && (
          <p role="alert" className="text-sm font-bold text-rose-600">
            Required before you can submit: {describeMissingRequirements(missingFields).join(", ")}.
          </p>
        )}

      </form>
    </div>
  );
}

export default DoctorOnboarding;