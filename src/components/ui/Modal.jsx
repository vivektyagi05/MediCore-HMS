import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import Button from "./Button";

const SIZE_CLASSES = { md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl" };

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";

function Modal({ isOpen, title, children, onClose, size = "md" }) {
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);
  // Callers almost always pass an inline `onClose`, which is a NEW function on every render. If the effect below
  // depended on it, every keystroke in a modal form (state change -> re-render) would tear the effect down and re-run
  // it: focus jumped to the close button and the typed field lost focus after ONE character. Keep the latest handler in
  // a ref and key the effect on `isOpen` only.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocus.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    // Focus once, on open: prefer the first form field over the close button.
    const first = dialog?.querySelector("[data-autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled])") || dialog?.querySelector(FOCUSABLE);
    first?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current?.(); return; }
      if (event.key !== "Tab") return;
      // Query at event time: content changes while the modal is open (errors, loaded data, enabled buttons).
      const focusable = dialogRef.current?.querySelectorAll(FOCUSABLE);
      if (!focusable?.length) return;
      const firstEl = focusable[0]; const lastEl = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) { event.preventDefault(); lastEl.focus(); }
      else if (!event.shiftKey && document.activeElement === lastEl) { event.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, [isOpen]);

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
