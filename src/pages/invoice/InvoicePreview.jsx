import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getApiErrorMessage } from "../../api/axios";
import { invoiceApi } from "../../api/invoiceApi";
import InvoiceCard from "../../components/invoice/InvoiceCard";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

function InvoicePreview() {
  const { invoiceId } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

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
      toast.success("Invoice download started");
    } catch (downloadError) {
      toast.error(getApiErrorMessage(downloadError));
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) return <Loader label="Loading invoice" />;

  return (
    <div className="space-y-6">
      <Link to="/patient/dashboard" className="inline-flex items-center gap-2 text-sm font-black text-blue-600">
        <ArrowLeft size={17} /> Back
      </Link>
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Invoice</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Payment receipt</h1>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
      {invoice && (
        <>
          <InvoiceCard invoice={invoice} onDownload={downloadInvoice} isDownloading={isDownloading} />
          <Card title="Invoice Preview">
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
