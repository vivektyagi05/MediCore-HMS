import Card from "../ui/Card";

function DoctorMetricCard({ icon: Icon, label, value }) {
  return (
    <Card>
      <Icon className="text-blue-600" size={26} />
      <p className="mt-5 text-3xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-sm font-bold text-slate-500">{label}</p>
    </Card>
  );
}

export default DoctorMetricCard;
