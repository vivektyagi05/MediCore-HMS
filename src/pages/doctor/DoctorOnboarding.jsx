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
import { getApiErrorMessage } from "../../api/axios";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";

import { useToast } from "../../context/ToastContext";


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
  state: "",

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
      "Document uploaded"
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

  useEffect(() => {
    loadProfile();
  }, []);

  const updateField = (e) => {
    const { name, value } = e.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
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

      toast.success(
        "Profile submitted for verification"
      );

      setStatus("pending");

      const user = JSON.parse(
        localStorage.getItem(
          "hms_user"
        ) || "{}"
      );

      user.doctorOnboardingStatus =
        "pending";

      localStorage.setItem(
        "hms_user",
        JSON.stringify(user)
      );
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
      <Loader label="Loading onboarding profile" />
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
          Verification Pending.
          Admin review is required.
        </div>
      )}

      <form
        onSubmit={submitForm}
        className="space-y-6"
      >

        <Card
          title="Professional Information"
        >
          <div className="grid gap-4 md:grid-cols-2">

            <Input
              label="Specialization"
              name="specialization"
              value={form.specialization}
              onChange={updateField}
            />

            <Input
              label="Qualification"
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

            <Input
              label="City"
              name="city"
              value={form.city}
              onChange={updateField}
            />

            <Input
              label="State"
              name="state"
              value={form.state}
              onChange={updateField}
            />

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
        >
          Submit For Verification
        </Button>

      </form>
    </div>
  );
}

export default DoctorOnboarding;