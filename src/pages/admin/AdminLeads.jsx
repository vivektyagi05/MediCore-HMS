import { useEffect, useState } from "react";
import { Eye, MessageSquare, Search } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import { leadApi } from "../../api/leadApi";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import AdminTable from "../../components/admin/AdminTable";
import AdminModal from "../../components/admin/AdminModal";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import ErrorState from "../../components/shared/ErrorState";
import SectionHeader from "../../components/ui/SectionHeader";
import StatusBadge from "../../components/ui/StatusBadge";

const statuses = ["new","acknowledged","in_progress","waiting_for_user","resolved","closed"];
const priorities = ["low","medium","high","urgent"];
const types = ["general","patient_support","doctor_support","hospital_partnership","business","technical","billing","privacy_data_rights","other"];
const tone = { new:"info", acknowledged:"info", in_progress:"warning", waiting_for_user:"warning", resolved:"success", closed:"neutral", low:"neutral", medium:"info", high:"warning", urgent:"danger" };

export default function AdminLeads() {
  const { t } = useI18n();
  const [filters, setFilters] = useState({ search:"", status:"", priority:"", inquiryType:"", assignedTo:"" });
  const [data, setData] = useState({ leads:[], pagination:null });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [selected, setSelected] = useState(null); const [admins, setAdmins] = useState([]); const [note, setNote] = useState("");

  const load = async (requestedPage = page) => { setLoading(true); setError(""); try { const r = await leadApi.list({ ...filters, page: requestedPage, limit:25 }); setData(r.data || { leads:[], pagination:null }); setPage(r.data?.pagination?.page || requestedPage); } catch(e){ setError(getApiErrorMessage(e) || t("p17.adminLeads.error")); } finally { setLoading(false); } };
  useEffect(()=>{ load(); adminApi.getAdmins().then(r=>setAdmins(r.data?.admins || r.data || [])).catch(()=>{}); }, []);
  const open = async (id) => { try { const r=await leadApi.get(id); setSelected(r.data); setNote(""); } catch(e){ setError(getApiErrorMessage(e) || t("p17.adminLeads.error")); } };
  const mutate = async (fn) => { try { const r=await fn(); setSelected(r.data); await load(); } catch(e){ setError(getApiErrorMessage(e) || t("p17.adminLeads.error")); } };
  const columns = [
    { key:"publicId", header:t("p17.adminLeads.reference"), render:r=><span className="font-bold">{r.publicId}</span> },
    { key:"name", header:t("p17.contact.name"), render:r=><div><p className="font-bold">{r.name}</p><p className="text-xs text-slate-500">{r.email}</p></div> },
    { key:"inquiryType", header:t("p17.adminLeads.inquiry"), render:r=>t(`p17.adminLeads.types.${r.inquiryType}`) },
    { key:"priority", header:t("p17.adminLeads.priority"), render:r=><StatusBadge tone={tone[r.priority] || "neutral"}>{t(`p17.adminLeads.priorities.${r.priority}`)}</StatusBadge> },
    { key:"status", header:t("p17.adminLeads.status"), render:r=><StatusBadge tone={tone[r.status] || "neutral"}>{t(`p17.adminLeads.statuses.${r.status}`)}</StatusBadge> },
    { key:"assignedTo", header:t("p17.adminLeads.assignedTo"), render:r=>r.assignedTo?.name || t("p17.adminLeads.unassigned") },
    { key:"createdAt", header:t("p17.adminLeads.date"), render:r=>new Date(r.createdAt).toLocaleString() },
    { key:"actions", header:"", render:r=><Button variant="secondary" size="sm" onClick={()=>open(r.id)}><Eye size={14}/></Button> },
  ];
  return <div className="space-y-6"><SectionHeader eyebrow={t("p17.adminLeads.title")} title={t("p17.adminLeads.title")} description={t("p17.adminLeads.description")} />
    <Card className="p-4"><div className="grid gap-3 md:grid-cols-5"><label className="md:col-span-1"><span className="sr-only">{t("p17.adminLeads.search")}</span><div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3"><Search size={15}/><input value={filters.search} onChange={e=>setFilters(f=>({...f,search:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&load()} placeholder={t("p17.adminLeads.search")} className="min-w-0 flex-1 border-0 py-2.5 text-sm outline-none"/></div></label><select aria-label={t("p17.adminLeads.status")} value={filters.status} onChange={e=>setFilters(f=>({...f,status:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">{t("p17.adminLeads.all")}</option>{statuses.map(v=><option key={v} value={v}>{t(`p17.adminLeads.statuses.${v}`)}</option>)}</select><select aria-label={t("p17.adminLeads.priority")} value={filters.priority} onChange={e=>setFilters(f=>({...f,priority:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">{t("p17.adminLeads.all")}</option>{priorities.map(v=><option key={v} value={v}>{t(`p17.adminLeads.priorities.${v}`)}</option>)}</select><select aria-label={t("p17.adminLeads.inquiry")} value={filters.inquiryType} onChange={e=>setFilters(f=>({...f,inquiryType:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">{t("p17.adminLeads.all")}</option>{types.map(v=><option key={v} value={v}>{t(`p17.adminLeads.types.${v}`)}</option>)}</select><select aria-label={t("p17.adminLeads.assignedTo")} value={filters.assignedTo} onChange={e=>setFilters(f=>({...f,assignedTo:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">{t("p17.adminLeads.all")}</option>{admins.map(a=><option key={a._id} value={a._id}>{a.name}</option>)}</select></div><div className="mt-3"><Button onClick={()=>load(1)}>{t("p17.adminLeads.search")}</Button></div></Card>
    {error && <ErrorState description={error} onRetry={()=>load(page)} retryLabel={t("p17.adminLeads.retry")}/>} {loading ? <Card className="p-8 text-center">{t("p17.adminLeads.loading")}</Card> : data.leads.length ? <AdminTable columns={columns} data={data.leads} rowKey="id" /> : <Card className="p-10 text-center text-sm text-slate-500">{t("p17.adminLeads.empty")}</Card>}
    {selected && <AdminModal isOpen onClose={()=>setSelected(null)} title={`${t("p17.adminLeads.detail")} · ${selected.publicId}`}><div className="max-h-[75vh] space-y-5 overflow-y-auto"><div><h3 className="font-black">{t("p17.adminLeads.contact")}</h3><p className="mt-2 text-sm">{selected.name} · {selected.email}{selected.phone ? ` · ${selected.phone}` : ""}</p></div><div><h3 className="font-black">{t("p17.adminLeads.enquiry")}</h3><p className="mt-2 text-sm font-semibold">{t(`p17.adminLeads.types.${selected.inquiryType}`)} · {selected.subject}</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{selected.message}</p></div><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-xs font-bold">{t("p17.adminLeads.statusLabel")}</span><select value={selected.status} onChange={e=>mutate(()=>leadApi.status(selected.id,e.target.value))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">{statuses.map(v=><option key={v} value={v}>{t(`p17.adminLeads.statuses.${v}`)}</option>)}</select></label><label><span className="mb-1 block text-xs font-bold">{t("p17.adminLeads.priorityLabel")}</span><select value={selected.priority} onChange={e=>mutate(()=>leadApi.priority(selected.id,e.target.value))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">{priorities.map(v=><option key={v} value={v}>{t(`p17.adminLeads.priorities.${v}`)}</option>)}</select></label></div><label><span className="mb-1 block text-xs font-bold">{t("p17.adminLeads.assignedTo")}</span><select value={selected.assignedTo?._id || selected.assignedTo || ""} onChange={e=>e.target.value&&mutate(()=>leadApi.assign(selected.id,e.target.value))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">{t("p17.adminLeads.all")}</option>{admins.map(a=><option key={a._id} value={a._id}>{a.name} · {a.role}</option>)}</select></label><div><h3 className="font-black">{t("p17.adminLeads.note")}</h3><textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm"/><Button disabled={!note.trim()} onClick={()=>mutate(async()=>{const r=await leadApi.note(selected.id,note.trim());setNote("");return r;})}><MessageSquare size={14}/>{t("p17.adminLeads.addNote")}</Button></div><div><h3 className="font-black">{t("p17.adminLeads.timeline")}</h3><div className="mt-2 space-y-2">{(selected.timeline||[]).map((e,i)=><div key={`${e.type}-${e.createdAt}-${i}`} className="rounded-lg border border-slate-200 p-3 text-xs"><p className="font-bold">{t(`p17.adminLeads.${e.type==='status_changed'?'statusChanged':e.type==='priority_changed'?'priorityChanged':e.type==='note_added'?'noteAdded':e.type}`,{},)}</p><p className="mt-1 text-slate-500">{new Date(e.createdAt).toLocaleString()}</p></div>)}</div></div></div></AdminModal>}
  </div>;
}
