import { useCallback, useRef, useState } from "react";
import ConfirmDialog from "../components/ui/ConfirmDialog";

// Promise-based replacement for window.confirm():
//   const { confirm, confirmDialog } = useConfirm();
//   if (!(await confirm({ title, description, confirmLabel }))) return;
//   ...render {confirmDialog} once in the component's JSX.
// Resolves true on confirm, false on cancel / Escape. A second confirm() while one is open resolves the first as false.
export function useConfirm() {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const settle = useCallback((value) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  }, []);

  const confirm = useCallback((options = {}) => new Promise((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setState(options);
  }), []);

  const confirmDialog = (
    <ConfirmDialog
      isOpen={Boolean(state)}
      title={state?.title}
      description={state?.description}
      confirmLabel={state?.confirmLabel || "Confirm"}
      tone={state?.tone || "danger"}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  );
  return { confirm, confirmDialog };
}
