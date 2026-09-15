import { Download, ExternalLink, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { invoiceApi } from "../../api/invoiceApi";
import { getApiErrorMessage } from "../../api/axios";
import ErrorState from "../shared/ErrorState";
import Button from "../ui/Button";
import Loader from "../ui/Loader";
import MetricCard from "../ui/MetricCard";
import StatusBadge from "../ui/StatusBadge";
import Tabs from "../ui/Tabs";
import { useToast } from "../../context/ToastContext";

const formatCurrency = (amount, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(
    amount || 0,
  );

const DOCUMENT_TYPE_LABEL = {
  tax_invoice: "Tax Invoice",
  refund_receipt: "Refund Receipt",
  partial_refund_receipt: "Partial Refund Receipt",
};

// Invoice Detail Workspace (Phase UI-7). Composes the existing
// GET /api/invoices/:id aggregate — reuses invoiceController.js's
// documentTypeFor() derivation (real Payment.refundStatus, never a
// fabricated document type) and the existing PDF download endpoint.
// "Open Payment Workspace" / "Open Refund Workspace" deep-link out to the
// workspaces that already own that data rather than re-rendering it here.
function InvoiceDetailWorkspace({ invoiceId, onViewPatient, onViewAppointment, onViewPayment }) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoiceApi.getInvoice(invoiceId);
      setInvoice(res.data.invoice);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
    setActiveTab("overview");
  }, [invoiceId]);

  const download = async () => {
    setIsDownloading(true);
    try {
      const blob = await invoiceApi.downloadInvoice(invoice._id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      toast.error(getApiErrorMessage(downloadError));
    } finally {
      setIsDownloading(false);
    }
  };

  if (loading) return <Loader label="Loading invoice workspace" />;
  if (error) return <ErrorState description={error} onRetry={loadDetail} />;
  if (!invoice) return null;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "patient", label: "Patient" },
    { id: "appointment", label: "Appointment" },
    { id: "payment", label: "Payment" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-950">{invoice.invoiceNumber}</h3>
          <p className="text-sm text-slate-500">
            {invoice.patient?.name || "Unknown patient"} · {new Date(invoice.issuedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={invoice.status === "void" ? "danger" : "success"}>
            {invoice.status === "void" ? "Void" : DOCUMENT_TYPE_LABEL[invoice.documentType] || "Tax Invoice"}
          </StatusBadge>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" isLoading={isDownloading} onClick={download} disabled={!invoice.pdfPath}>
          <Download size={14} /> Download PDF
        </Button>
        {onViewPayment && invoice.paymentId && (
          <Button variant="tertiary" size="sm" onClick={() => onViewPayment(invoice.paymentId)}>
            <ExternalLink size={14} /> Open Payment Workspace
          </Button>
        )}
        {onViewAppointment && invoice.appointmentId && (
          <Button variant="tertiary" size="sm" onClick={() => onViewAppointment(invoice.appointmentId, invoice.userId)}>
            <ExternalLink size={14} /> Open Appointment
          </Button>
        )}
        {onViewPatient && invoice.userId && (
          <Button variant="tertiary" size="sm" onClick={() => onViewPatient(invoice.userId)}>
            <ExternalLink size={14} /> Open Patient
          </Button>
        )}
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Subtotal" value={formatCurrency(invoice.subtotal, invoice.currency)} />
          <MetricCard label="Tax" value={formatCurrency(invoice.taxAmount, invoice.currency)} />
          <MetricCard label="Total" value={formatCurrency(invoice.totalAmount, invoice.currency)} tone="premium" />
          <MetricCard label="Billing Type" value={invoice.billingType === "subscription" ? "Subscription" : "Consultation"} />
          <MetricCard label="Currency" value={invoice.currency} />
          {invoice.refundedAmount > 0 && (
            <MetricCard label="Refunded Against This Invoice" value={formatCurrency(invoice.refundedAmount, invoice.currency)} tone="danger" />
          )}
          {invoice.hospital?.gstin && <MetricCard label="GSTIN" value={invoice.hospital.gstin} />}
        </div>
      )}

      {activeTab === "patient" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricCard label="Name" value={invoice.patient?.name || "—"} />
          <MetricCard label="Email" value={invoice.patient?.email || "—"} />
        </div>
      )}

      {activeTab === "appointment" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {invoice.appointmentId ? (
            <>
              <MetricCard label="Appointment Reference" value={String(invoice.appointmentId).slice(-8)} />
              <MetricCard label="Doctor" value={invoice.doctor?.name ? `Dr. ${invoice.doctor.name}` : "—"} caption={invoice.doctor?.specialization} />
            </>
          ) : (
            <p className="text-sm font-semibold text-slate-400">
              This is a subscription invoice — no appointment is linked.
            </p>
          )}
        </div>
      )}

      {activeTab === "payment" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {invoice.paymentId ? (
            <MetricCard label="Linked Payment" value="Open in Payments workspace" caption="Click 'Open Payment Workspace' above for full detail" />
          ) : (
            <p className="text-sm font-semibold text-slate-400">
              No payment is linked to this invoice (subscription billing is activated directly, not via the appointment payment flow).
            </p>
          )}
        </div>
      )}

      {activeTab === "timeline" && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-card border border-slate-200 bg-white p-3">
            <FileText size={16} className="text-royal-600" />
            <div>
              <p className="text-sm font-bold text-slate-800">Invoice issued</p>
              <p className="text-xs text-slate-500">{new Date(invoice.issuedAt).toLocaleString()}</p>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Only real, stored timestamps are shown — this schema has no per-event invoice timeline beyond issuance.
          </p>
        </div>
      )}
    </div>
  );
}

export default InvoiceDetailWorkspace;
