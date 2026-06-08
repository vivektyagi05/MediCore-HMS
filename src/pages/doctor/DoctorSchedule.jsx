import { CalendarOff } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { doctorWorkflowApi } from "../../api/doctorWorkflowApi";
import AdminTable from "../../components/admin/AdminTable";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import ScheduleGrid from "../../components/schedule/ScheduleGrid";
import { useToast } from "../../context/ToastContext";

function DoctorSchedule() {
  const [availability, setAvailability] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [leaveForm, setLeaveForm] = useState({ startDate: "", endDate: "", reason: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    setIsLoading(true);
    try {
      const [scheduleRes, leavesRes] = await Promise.all([doctorWorkflowApi.getSchedule(), doctorWorkflowApi.getLeaves()]);
      setAvailability(scheduleRes.data.availability || []);
      setBlockedDates(scheduleRes.data.blockedDates || []);
      setLeaves(leavesRes.data.leaves || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveSchedule = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await doctorWorkflowApi.updateSchedule({ availability, blockedDates });
      toast.success("Schedule updated");
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

  if (isLoading) return <Loader label="Loading schedule" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Scheduling Intelligence</p><h1 className="mt-2 text-3xl font-black text-slate-950">Weekly slots, blocked dates, and leave</h1></div>
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card title="Weekly Schedule"><form onSubmit={saveSchedule}><ScheduleGrid availability={availability} setAvailability={setAvailability} /><Button className="mt-4" isLoading={isSaving}>Save Schedule</Button></form></Card>
        <Card title="Blocked Dates">
          <div className="space-y-3">
            {blockedDates.map((item, index) => <div key={index} className="rounded-2xl bg-white/60 p-4 shadow-lg"><CalendarOff className="text-blue-600" /><p className="mt-2 font-black">{new Date(item.date).toLocaleDateString()}</p><p className="text-sm text-slate-500">{item.reason}</p></div>)}
            <Button variant="secondary" onClick={() => setBlockedDates([...blockedDates, { date: new Date().toISOString().slice(0, 10), reason: "Blocked manually" }])}>Add Blocked Date</Button>
          </div>
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card title="Request Leave">
          <form className="grid gap-4" onSubmit={requestLeave}>
            <Input label="Start date" type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })} />
            <Input label="End date" type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })} />
            <Input label="Reason" value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} />
            <Button type="submit" isLoading={isSaving}>Submit Leave</Button>
          </form>
        </Card>
        <Card title="Leave History">
          <AdminTable columns={[{ key: "startDate", header: "Start", render: (r) => new Date(r.startDate).toLocaleDateString() }, { key: "endDate", header: "End", render: (r) => new Date(r.endDate).toLocaleDateString() }, { key: "status", header: "Status" }, { key: "reason", header: "Reason" }]} data={leaves} />
        </Card>
      </div>
    </div>
  );
}

export default DoctorSchedule;
