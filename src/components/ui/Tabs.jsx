// Tabs primitive for a connected workspace view (e.g. the Doctor Detail
// Workspace's Overview/Verification/Documents/Performance/Reputation/
// Earnings sections). New addition to the design system introduced in
// this phase -- SettingsTabs.jsx is a separate, older, page-local
// component (still on the pre-foundation glassmorphism classes) and is
// left untouched; this is not a rename of it, it's the tokenized
// equivalent for new workspace-style pages to use going forward.
function Tabs({ tabs, activeTab, onChange }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1.5 border-b border-slate-200">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition duration-150 ${
              isActive ? "text-royal-700" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                {tab.badge}
              </span>
            )}
            {isActive && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-royal-600" />}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
