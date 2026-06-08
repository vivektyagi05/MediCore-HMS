import { Search } from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";

function FilterBar({ filters, onChange, onApply, children }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-white/60 bg-white/40 p-4 shadow-lg backdrop-blur-lg lg:grid-cols-[1fr_auto]">
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          name="search"
          placeholder="Search..."
          value={filters.search || ""}
          onChange={onChange}
          className="pl-10"
        />
        <div className="pointer-events-none absolute">
          <Search size={0} />
        </div>
        {children}
      </div>
      <Button onClick={onApply}>Apply Filters</Button>
    </div>
  );
}

export default FilterBar;
