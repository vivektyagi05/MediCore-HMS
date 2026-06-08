import {
  ArrowRight,
  CalendarCheck,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";

const features = [
  {
    title: "Unified Clinical Operations",
    description: "Coordinate doctors, patients, appointments, and billing from one focused dashboard.",
    icon: Stethoscope,
  },
  {
    title: "Fast Appointment Flow",
    description: "Keep schedules clear with responsive booking, queue tracking, and visit summaries.",
    icon: CalendarCheck,
  },
  {
    title: "Secure Patient Records",
    description: "Design-ready screens for protected records, access roles, and audit-friendly workflows.",
    icon: ShieldCheck,
  },
];

function Home() {
  return (
    <div className="overflow-hidden">
      <section className="relative px-4 py-20 sm:px-6 lg:px-8">
        <div className="absolute inset-x-0 top-0 -z-10 h-80 bg-[linear-gradient(135deg,#dbeafe,#f8fafc_45%,#e2e8f0)]" />
        <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="text-center lg:text-left">
            <span className="inline-flex rounded-xl border border-slate-950 bg-white/60 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-blue-600 shadow-lg backdrop-blur-lg">
              Hospital OS Foundation
            </span>
            <h1 className="mt-6 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Smart Hospital Management System
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-slate-600 lg:mx-0">
              A production-ready React and Tailwind frontend foundation for modern care teams, built with glass surfaces, crisp hierarchy, and dashboard-first workflows.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <Button to="/login">
                Login <ArrowRight size={18} />
              </Button>
              <Button to="/register" variant="secondary">
                Get Started
              </Button>
            </div>
          </div>

          <div className="glass-card brutal-edge rounded-2xl p-4 sm:p-6">
            <div className="rounded-2xl bg-slate-950 p-4 text-white">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-400">Emergency Queue</p>
                  <p className="text-3xl font-black">24 Active</p>
                </div>
                <span className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-black">Live</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {["ICU", "OPD", "Labs"].map((label, index) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/10 p-4">
                    <p className="text-xs font-bold text-slate-400">{label}</p>
                    <p className="mt-3 text-2xl font-black">{[8, 12, 4][index]}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl bg-white p-4 text-slate-950">
                <div className="flex items-center justify-between">
                  <p className="font-black">Today&apos;s Occupancy</p>
                  <p className="font-black text-blue-600">76%</p>
                </div>
                <div className="mt-3 h-3 rounded-full bg-slate-200">
                  <div className="h-3 w-3/4 rounded-full bg-blue-600" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/25">
                <feature.icon size={22} />
              </div>
              <h2 className="text-xl font-black text-slate-950">{feature.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{feature.description}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Home;
