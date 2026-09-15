import { AlertTriangle } from "lucide-react";
import Button from "../ui/Button";

// Companion to EmptyState for the "no data yet" case: this is for "the
// request actually failed." Per the error-handling rules, callers must
// pass the real backend error message rather than falling back to a
// generic "Something went wrong" whenever one is available.
function ErrorState({
  title = "Something went wrong",
  description = "The request could not be completed. Please try again.",
  onRetry,
  retryLabel = "Retry",
}) {
  return (
    <div className="rounded-card border border-rose-200 bg-rose-50 p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-control bg-rose-100 text-rose-600">
        <AlertTriangle size={22} />
      </div>
      <h3 className="text-lg font-bold text-slate-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{description}</p>
      {onRetry && (
        <Button className="mt-5" variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export default ErrorState;
