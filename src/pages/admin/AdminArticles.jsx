import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Textarea from "../../components/ui/Textarea";
import Select from "../../components/ui/Select";
import StatusBadge from "../../components/ui/StatusBadge";
import SectionHeader from "../../components/ui/SectionHeader";
import RichTextEditor from "../../components/cms/RichTextEditor";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const empty = { title:"", slug:"", excerpt:"", content:"", category:"", tags:"", relatedServices:[], relatedSpecialties:"", relatedDoctors:[], status:"draft", visibility:"public", bannerImage:"", seo:{title:"",description:"",canonical:"",robots:"index,follow"}, localizedContent:{hi:{},hinglish:{}} };
const lines = (x) => String(x || "").split("\n").map((v) => v.trim()).filter(Boolean);
const toForm = (a) => ({ ...empty, ...a, tags:(a.tags || []).join("\n"), relatedSpecialties:(a.relatedSpecialties || []).join("\n"), relatedServices:(a.relatedServices || []).map((x) => x._id || x), relatedDoctors:(a.relatedDoctors || []).map((x) => x._id || x), seo:{...empty.seo,...(a.seo || {})} });

export default function AdminArticles() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [rows,setRows]=useState([]), [doctors,setDoctors]=useState([]), [services,setServices]=useState([]), [filters,setFilters]=useState({search:"",category:"",status:""});
  const [open,setOpen]=useState(false), [editing,setEditing]=useState(null), [preview,setPreview]=useState(null), [previewLoading,setPreviewLoading]=useState(false);
  const [form,setForm]=useState(empty), [loading,setLoading]=useState(true), [saving,setSaving]=useState(false), [mutating,setMutating]=useState(""), [error,setError]=useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [a,d,s] = await Promise.all([
        adminApi.getCMSPages({ contentType:"article", status:filters.status || undefined, category:filters.category || undefined, search:filters.search || undefined, limit:50 }),
        adminApi.getDoctorsAdmin({limit:100}), adminApi.getServices({limit:100}),
      ]);
      setRows(a.data?.pages || []); setDoctors(d.data?.doctors || []); setServices(s.data?.services || []);
    } catch (e) { setError(getApiErrorMessage(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filters.status, filters.category, filters.search]);

  const categories = useMemo(() => [...new Set(rows.map((a) => a.category).filter(Boolean))].sort(), [rows]);
  const setField = (key, value) => setForm((current) => ({...current, [key]:value}));
  const save = async () => {
    setSaving(true);
    try {
      const payload = {...form, tags:lines(form.tags), relatedSpecialties:lines(form.relatedSpecialties), contentType:"article"};
      const response = editing ? await adminApi.updateCMSPage(editing._id,payload) : await adminApi.saveCMSPage(payload);
      const persisted = response.data?.page;
      if (!persisted?._id) throw new Error("The server did not return the persisted article record.");
      await load();
      setEditing(persisted); setForm(toForm(persisted)); setOpen(false);
      toast.success(t("p19.articles.saved"));
    } catch (e) { toast.error(getApiErrorMessage(e)); } finally { setSaving(false); }
  };
  const previewArticle = async (a) => {
    setPreviewLoading(true);
    try { const r=await adminApi.previewCMSPage(a._id,locale); setPreview(r.data?.article || null); }
    catch(e){toast.error(getApiErrorMessage(e));} finally{setPreviewLoading(false);}
  };
  const mutate = async (action, a) => {
    setMutating(`${action}:${a._id}`);
    try {
      const response = action === "publish" ? await adminApi.publishCMSPage(a._id) : action === "archive" ? await adminApi.archiveCMSPage(a._id) : await adminApi.updateCMSPage(a._id,{status:"review"});
      if (!response.data?.page) throw new Error("The server did not return the persisted article state.");
      await load();
      toast.success(t(`p19.articles.${action}Message`));
    } catch(e){toast.error(getApiErrorMessage(e));} finally{setMutating("");}
  };
  const remove = async (a) => {
    if (!window.confirm(t("p19.articles.deleteConfirm"))) return;
    setMutating(`delete:${a._id}`);
    try { await adminApi.deleteCMSPage(a._id); await load(); toast.success(t("p19.articles.deletedMessage")); }
    catch(e){toast.error(getApiErrorMessage(e));} finally{setMutating("");}
  };
  const uploadBanner = async (file) => {
    if (!file) return;
    setMutating("upload");
    try { const r=await adminApi.uploadCMSBanner(file); setField("bannerImage",r.data?.url || ""); toast.success(t("p19.articles.imageUploaded")); }
    catch(e){toast.error(getApiErrorMessage(e));} finally{setMutating("");}
  };

  return <div className="space-y-6">
    <SectionHeader eyebrow={t("p19.articles.title")} title={t("p19.articles.subtitle")} action={<Button onClick={()=>{setEditing(null);setForm({...empty});setOpen(true);}}>{t("p19.articles.new")}</Button>} />
    <Card><div className="grid gap-3 md:grid-cols-3"><Input label={t("p19.articles.search")} value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/><Select label={t("p19.articles.category")} value={filters.category} onChange={e=>setFilters({...filters,category:e.target.value})}><option value="">{t("p19.articles.allCategories")}</option>{categories.map(c=><option key={c}>{c}</option>)}</Select><Select label={t("p19.articles.publishing")} value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">{t("p19.articles.allStatuses")}</option>{["draft","review","published","archived"].map(x=><option key={x}>{t(`p19.articles.${x}`)}</option>)}</Select></div></Card>
    {error&&<Card><div role="alert" className="text-sm font-semibold text-rose-700">{error} <Button variant="secondary" size="sm" onClick={load}>{t("p19.common.retry")}</Button></div></Card>}
    <div className="grid gap-4">{loading?<Card>{t("p19.common.loading")}</Card>:rows.length?rows.map(a=><Card key={a._id}><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-black">{a.title}</h2><StatusBadge tone={a.status==="published"?"success":a.status==="review"?"warning":"neutral"}>{t(`p19.articles.${a.status||"draft"}`)}</StatusBadge></div><p className="mt-1 text-sm text-slate-500">{a.category||"—"} · /{a.slug}</p><p className="mt-2 max-w-3xl text-sm text-slate-600">{a.excerpt||a.content?.replace(/<[^>]+>/g," ").slice(0,180)}</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={()=>{setEditing(a);setForm(toForm(a));setOpen(true)}}>{t("p19.articles.edit")}</Button>{a.status==="draft"&&<Button variant="secondary" size="sm" disabled={mutating===`review:${a._id}`} onClick={()=>mutate("review",a)}>{t("p19.articles.review")}</Button>}{a.status!=="published"&&<Button size="sm" disabled={mutating===`publish:${a._id}`} onClick={()=>mutate("publish",a)}>{t("p19.articles.publish")}</Button>}{a.status!=="archived"&&<Button variant="secondary" size="sm" disabled={mutating===`archive:${a._id}`} onClick={()=>mutate("archive",a)}>{t("p19.articles.archive")}</Button>}<Button variant="secondary" size="sm" disabled={previewLoading} onClick={()=>previewArticle(a)}>{t("p19.articles.preview")}</Button><Button variant="danger" size="sm" disabled={mutating===`delete:${a._id}`} onClick={()=>remove(a)}>{t("p19.articles.delete")}</Button></div></div></Card>):<Card>{t("p19.articles.empty")}</Card>}</div>
    {preview&&<Card><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black">{t("p19.articles.preview")}</h2><Button variant="secondary" onClick={()=>setPreview(null)}>{t("p19.common.cancel")}</Button></div><article className="rounded-2xl border bg-white p-6"><p className="text-xs font-black uppercase tracking-widest text-orange-600">{preview.category}</p><h3 className="mt-2 text-3xl font-black">{preview.title}</h3>{preview.excerpt&&<p className="mt-3 text-sm text-slate-600">{preview.excerpt}</p>}{preview.bannerImage&&<img src={preview.bannerImage} alt={preview.title} className="mt-5 max-h-80 w-full rounded-2xl object-cover"/>}<div className="prose mt-6 max-w-none" dangerouslySetInnerHTML={{__html:preview.content||""}} /></article></Card>}
    {open&&<Card><div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-black">{editing?t("p19.articles.edit"):t("p19.articles.new")}</h2><p className="text-xs text-slate-500">{t("p19.articles.editorHint")}</p></div><Button variant="secondary" onClick={()=>setOpen(false)}>{t("p19.common.cancel")}</Button></div><div className="grid gap-6 lg:grid-cols-2"><section className="space-y-4"><h3 className="font-black">{t("p19.articles.content")}</h3><Input label={t("p19.articles.titleField")} required value={form.title} onChange={e=>setField("title",e.target.value)}/><Input label={t("p19.articles.slug")} value={form.slug} onChange={e=>setField("slug",e.target.value)} helperText={t("p19.articles.slugHint")}/><Textarea label={t("p19.articles.excerpt")} value={form.excerpt} onChange={e=>setField("excerpt",e.target.value)}/><RichTextEditor value={form.content} onChange={v=>setField("content",v)}/></section><section className="space-y-4"><h3 className="font-black">{t("p19.articles.metadata")}</h3><Input label={t("p19.articles.category")} required value={form.category} onChange={e=>setField("category",e.target.value)}/><Textarea label={t("p19.articles.tags")} value={form.tags} onChange={e=>setField("tags",e.target.value)}/><div><label className="mb-1.5 block text-sm font-semibold text-slate-700">{t("p19.articles.cover")}</label><div className="flex flex-wrap items-center gap-3"><label className="cursor-pointer rounded-xl border px-3 py-2 text-sm font-bold"><input type="file" accept="image/jpeg,image/png" className="sr-only" disabled={mutating==="upload"} onChange={e=>{uploadBanner(e.target.files?.[0]);e.target.value=""}}/>{mutating==="upload"?t("p19.common.loading"):t("p19.articles.uploadImage")}</label>{form.bannerImage&&<Button type="button" variant="secondary" size="sm" onClick={()=>setField("bannerImage","")}>{t("p19.articles.removeImage")}</Button>}</div>{form.bannerImage&&<img src={form.bannerImage} alt={t("p19.articles.coverPreview")} className="mt-3 h-40 w-full rounded-2xl object-cover"/>}</div><h3 className="pt-3 font-black">{t("p19.articles.related")}</h3><Input label={t("p19.articles.relatedSpecialties")} value={form.relatedSpecialties} onChange={e=>setField("relatedSpecialties",e.target.value)}/><label className="block text-sm font-semibold">{t("p19.articles.relatedDoctors")}<select multiple value={form.relatedDoctors} onChange={e=>setField("relatedDoctors",[...e.target.selectedOptions].map(o=>o.value))} className="mt-2 h-32 w-full rounded-xl border border-slate-200 p-2">{doctors.map(d=><option key={d._id} value={d._id}>{d.userId?.name||d.name||d._id}</option>)}</select></label><label className="block text-sm font-semibold">{t("p19.articles.relatedServices")}<select multiple value={form.relatedServices} onChange={e=>setField("relatedServices",[...e.target.selectedOptions].map(o=>o.value))} className="mt-2 h-32 w-full rounded-xl border border-slate-200 p-2">{services.map(s=><option key={s._id} value={s._id}>{s.title}</option>)}</select></label></section><section className="space-y-4"><h3 className="font-black">{t("p19.articles.seo")}</h3><Input label={t("p19.articles.seoTitle")} value={form.seo.title} onChange={e=>setField("seo",{...form.seo,title:e.target.value})}/><Textarea label={t("p19.articles.seoDescription")} value={form.seo.description} onChange={e=>setField("seo",{...form.seo,description:e.target.value})}/><Input label={t("p19.articles.canonical")} value={form.seo.canonical} onChange={e=>setField("seo",{...form.seo,canonical:e.target.value})}/><Select label={t("p19.articles.robots")} value={form.seo.robots} onChange={e=>setField("seo",{...form.seo,robots:e.target.value})}><option value="index,follow">index,follow</option><option value="noindex,nofollow">noindex,nofollow</option></Select><div className="grid gap-3 sm:grid-cols-2"><Select label={t("p19.articles.publishing")} value={form.status} onChange={e=>setField("status",e.target.value)}>{["draft","review","published","archived"].map(x=><option key={x}>{t(`p19.articles.${x}`)}</option>)}</Select><Select label={t("p19.articles.public")} value={form.visibility} onChange={e=>setField("visibility",e.target.value)}><option value="public">{t("p19.articles.public")}</option><option value="private">{t("p19.articles.private")}</option></Select></div><Button onClick={save} disabled={saving||mutating==="upload"}>{saving?t("p19.common.loading"):t("p19.articles.save")}</Button></section></div></Card>}
  </div>;
}
