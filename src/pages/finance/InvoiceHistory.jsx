import { useCallback, useEffect, useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import { invoiceApi } from "../../api/invoiceApi";
import { aiAssistApi } from "../../api/aiAssistApi";
import InvoiceHistoryTable from "../../components/invoice/InvoiceHistoryTable";
import EmptyState from "../../components/shared/EmptyState";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useI18n } from "../../i18n/I18nContext";

const formatMoney = (value) => `\u20b9${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function useDebouncedValue(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function InvoiceHistory() {
  const toast = useToast();
  const { t } = useI18n();
  const { isPatient } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [summary, setSummary] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const debouncedSearch = useDebouncedValue(searchTerm);

  const loadInvoices = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = { page, limit: 10 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (from) params.from = from;
      if (to) params.to = to;
      const [invoicesResponse, summaryResponse] = await Promise.all([
        invoiceApi.getInvoices(params),
        invoiceApi.getSummary(),
      ]);
      setInvoices(invoicesResponse.data.invoices || []);
      setPagination(invoicesResponse.data.pagination || { page: 1, pages: 1, total: 0 });
      setSummary(summaryResponse.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, from, to]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, from, to]);

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

  if (isLoading) return <Loader label={t("ui.loadingInvoices")} />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">{t("ui.invoices")}</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Invoice Center</h1>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-lg backdrop-blur-lg">
            <p className="text-xs font-black uppercase tracking-wide text-slate-400">All-time invoiced</p>
            <p className="mt-1 text-2xl font-black text-slate-950">{formatMoney(summary.allTime?.totalAmount)}</p>
            <p className="text-xs font-semibold text-slate-500">{summary.allTime?.count || 0} documents</p>
          </div>
          <div className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-lg backdrop-blur-lg">
            <p className="text-xs font-black uppercase tracking-wide text-slate-400">This year</p>
            <p className="mt-1 text-2xl font-black text-slate-950">{formatMoney(summary.thisYear?.totalAmount)}</p>
            <p className="text-xs font-semibold text-slate-500">Tax: {formatMoney(summary.thisYear?.totalTax)}</p>
          </div>
          <div className="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-lg backdrop-blur-lg">
            <p className="text-xs font-black uppercase tracking-wide text-slate-400">Top doctor by expense</p>
            <p className="mt-1 text-xl font-black text-slate-950">
              {summary.topDoctorsByExpense?.[0]?.doctorName || "—"}
            </p>
            <p className="text-xs font-semibold text-slate-500">
              {summary.topDoctorsByExpense?.[0] ? formatMoney(summary.topDoctorsByExpense[0].totalAmount) : ""}
            </p>
          </div>
        </div>
      )}

      {isPatient && (
        <AIDraftPanel
          title="AI medical expense summary"
          actionLabel="Summarize my invoices"
          onGenerate={() => aiAssistApi.getExpenseSummary()}
        />
      )}

      <Card>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Search invoice / doctor / patient"
            placeholder="e.g. INV-2026 or doctor name"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        {invoices.length ? (
          <>
            <InvoiceHistoryTable invoices={invoices} onDownload={download} />
            {pagination.pages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3">
                <Button variant="secondary" disabled={pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <span className="text-sm font-bold text-slate-600">Page {pagination.page} of {pagination.pages}</span>
                <Button variant="secondary" disabled={pagination.page >= pagination.pages} onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}>
                  Next
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState title={t("ui.noInvoices")} description={t("ui.paidInvoicesHere")} />
        )}
      </Card>
    </div>
  );
}

export default InvoiceHistory;
