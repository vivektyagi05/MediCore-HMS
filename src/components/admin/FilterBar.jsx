import Button from "../ui/Button";
import Input from "../ui/Input";

// BUGFIX (UI foundation pass): this bar previously rendered a dead
// `<Search size={0} />` icon wrapped in an unpositioned `absolute` span —
// zero-size and with no positioned ancestor to anchor to, so it never
// painted anything and served no purpose. Removed rather than "fixed"
// into a real search icon, since Input's own placeholder already
// communicates the field's purpose and no page passes a leading-icon prop
// that this dead markup was meant to support.
function FilterBar({ filters, onChange, onApply, children }) {
  return (
    <div className="grid gap-3 rounded-card border border-slate-200 bg-white p-4 shadow-card lg:grid-cols-[1fr_auto]">
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          name="search"
          placeholder="Search..."
          value={filters.search || ""}
          onChange={onChange}
        />
        {children}
      </div>
      <Button onClick={onApply}>Apply Filters</Button>
    </div>
  );
}

export default FilterBar;
