function Loader({ label = "Loading workspace" }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-4 rounded-2xl border border-white/60 bg-white/40 p-6 backdrop-blur-lg">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
      <p className="text-sm font-semibold text-slate-600">{label}</p>
    </div>
  );
}

export default Loader;
