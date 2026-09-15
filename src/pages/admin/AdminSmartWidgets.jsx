import WidgetGrid from "../../components/widgets/WidgetGrid";

function AdminSmartWidgets() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Smart Widgets Platform</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Your Widgets</h1>
        <p className="mt-2 text-sm text-slate-600">
          Every widget expands, refreshes, filters by date range, drills into detail, and exports to CSV — pick the ones that matter to you.
        </p>
      </div>
      <WidgetGrid />
    </div>
  );
}

export default AdminSmartWidgets;
