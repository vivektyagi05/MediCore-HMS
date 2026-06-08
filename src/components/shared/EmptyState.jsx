import { ClipboardList } from "lucide-react";
import Button from "../ui/Button";

function EmptyState({
  title = "Nothing here yet",
  description = "New records will appear once activity starts flowing into the system.",
  actionLabel,
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/40 p-8 text-center backdrop-blur-lg">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg">
        <ClipboardList size={22} />
      </div>
      <h3 className="text-lg font-bold text-slate-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
        {description}
      </p>
      {actionLabel && <Button className="mt-5">{actionLabel}</Button>}
    </div>
  );
}

export default EmptyState;
