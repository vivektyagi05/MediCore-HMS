import { Building2, HeartPulse, UsersRound } from "lucide-react";
import Card from "../../components/ui/Card";

const values = [
  { label: "Departments", value: "18+", icon: Building2 },
  { label: "Daily Visits", value: "1.2k", icon: HeartPulse },
  { label: "Care Members", value: "340", icon: UsersRound },
];

function About() {
  return (
    <section className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">About HMS Pro</p>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
            A clear operating layer for complex hospital teams.
          </h1>
          <p className="mt-6 text-base leading-8 text-slate-600">
            HMS Pro is designed as a frontend foundation for hospitals that need role-based dashboards, operational clarity, and a modern interface ready for backend integration.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {values.map((item) => (
            <Card key={item.label}>
              <item.icon className="text-blue-600" size={28} />
              <p className="mt-6 text-4xl font-black text-slate-950">{item.value}</p>
              <p className="mt-2 text-sm font-bold text-slate-500">{item.label}</p>
            </Card>
          ))}
        </div>

        <Card className="mt-10">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
            <h2 className="text-3xl font-black text-slate-950">Built for administrators, doctors, and patients.</h2>
            <p className="text-sm leading-7 text-slate-600">
              The architecture separates public, authentication, and dashboard experiences while keeping reusable UI components small and portable. It gives product teams a strong base for real APIs, permissions, patient workflows, and analytics.
            </p>
          </div>
        </Card>
      </div>
    </section>
  );
}

export default About;
