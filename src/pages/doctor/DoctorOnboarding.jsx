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

import { useEffect, useState } from "react";

import { doctorApi } from "../../api/doctorApi";
import { masterDataApi } from "../../api/masterDataApi";
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

  city: "",
  cityMasterId: "",
  cityType: "MASTER",
  cityOther: "",
  state: "",
  stateMasterId: "",
  stateType: "MASTER",
  stateOther: "",
  district: "",
  districtMasterId: "",
  districtType: "MASTER",
  districtOther: "",
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
  const [master, setMaster] = useState({ specializations: [], states: [], districts: [], cities: [] });
  const [masterLoading, setMasterLoading] = useState(true);

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
        specializationType: doctor.specializationType || "OTHER",
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

        city:
          doctor.city || "",


        state:
          doctor.state || "",

        district:
          doctor.district || "",

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
    Promise.all([masterDataApi.getSpecializations(), masterDataApi.getStates()])
      .then(([specializations, states]) => {
        if (active) setMaster((current) => ({ ...current, specializations: Array.isArray(specializations) ? specializations : [], states: Array.isArray(states) ? states : [] }));
      })
      .catch(() => {})
      .finally(() => { if (active) setMasterLoading(false); });
    loadProfile();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!form.stateMasterId) {
      setMaster((current) => ({ ...current, districts: [], cities: [] }));
      return;
    }
    masterDataApi.getDistricts(form.stateMasterId).then((response) => {
      setMaster((current) => ({ ...current, districts: Array.isArray(response) ? response : [], cities: [] }));
    }).catch(() => {});
  }, [form.stateMasterId]);

  useEffect(() => {
    if (!form.districtMasterId) {
      setMaster((current) => ({ ...current, cities: [] }));
      return;
    }
    masterDataApi.getCities(form.districtMasterId).then((response) => {
      setMaster((current) => ({ ...current, cities: Array.isArray(response) ? response : [] }));
    }).catch(() => {});
  }, [form.districtMasterId]);

  const updateField = (e) => {
    const { name, value } = e.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const selectMaster = (field, id) => {
    const typeField = `${field}Type`;
    const idField = `${field}MasterId`;
    const otherField = `${field}Other`;
    const item = (master[field === "specialization" ? "specializations" : `${field}s`] || []).find((entry) => String(entry._id) === String(id));
    setForm((current) => ({
      ...current,
      [idField]: id,
      [typeField]: "MASTER",
      [otherField]: "",
      [field]: item?.name || "",
      ...(field === "state" ? { districtMasterId: "", districtType: "MASTER", districtOther: "", district: "", cityMasterId: "", cityType: "MASTER", cityOther: "", city: "" } : {}),
      ...(field === "district" ? { cityMasterId: "", cityType: "MASTER", cityOther: "", city: "" } : {}),
    }));
  };

  const selectOther = (field) => {
    const typeField = `${field}Type`;
    const idField = `${field}MasterId`;
    setForm((current) => ({ ...current, [typeField]: "OTHER", [idField]: "", [field]: "Other" }));
  };

  const submitForm = async (e) => {
    e.preventDefault();

    try {
      setSaving(true);

      const payload = {
        ...form,

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
              <span className="mb-2 block text-sm font-semibold text-slate-700">{t("common.specialization")}</span>
              <select value={form.specializationType === "OTHER" ? "__other__" : form.specializationMasterId} onChange={(e) => e.target.value === "__other__" ? selectOther("specialization") : selectMaster("specialization", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                <option value="">Select specialization</option>
                {master.specializations.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                <option value="__other__">Other</option>
              </select>
              {form.specializationType === "OTHER" && <Input label="Other specialization" name="specializationOther" value={form.specializationOther} onChange={updateField} />}
            </label>

            <Input
              label={t("common.qualification")}
              name="qualification"
              value={form.qualification}
              onChange={updateField}
            />

            <Input
              label="College Name"
              name="collegeName"
              value={form.collegeName}
              onChange={updateField}
            />

            <Input
              label="Graduation Year"
              name="graduationYear"
              type="number"
              value={form.graduationYear}
              onChange={updateField}
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
            />

            <Input
              label="License Number"
              name="licenseNumber"
              value={form.licenseNumber}
              onChange={updateField}
            />

          </div>
        </Card>

        <Card title="Location">

          <div className="grid gap-4 md:grid-cols-2">

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">State</span>
              <select value={form.stateType === "OTHER" ? "__other__" : form.stateMasterId} onChange={(e) => e.target.value === "__other__" ? selectOther("state") : selectMaster("state", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                <option value="">Select state</option>
                {master.states.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                <option value="__other__">Other</option>
              </select>
              {form.stateType === "OTHER" && <Input label="Other state" name="stateOther" value={form.stateOther} onChange={updateField} />}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">District</span>
              <select disabled={form.stateType !== "MASTER" || !form.stateMasterId} value={form.districtType === "OTHER" ? "__other__" : form.districtMasterId} onChange={(e) => e.target.value === "__other__" ? selectOther("district") : selectMaster("district", e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm disabled:bg-slate-100">
                <option value="">Select district</option>
                {master.districts.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
                <option value="__other__">Other</option>
              </select>
              {form.districtType === "OTHER" && <Input label="Other district" name="districtOther" value={form.districtOther} onChange={updateField} />}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">City</span>
              <Input
                label=""
                name="city"
                value={form.city || ""}
                disabled={form.districtType !== "MASTER" || !form.districtMasterId}
                placeholder="Enter city"
                onChange={(e) => setForm((current) => ({
                  ...current,
                  city: e.target.value,
                  cityMasterId: "",
                  cityType: "OTHER",
                  cityOther: e.target.value,
                }))}
              />
              {form.districtType === "MASTER" && form.districtMasterId && (
                <p className="mt-1 text-xs text-slate-500">If the city exactly matches a canonical city in the selected district, it will be saved as MasterData; otherwise it will be saved as Other.</p>
              )}
            </label>

          </div>

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
          disabled={saving || status === "pending" || status === "approved"}
        >
          {status === "pending" ? "Application Under Review" : status === "approved" ? "Application Approved" : "Submit For Verification"}
        </Button>

      </form>
    </div>
  );
}

export default DoctorOnboarding;