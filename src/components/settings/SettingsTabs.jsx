function SettingsTabs({ activeTab, onChange, tabs }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-2xl bg-white/50 p-2 shadow-lg backdrop-blur-lg">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded-xl px-4 py-2 text-sm font-black transition ${
            activeTab === tab.id ? "bg-blue-600 text-white shadow-lg" : "text-slate-600 hover:bg-white"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default SettingsTabs;
