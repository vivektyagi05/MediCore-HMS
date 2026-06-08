import { X } from "lucide-react";
import Button from "./Button";

function Modal({ isOpen, title, children, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg rounded-2xl p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-950">{title}</h2>
          <Button variant="secondary" className="h-10 w-10 px-0" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default Modal;
