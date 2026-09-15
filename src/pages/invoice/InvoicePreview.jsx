import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getApiErrorMessage } from "../../api/axios";
import { invoiceApi } from "../../api/invoiceApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import InvoiceCard from "../../components/invoice/InvoiceCard";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const DOCUMENT_TYPE_LABELS = {
  tax_invoice: "Tax Invoice",
  refund_receipt: "Refund Receipt",
  partial_refund_receipt: "Partial Refund Receipt",
};

function InvoicePreview() {
  const { invoiceId } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const { t } = useI18n();
  const { isPatient } = useAuth();

  useEffect(() => {
    const loadInvoice = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await invoiceApi.getInvoice(invoiceId);
        setInvoice(response.data.invoice);
      } catch (loadError) {
        setError(getApiErrorMessage(loadError));
      } finally {
        setIsLoading(false);
      }
    };

    loadInvoice();
  }, [invoiceId]);

  const downloadInvoice = async () => {
    setIsDownloading(true);

    try {
      const blob = await invoiceApi.downloadInvoice(invoiceId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t("ui.invoiceDownload"));
    } catch (downloadError) {
      toast.error(getApiErrorMessage(downloadError));
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) return <Loader label={t("ui.loadingInvoice")} />;

  return (
    <div className="space-y-6">
      <Link to="/patient/dashboard" className="inline-flex items-center gap-2 text-sm font-black text-blue-600">
        <ArrowLeft size={17} /> Back
      </Link>
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">{t("ui.invoices")}</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">{t("ui.paymentReceipt")}</h1>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
      {invoice && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-black text-white">
              {DOCUMENT_TYPE_LABELS[invoice.documentType] || "Tax Invoice"}
            </span>
            {invoice.refundedAmount > 0 && (
              <span className="rounded-xl bg-violet-100 px-3 py-1.5 text-xs font-black text-violet-700">
                {invoice.currency} {invoice.refundedAmount} refunded against this invoice
              </span>
            )}
          </div>
          <InvoiceCard invoice={invoice} onDownload={downloadInvoice} isDownloading={isDownloading} />
          {isPatient && (
            <AIDraftPanel
              title="AI invoice explanation"
              actionLabel="Explain this invoice"
              onGenerate={() => aiAssistApi.explainInvoice(invoice._id)}
            />
          )}
          <Card title={t("ui.invoicePreview")}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-white/60 p-4 shadow-lg">
                <p className="text-sm font-bold text-slate-500">Patient</p>
                <p className="mt-2 font-black text-slate-950">{invoice.patient.name}</p>
                <p className="text-sm text-slate-600">{invoice.patient.email}</p>
              </div>
              <div className="rounded-2xl bg-white/60 p-4 shadow-lg">
                <p className="text-sm font-bold text-slate-500">Doctor</p>
                <p className="mt-2 font-black text-slate-950">Dr. {invoice.doctor.name}</p>
                <p className="text-sm text-slate-600">{invoice.doctor.specialization}</p>
              </div>
              <div className="rounded-2xl bg-slate-950 p-5 text-white md:col-span-2">
                <p className="text-sm font-bold text-slate-400">Total paid</p>
                <p className="mt-2 text-4xl font-black">{invoice.currency} {invoice.totalAmount}</p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default InvoicePreview;
