import { CalendarOff, LayoutTemplate, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import AdminTable from "../../components/admin/AdminTable";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import Tabs from "../../components/ui/Tabs";
import EmptyState from "../../components/shared/EmptyState";
import ScheduleGrid from "../../components/schedule/ScheduleGrid";
import DoctorScheduleToday from "../../components/schedule/DoctorScheduleToday";
import DoctorScheduleWeek from "../../components/schedule/DoctorScheduleWeek";
import DoctorScheduleMonth from "../../components/schedule/DoctorScheduleMonth";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const TABS = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "configure", label: "Configure" },
  { id: "leave", label: "Leave & Templates" },
];

function DoctorSchedule() {
  const [activeTab, setActiveTab] = useState("today");
  // Phase DOC-07 final pass: lets Week/Month view's "Open day" action
  // jump the Today view to a specific date instead of building a second
  // single-day view. jumpToken forces DoctorScheduleToday to pick up a new
  // jumpDate even if the same date is clicked twice in a row.
  const [jumpDate, setJumpDate] = useState(null);
  const [jumpToken, setJumpToken] = useState(0);

  const openDay = (dateValue) => {
    setJumpDate(dateValue);
    setJumpToken((t) => t + 1);
    setActiveTab("today");
  };
  const [availability, setAvailability] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [leaveForm, setLeaveForm] = useState({ startDate: "", endDate: "", reason: "" });
  const [templateName, setTemplateName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();
  const { t } = useI18n();

  const load = async () => {
    setIsLoading(true);
    try {
      const [scheduleRes, leavesRes, templatesRes] = await Promise.all([
        doctorWorkflowApi.getSchedule(),
        doctorWorkflowApi.getLeaves(),
        doctorWorkflowApi.getScheduleTemplates(),
      ]);
      setAvailability(scheduleRes.data.availability || []);
      setBlockedDates(scheduleRes.data.blockedDates || []);
      setLeaves(leavesRes.data.leaves || []);
      setTemplates(templatesRes.data.templates || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Upcoming Leave — derived client-side from data already loaded above,
  // never a second fetch or a guessed value. ("Today's Availability" moved
  // into the real Today tab, which reads the live per-day capacity payload
  // instead of a client-side guess of "today".)
  const upcomingLeaves = useMemo(
    () => leaves.filter((leave) => leave.status === "approved" && new Date(leave.endDate) >= new Date()),
    [leaves],
  );

  const saveSchedule = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await doctorWorkflowApi.updateSchedule({ availability, blockedDates });
      toast.success(t("doctor.schedule.updated"));
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const requestLeave = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await doctorWorkflowApi.requestLeave(leaveForm);
      toast.success("Leave request submitted");
      setLeaveForm({ startDate: "", endDate: "", reason: "" });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      toast.error("Give this template a name first");
      return;
    }
    try {
      await doctorWorkflowApi.saveScheduleTemplate({ name: templateName.trim(), availability });
      toast.success("Schedule template saved");
      setTemplateName("");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const applyTemplate = async (id) => {
    try {
      const res = await doctorWorkflowApi.applyScheduleTemplate(id);
      setAvailability(res.data.doctor.availability || []);
      toast.success("Template applied — review and Save Schedule to confirm");
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const deleteTemplate = async (id) => {
    try {
      await doctorWorkflowApi.deleteScheduleTemplate(id);
      toast.success("Template deleted");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  if (isLoading) return <Loader label="Loading schedule" />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-royal-600">Scheduling Intelligence Center</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Your clinical day</h1>
        <p className="mt-1 text-sm text-slate-500">Today's capacity, weekly slots, and leave — in one command view.</p>
      </div>

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "today" && <DoctorScheduleToday key={jumpToken} initialDate={jumpDate} />}

      {activeTab === "week" && <DoctorScheduleWeek onOpenDay={openDay} />}

      {activeTab === "month" && <DoctorScheduleMonth onOpenDay={openDay} />}

      {activeTab === "configure" && (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card title="Weekly Schedule">
            <form onSubmit={saveSchedule}>
              <ScheduleGrid availability={availability} setAvailability={setAvailability} />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Input placeholder="Save current schedule as template…" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                <Button type="button" variant="secondary" onClick={saveTemplate}><LayoutTemplate size={16} /> Save as Template</Button>
                <Button className="ml-auto" isLoading={isSaving}>Save Schedule</Button>
              </div>
            </form>
          </Card>
          <div className="space-y-6">
            <Card title="Session Templates">
              {templates.length ? (
                <div className="space-y-2">
                  {templates.map((template) => (
                    <div key={template._id} className="flex items-center justify-between rounded-control border border-slate-200 bg-white p-3 text-sm">
                      <span className="font-semibold text-slate-900">{template.name}</span>
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => applyTemplate(template._id)}>Apply</Button>
                        <Button variant="secondary" onClick={() => deleteTemplate(template._id)}><Trash2 size={14} /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No templates yet" description="Save your current weekly schedule as a reusable template above." />
              )}
            </Card>
            <Card title={t("doctor.schedule.blockedDates")}>
              <div className="space-y-3">
                {blockedDates.map((item, index) => <div key={index} className="rounded-card border border-slate-200 bg-white p-4"><CalendarOff className="text-royal-600" /><p className="mt-2 font-bold text-slate-950">{new Date(item.date).toLocaleDateString()}</p><p className="text-sm text-slate-500">{item.reason}</p></div>)}
                <Button variant="secondary" onClick={() => setBlockedDates([...blockedDates, { date: new Date().toISOString().slice(0, 10), reason: "Blocked manually" }])}>Add Blocked Date</Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === "leave" && (
        <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <Card title={t("doctor.schedule.requestLeave")}>
            <form className="grid gap-4" onSubmit={requestLeave}>
              <Input label="Start date" type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })} />
              <Input label="End date" type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })} />
              <Input label="Reason" value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} />
              <Button type="submit" isLoading={isSaving}>Submit Leave</Button>
            </form>
            {upcomingLeaves.length > 0 && (
              <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-700">
                {upcomingLeaves.length} approved leave period{upcomingLeaves.length === 1 ? "" : "s"} coming up — see history for dates.
              </div>
            )}
          </Card>
          <Card title="Leave History">
            <AdminTable columns={[{ key: "startDate", header: "Start", render: (r) => new Date(r.startDate).toLocaleDateString() }, { key: "endDate", header: "End", render: (r) => new Date(r.endDate).toLocaleDateString() }, { key: "status", header: "Status" }, { key: "reason", header: "Reason" }]} data={leaves} />
          </Card>
        </div>
      )}

      <AIDraftPanel
        title="AI: Schedule Optimization"
        actionLabel="Suggest Optimizations"
        onGenerate={() => aiAssistApi.getScheduleOptimization()}
        compact
      />
    </div>
  );
}

export default DoctorSchedule;

