import { useCallback, useEffect, useState } from "react";
import { Image, Plus, Trash2, RefreshCw, Save, Upload, X } from "lucide-react";
import { practiceApi } from "../../api/practiceApi";
import Button from "../../components/ui/Button";
import PracticeManagementNav from "../../components/practice/PracticeManagementNav";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const emptyEducation = { degree: "", institution: "", year: "" };
const emptyExperience = { title: "", organization: "", startYear: "", endYear: "", description: "" };
const emptyAward = { title: "", issuer: "", year: "" };
const emptyResearch = { title: "", year: "", link: "" };
const emptyMembership = { name: "", since: "" };
const emptyClinic = { name: "", address: "", city: "", state: "", district: "", phone: "", isPrimary: false };

function ListEditor({ title, items, setItems, empty, fields, addLabel, removeLabel }) {
  const update = (index, field, value) => {
    const next = [...items];
    next[index] = { ...next[index], [field]: value };
    setItems(next);
  };
  return (
    <div className="glass-card rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-black text-slate-950">{title}</h3>
        <button type="button" onClick={() => setItems([...items, { ...empty }])} className="flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700">
          <Plus size={14} /> {addLabel}
        </button>
      </div>
      {items.length === 0 && <p className="text-sm text-slate-400">—</p>}
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => f.type === "checkbox" ? (
                <label key={f.key} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={Boolean(item[f.key])} onChange={(e) => update(i, f.key, e.target.checked)} />
                  {f.label}
                </label>
              ) : (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-500">{f.label}</span>
                  <input
                    type={f.type || "text"}
                    value={item[f.key] ?? ""}
                    onChange={(e) => update(i, f.key, e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </label>
              ))}
            </div>
            <button type="button" onClick={() => setItems(items.filter((_, index) => index !== i))} className="mt-3 flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700">
              <Trash2 size={13} /> {removeLabel}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TagListEditor({ title, tags, setTags, placeholder, addLabel, removeLabel }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (value && !tags.includes(value)) setTags([...tags, value]);
    setDraft("");
  };
  return (
    <div className="glass-card rounded-2xl p-6 space-y-3">
      <h3 className="font-black text-slate-950">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">
            {tag}
            <button type="button" aria-label={`${removeLabel} ${tag}`} onClick={() => setTags(tags.filter((t) => t !== tag))} className="text-blue-500 hover:text-blue-800"><X size={12} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder} className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        <button type="button" onClick={add} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">{addLabel}</button>
      </div>
    </div>
  );
}

