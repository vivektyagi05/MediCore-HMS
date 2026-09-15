import { useEffect, useRef, useState } from "react";
import { Download, FileWarning, Printer } from "lucide-react";
import Button from "../ui/Button";
import Loader from "../ui/Loader";
import ErrorState from "./ErrorState";
import { getApiErrorMessage } from "../../api/axios";

// PHASE P9 gap closure — real secure document preview.
//
// This deliberately does NOT introduce any new backend route, storage
// exposure, or public URL. It reuses the exact same authenticated,
// ownership-checked download endpoint every existing "Download" button
// already calls (fetchBlob is passed in by the caller — e.g.
// patientWorkflowApi.downloadReport(id)). The only new behavior is what
// happens to the Blob once it's already safely in memory: instead of
// immediately forcing a save-to-disk download, we hand it to the browser's
// own PDF/image renderer via a short-lived, tab-scoped `blob:` object URL.
//
// A `blob:` URL is not a public URL — it is unguessable, unfetchable by any
// other origin or tab, and stops existing the moment revokeObjectURL runs
// (which this component does on close/unmount/retry) or the tab closes. It
// never touches the filesystem path or the storage directory.
//
// mimeType is passed in explicitly (from the already-fetched MedicalReport/
// DoctorDocument/Certificate record) rather than trusted from the HTTP
// response's Content-Type — this guarantees correct rendering regardless of
// what a given download endpoint happens to send, and is the one thing this
// component controls to keep the render decision honest and predictable.
const PREVIEWABLE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const PREVIEWABLE_PDF_TYPE = "application/pdf";

function SecureFilePreview({ fetchBlob, mimeType, fileName, onDownload, cacheKey, showPrintButton = false }) {
  const [state, setState] = useState("loading"); // loading | ready | error | unsupported
  const [objectUrl, setObjectUrl] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const urlRef = useRef(null);
  const iframeRef = useRef(null);
  // fetchBlob is typically a fresh arrow function on every parent render
  // (e.g. () => api.downloadReport(report._id)) — a ref lets `load` always
  // call the latest closure without the effect re-running on every parent
  // render. The effect itself only re-runs when the identity of the file
  // being previewed (cacheKey) or its declared mimeType changes.
  const fetchBlobRef = useRef(fetchBlob);
  useEffect(() => {
    fetchBlobRef.current = fetchBlob;
  }, [fetchBlob]);

  const revokeCurrent = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };

  const load = async () => {
    setState("loading");
    setErrorMessage("");
    revokeCurrent();
    try {
      const blob = await fetchBlobRef.current();
      const isImage = PREVIEWABLE_IMAGE_TYPES.includes(mimeType);
      const isPdf = mimeType === PREVIEWABLE_PDF_TYPE;
      if (!isImage && !isPdf) {
        setState("unsupported");
        return;
      }
      // Re-tag with the record's own declared mimeType rather than trusting
      // whatever Content-Type the download response happened to carry — see
      // file-level comment above.
      const typedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
      const url = URL.createObjectURL(typedBlob);
      urlRef.current = url;
      setObjectUrl(url);
      setState("ready");
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error) || "This file couldn't be loaded.");
      setState("error");
    }
  };

  useEffect(() => {
    load();
    return () => revokeCurrent();
  }, [cacheKey, mimeType]);

  if (state === "loading") {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
        <Loader label="Loading secure preview…" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <ErrorState
        title="Preview couldn't be loaded"
        description={errorMessage}
        onRetry={load}
      />
    );
  }

  if (state === "unsupported") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <FileWarning className="text-slate-400" size={28} />
        <p className="text-sm font-semibold text-slate-700">Preview isn't available for this file type.</p>
        <p className="text-xs text-slate-500">{mimeType || "Unknown format"}</p>
        {onDownload && (
          <Button onClick={onDownload}><Download size={16} /> Download securely</Button>
        )}
      </div>
    );
  }

  if (mimeType === PREVIEWABLE_PDF_TYPE) {
    return (
      <div className="space-y-2">
        {showPrintButton && (
          // FIX (PHASE P9 gap closure): replaces window.print() (which
          // printed the entire application page — nav, sidebar, unrelated
          // cards and all). Printing the iframe's OWN contentWindow instead
          // scopes the browser's print dialog to just the rendered PDF,
          // since the blob: URL is same-origin to the parent page and the
          // PDF is the iframe's only content.
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => iframeRef.current?.contentWindow?.print()}>
              <Printer size={16} /> Print
            </Button>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={objectUrl}
          title={fileName || "Document preview"}
          className="h-[70vh] w-full rounded-xl border border-slate-200 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
      <img src={objectUrl} alt={fileName || "Document preview"} className="max-h-[68vh] w-auto rounded-lg object-contain" />
    </div>
  );
}

export default SecureFilePreview;
