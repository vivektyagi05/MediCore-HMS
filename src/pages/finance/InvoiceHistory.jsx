import { useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { invoiceApi } from "../../api/invoiceApi";
import InvoiceHistoryTable from "../../components/invoice/InvoiceHistoryTable";
import EmptyState from "../../components/shared/EmptyState";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

function InvoiceHistory() {
  const toast = useToast();
  const [invoices, setInvoices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadInvoices = async () => {
      setIsLoading(true);
      setError("");
      try {
        const response = await invoiceApi.getInvoices();
        setInvoices(response.data.invoices || []);
      } catch (loadError) {
        setError(getApiErrorMessage(loadError));
      } finally {
        setIsLoading(false);
      }
    };

    loadInvoices();
  }, []);

  const download = async (invoice) => {
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
    }
  };

  if (isLoading) return <Loader label="Loading invoices" />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Invoices</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Invoice history</h1>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      <Card>
        {invoices.length ? (
          <InvoiceHistoryTable invoices={invoices} onDownload={download} />
        ) : (
          <EmptyState title="No invoices yet" description="Paid appointment invoices will appear here." />
        )}
      </Card>
    </div>
  );
}

export default InvoiceHistory;
