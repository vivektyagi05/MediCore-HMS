import { ClipboardList } from "lucide-react";
import Button from "../ui/Button";

function EmptyState({
  title = "Nothing here yet",
  description = "New records will appear once activity starts flowing into the system.",
  actionLabel,
  onAction,
  action,
}) {
  return (
    <div className="rounded-card border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-control bg-royal-600 text-white">
        <ClipboardList size={22} />
      </div>
      <h3 className="text-lg font-bold text-slate-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
        {description}
      </p>
      {actionLabel && <Button className="mt-5" onClick={onAction}>{actionLabel}</Button>}
      {/* `action` is additive — lets a caller pass a ready-made element (e.g.
          a <Button to=".."> real navigation link) when a plain onClick
          handler isn't the right shape. No existing caller uses this. */}
      {!actionLabel && action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export default EmptyState;
