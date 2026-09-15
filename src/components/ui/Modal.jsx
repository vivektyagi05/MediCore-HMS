import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import Button from "./Button";

const SIZE_CLASSES = { md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl" };

function Modal({ isOpen, title, children, onClose, size = "md" }) {
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocus.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])");
    focusable?.[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose?.(); return; }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" className={`w-full ${sizeClass} max-h-[90vh] overflow-y-auto rounded-shell border border-slate-200 bg-white p-6 shadow-elevated`}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 id="modal-title" className="text-xl font-bold text-slate-950">{title}</h2>
          <Button variant="tertiary" size="icon" onClick={onClose} aria-label="Close modal"><X size={18} /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}
export default Modal;
