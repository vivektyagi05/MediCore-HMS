import { Download, Eye, FileText, IndianRupee } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoiceApi } from "../../api/invoiceApi";
import { getApiErrorMessage } from "../../api/axios";
import AdminModal from "../../components/admin/AdminModal";
import AdminTable from "../../components/admin/AdminTable";
import FilterBar from "../../components/admin/FilterBar";
import InvoiceDetailWorkspace from "../../components/admin/InvoiceDetailWorkspace";
import ErrorState from "../../components/shared/ErrorState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import Select from "../../components/ui/Select";
import StatusBadge from "../../components/ui/StatusBadge";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0,
  );

// PHASE UI-7 — Invoice Operations Workspace (admin). Was previously the
// same InvoiceHistory.jsx used by patients at /patient/invoices — a
// browser-side-filtered, no-attention-logic, no-drill-down page with no
// admin-specific value. Reuses invoiceApi/invoiceController.js as-is
// (extended additively with status/userId/amount filters — see
// invoiceController.js) rather than duplicating a second invoice list.
// Patient-facing InvoiceHistory.jsx is untouched and still serves
// /patient/invoices.
function AdminInvoices() {
  const toast = useToast();
  const navigate = useNavigate();
  const { dashboardSyncTick } = useRealtime();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    status: searchParams.get("status") || "",
    billingType: searchParams.get("billingType") || "",
  });

  const [invoices, setInvoices] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detailId, setDetailId] = useState(null);

  const query = useMemo(
    () => Object.fromEntries([...searchParams.entries()].filter(([, value]) => value)),
    [searchParams],
  );

  const loadInvoices = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await invoiceApi.getInvoices({ ...query, limit: 100 });
      setInvoices(response.data.invoices || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const response = await invoiceApi.getSummary();
      setSummary(response.data || null);
    } catch (error) {
      if (!summary) toast.error(getApiErrorMessage(error) || "Invoice summary is unavailable.");
    }
  };

  useEffect(() => {
    loadInvoices();
  }, [searchParams, dashboardSyncTick]);

  useEffect(() => {
    loadSummary();
  }, [dashboardSyncTick]);

  const applyFilters = () => {
    setSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  };

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

  const columns = [
    {
      key: "invoice",
      header: "Invoice",
      render: (row) => (
        <div>
          <p className="font-bold text-slate-950">{row.invoiceNumber}</p>
          <p className="text-xs text-slate-500 capitalize">{row.billingType}</p>
        </div>
      ),
    },
    {
      key: "patient",
      header: "Patient",
      render: (row) => (
        <div>
          <p className="font-semibold text-slate-800">{row.patient?.name || "—"}</p>
          <p className="text-xs text-slate-500">{row.patient?.email}</p>
        </div>
      ),
    },
    {
      key: "doctor",
      header: "Doctor",
      render: (row) => <span className="text-sm text-slate-700">{row.doctor?.name ? `Dr. ${row.doctor.name}` : "—"}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      render: (row) => <span className="font-bold text-slate-950">{formatCurrency(row.totalAmount)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge tone={row.status === "void" ? "danger" : "success"}>
          {row.status === "void" ? "Void" : "Issued"}
        </StatusBadge>
      ),
    },
    {
      key: "date",
      header: "Issued",
      render: (row) => <span className="text-xs text-slate-500">{new Date(row.issuedAt).toLocaleString()}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDetailId(row._id)}>
            <Eye size={14} /> View
          </Button>
          <Button variant="tertiary" size="sm" onClick={() => download(row)} disabled={!row.pdfPath}>
            <Download size={14} />
          </Button>
        </div>
      ),
    },
  ];

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const isRestricted = loadError && /permission/i.test(loadError);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Invoice Operations"
        title="Invoice Operations Workspace"
        description="Every real tax invoice generated by the platform — searchable, filterable, and linked back to its payment, patient, and appointment."
      />

      {isRestricted ? (
        <ErrorState
          title="Financial data restricted"
          description="Your admin account does not have permission to view invoices. Contact a super admin to request access."
        />
      ) : (
        <>
          {summary && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard
                label="All-time Invoiced"
                value={formatCurrency(summary.allTime?.totalAmount)}
                caption={`${summary.allTime?.count || 0} invoices`}
                icon={IndianRupee}
                tone="success"
              />
              <MetricCard
                label="This Year"
                value={formatCurrency(summary.thisYear?.totalAmount)}
                caption={`Tax collected: ${formatCurrency(summary.thisYear?.totalTax)}`}
                icon={FileText}
              />
              <MetricCard
                label="Top Doctor by Invoiced Value"
                value={summary.topDoctorsByExpense?.[0]?.doctorName || "—"}
                caption={summary.topDoctorsByExpense?.[0] ? formatCurrency(summary.topDoctorsByExpense[0].totalAmount) : ""}
              />
            </div>
          )}

          <FilterBar
            filters={filters}
            onChange={(event) => setFilters((current) => ({ ...current, [event.target.name]: event.target.value }))}
            onApply={applyFilters}
          >
            <Select
              name="status"
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="">All statuses</option>
              <option value="issued">Issued</option>
              <option value="void">Void</option>
            </Select>
            <Select
              name="billingType"
              value={filters.billingType}
              onChange={(event) => setFilters((current) => ({ ...current, billingType: event.target.value }))}
            >
              <option value="">All billing types</option>
              <option value="consultation">Consultation</option>
              <option value="subscription">Subscription</option>
            </Select>
          </FilterBar>

          {loadError ? (
            <ErrorState description={loadError} onRetry={loadInvoices} />
          ) : (
            <Card>
              <AdminTable
                columns={columns}
                data={invoices}
                isLoading={isLoading}
                emptyTitle="No invoices found"
                emptyDescription={
                  activeFilterCount > 0
                    ? "No invoices match these filters. Try clearing them."
                    : "No invoices have been issued on the platform yet."
                }
              />
            </Card>
          )}

          {pagination && pagination.total > pagination.limit && (
            <p className="text-center text-xs font-semibold text-slate-500">
              Showing {invoices.length} of {pagination.total} invoices. Narrow with search or filters to see more.
            </p>
          )}
        </>
      )}

      <AdminModal isOpen={Boolean(detailId)} title="Invoice Workspace" onClose={() => setDetailId(null)} size="xl">
        {detailId && (
          <InvoiceDetailWorkspace
            invoiceId={detailId}
            onViewPayment={(paymentId) => navigate(`/admin/payments?search=${encodeURIComponent(paymentId)}`)}
            onViewAppointment={(_appointmentId, patientId) =>
              navigate(patientId ? `/admin/appointments?patientId=${patientId}` : "/admin/appointments")
            }
            onViewPatient={(patientId) => navigate(`/admin/patients?search=${encodeURIComponent(patientId)}`)}
          />
        )}
      </AdminModal>
    </div>
  );
}

export default AdminInvoices;