export default function DoctorProfessionalProfile() {
  const { t } = useI18n();
  const toast = useToast();
  const p = (key, vars) => t(`p18.${key}`, vars);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [error, setError] = useState(null);
  const [photoError, setPhotoError] = useState("");
  const [activeSection, setActiveSection] = useState("identity");
  const [baseline, setBaseline] = useState(null);
  const [profilePhoto, setProfilePhoto] = useState("");
  const [identity, setIdentity] = useState({
    specialization: "", qualification: "", collegeName: "", graduationYear: "",
    licenseNumber: "", medicalCouncil: "", hospitalName: "", city: "", state: "", district: "", bio: "",
  });
  const [languages, setLanguages] = useState([]);
  const [subSpecialties, setSubSpecialties] = useState([]);
  const [education, setEducation] = useState([]);
  const [experienceEntries, setExperienceEntries] = useState([]);
  const [awards, setAwards] = useState([]);
  const [researchPublications, setResearchPublications] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [insuranceAccepted, setInsuranceAccepted] = useState([]);

  const snapshot = (values = {}) => JSON.stringify(values);
  const currentSnapshot = () => snapshot({ identity, languages, subSpecialties, education, experienceEntries, awards, researchPublications, memberships, clinics, insuranceAccepted });
  const isDirty = baseline !== currentSnapshot();

  useEffect(() => {
    const handler = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await practiceApi.getProfessionalProfile();
      const d = res.data;
      setProfilePhoto(d.profilePhoto || "");
      setIdentity({
        specialization: d.specialization || "", qualification: d.qualification || "", collegeName: d.collegeName || "",
        graduationYear: d.graduationYear || "", licenseNumber: d.licenseNumber || "", medicalCouncil: d.medicalCouncil || "",
        hospitalName: d.hospitalName || "", city: d.city || "", state: d.state || "", district: d.district || "", bio: d.bio || "",
      });
      setLanguages(d.languages || []);
      setSubSpecialties(d.subSpecialties || []);
      setEducation(d.education || []); setExperienceEntries(d.experienceEntries || []);
      setAwards(d.awards || []); setResearchPublications(d.researchPublications || []);
      setMemberships(d.memberships || []); setClinics(d.clinics || []);
      setInsuranceAccepted(d.insuranceAccepted || []);
      setBaseline(snapshot({
        identity: {
          specialization: d.specialization || "", qualification: d.qualification || "", collegeName: d.collegeName || "",
          graduationYear: d.graduationYear || "", licenseNumber: d.licenseNumber || "", medicalCouncil: d.medicalCouncil || "",
          hospitalName: d.hospitalName || "", city: d.city || "", state: d.state || "", district: d.district || "", bio: d.bio || "",
        },
        languages: d.languages || [], subSpecialties: d.subSpecialties || [], education: d.education || [],
        experienceEntries: d.experienceEntries || [], awards: d.awards || [], researchPublications: d.researchPublications || [],
        memberships: d.memberships || [], clinics: d.clinics || [], insuranceAccepted: d.insuranceAccepted || [],
      }));
    } catch (err) {
      setError(err?.response?.data?.message || p("emptyError"));
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await practiceApi.updateProfessionalProfile({
        ...identity,
        graduationYear: identity.graduationYear === "" ? null : Number(identity.graduationYear),
        languages, subSpecialties, education, experienceEntries, awards,
        researchPublications, memberships, clinics, insuranceAccepted,
      });
      toast.success(p("saved"));
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || p("emptyError"));
    } finally { setSaving(false); }
  };

  const uploadPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setPhotoError(p("invalidPhoto")); return;
    }
    setPhotoError(""); setPhotoSaving(true);
    try {
      const res = await practiceApi.uploadProfilePhoto(file);
      if (!res?.success || !res.data?.profilePhoto) throw new Error(p("invalidPhoto"));
      setProfilePhoto(res.data.profilePhoto);
      toast.success(p("photoUpdated"));
    } catch (err) {
      setPhotoError(err?.response?.data?.message || p("invalidPhoto"));
    } finally { setPhotoSaving(false); }
  };

  const removePhoto = async () => {
    setPhotoSaving(true); setPhotoError("");
    try {
      await practiceApi.deleteProfilePhoto();
      setProfilePhoto("");
      toast.success(p("photoRemoved"));
    } catch (err) {
      setPhotoError(err?.response?.data?.message || p("emptyError"));
    } finally { setPhotoSaving(false); }
  };

  if (loading) return <div className="space-y-4 animate-pulse">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="glass-card h-40 rounded-2xl bg-slate-100" />)}</div>;
  if (error) return <div className="glass-card flex flex-col items-center justify-center gap-3 rounded-2xl py-16 text-center"><p className="text-sm font-semibold text-slate-500">{error}</p><button type="button" onClick={load} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"><RefreshCw size={14} /> {p("retry")}</button></div>;

  const field = (key, type = "text") => (
    <label key={key} className="block">
      <span className="mb-1 block text-xs font-bold text-slate-500">{p(key)}</span>
      <input type={type} value={identity[key]} onChange={(e) => setIdentity((v) => ({ ...v, [key]: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
    </label>
  );

  const sections = [
    ["identity", p("identity")],
    ["professional", p("credentials")],
    ["education", p("education")],
    ["experience", p("experience")],
    ["achievements", p("awards")],
    ["practice", p("clinics")],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-950">{p("title")}</h2>
          <p className="mt-1 text-sm text-slate-500">{p("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {isDirty && <span className="text-xs font-bold text-amber-700">{p("unsavedChanges")}</span>}
          <Button onClick={save} isLoading={saving} disabled={!isDirty}>
            <Save size={15} /> {p("save")}
          </Button>
        </div>
      </div>

      <PracticeManagementNav active="profile" />

      <nav aria-label={p("editorSections")} className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex min-w-max gap-1">
          {sections.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setActiveSection(key)}
              className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${activeSection === key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {label}
            </button>
          ))}
        </div>
      </nav>

      {activeSection === "identity" && (
        <div className="space-y-5">
          <div className="glass-card rounded-2xl p-6">
            <h3 className="flex items-center gap-2 font-black text-slate-950"><Image size={16} /> {p("photo")}</h3>
            <p className="mt-1 text-sm text-slate-500">{p("photoHint")}</p>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
              {profilePhoto ? <img src={profilePhoto} alt={p("profilePhotoAlt")} className="h-28 w-28 rounded-2xl object-cover ring-1 ring-slate-200" /> : <div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Image size={30} /></div>}
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white">
                  <Upload size={15} /> {profilePhoto ? p("replace") : p("upload")}
                  <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={uploadPhoto} disabled={photoSaving} />
                </label>
                {profilePhoto && <button type="button" onClick={removePhoto} disabled={photoSaving} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-rose-600 disabled:opacity-50">{p("delete")}</button>}
              </div>
            </div>
            {photoSaving && <p className="mt-3 text-xs font-semibold text-slate-500">{p("uploading")}</p>}
            {photoError && <p role="alert" className="mt-3 text-sm font-semibold text-rose-600">{photoError}</p>}
          </div>

          <div className="glass-card rounded-2xl p-6">
            <h3 className="font-black text-slate-950">{p("identity")}</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {field("specialization")}{field("qualification")}{field("collegeName")}{field("graduationYear","number")}
              {field("licenseNumber")}{field("medicalCouncil")}{field("hospitalName")}{field("city")}{field("state")}{field("district")}
            </div>
            <label className="mt-4 block"><span className="mb-1 block text-xs font-bold text-slate-500">{p("bio")}</span><textarea rows={6} value={identity.bio} onChange={(e) => setIdentity((v) => ({ ...v, bio: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" /></label>
            <div className="mt-4"><TagListEditor title={p("languages")} tags={languages} setTags={setLanguages} placeholder={p("languagePlaceholder")} addLabel={p("add")} removeLabel={p("remove")} /></div>
          </div>
        </div>
      )}

      {activeSection === "professional" && (
        <div className="space-y-5">
          <TagListEditor title={p("subspecialties")} tags={subSpecialties} setTags={setSubSpecialties} placeholder={p("specialtyPlaceholder")} addLabel={p("add")} removeLabel={p("remove")} />
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-900">
            {p("credentialChangeNotice")}
          </div>
        </div>
      )}

      {activeSection === "education" && (
        <ListEditor title={p("education")} items={education} setItems={setEducation} empty={emptyEducation} addLabel={p("add")} removeLabel={p("remove")}
          fields={[{key:"degree",label:p("degree")},{key:"institution",label:p("institution")},{key:"year",label:p("year"),type:"number"}]} />
      )}

      {activeSection === "experience" && (
        <ListEditor title={p("experience")} items={experienceEntries} setItems={setExperienceEntries} empty={emptyExperience} addLabel={p("add")} removeLabel={p("remove")}
          fields={[{key:"title",label:p("role")},{key:"organization",label:p("organization")},{key:"startYear",label:p("startYear"),type:"number"},{key:"endYear",label:p("endYear"),type:"number"},{key:"description",label:p("description")}]}/>
      )}

      {activeSection === "achievements" && (
        <div className="space-y-5">
          <ListEditor title={p("awards")} items={awards} setItems={setAwards} empty={emptyAward} addLabel={p("add")} removeLabel={p("remove")} fields={[{key:"title",label:p("itemTitle")},{key:"issuer",label:p("issuer")},{key:"year",label:p("year"),type:"number"}]}/>
          <ListEditor title={p("research")} items={researchPublications} setItems={setResearchPublications} empty={emptyResearch} addLabel={p("add")} removeLabel={p("remove")} fields={[{key:"title",label:p("itemTitle")},{key:"year",label:p("year"),type:"number"},{key:"link",label:p("link")}]}/>
          <ListEditor title={p("memberships")} items={memberships} setItems={setMemberships} empty={emptyMembership} addLabel={p("add")} removeLabel={p("remove")} fields={[{key:"name",label:p("membershipOrg")},{key:"since",label:p("since"),type:"number"}]}/>
          <TagListEditor title={p("insurance")} tags={insuranceAccepted} setTags={setInsuranceAccepted} placeholder={p("insurancePlaceholder")} addLabel={p("add")} removeLabel={p("remove")} />
        </div>
      )}

      {activeSection === "practice" && (
        <ListEditor title={p("clinics")} items={clinics} setItems={setClinics} empty={emptyClinic} addLabel={p("add")} removeLabel={p("remove")}
          fields={[{key:"name",label:p("clinicName")},{key:"address",label:p("address")},{key:"city",label:p("city")},{key:"district",label:p("district")},{key:"state",label:p("state")},{key:"phone",label:p("phone")},{key:"isPrimary",label:p("primary"),type:"checkbox"}]} />
      )}

      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving} disabled={!isDirty}><Save size={15} /> {p("save")}</Button>
      </div>
    </div>
  );



}
