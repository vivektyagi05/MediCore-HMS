import { Download, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import Button from "../ui/Button";

const DOCUMENT_TYPE_LABELS = {
  tax_invoice: "Tax Invoice",
  refund_receipt: "Refund Receipt",
  partial_refund_receipt: "Partial Refund",
};

const DOCUMENT_TYPE_STYLES = {
  tax_invoice: "bg-slate-100 text-slate-600",
  refund_receipt: "bg-violet-100 text-violet-700",
  partial_refund_receipt: "bg-amber-100 text-amber-700",
};

function InvoiceHistoryTable({ invoices, onDownload }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/50 shadow-xl backdrop-blur-lg">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-950 text-white">
            <tr>
              {["Invoice", "Type", "Patient", "Doctor", "Total", "Issued", "Actions"].map((heading) => (
                <th key={heading} className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.14em]">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {invoices.map((invoice) => (
              <tr key={invoice._id} className="transition hover:bg-white/70">
                <td className="px-4 py-4 text-sm font-black text-slate-950">{invoice.invoiceNumber}</td>
                <td className="px-4 py-4">
                  <span className={`rounded-lg px-2.5 py-1 text-xs font-black ${DOCUMENT_TYPE_STYLES[invoice.documentType] || "bg-slate-100 text-slate-600"}`}>
                    {DOCUMENT_TYPE_LABELS[invoice.documentType] || "Tax Invoice"}
                  </span>
                </td>
                <td className="px-4 py-4 text-sm font-semibold text-slate-600">{invoice.patient?.name || "Patient"}</td>
                <td className="px-4 py-4 text-sm font-semibold text-slate-600">{invoice.doctor?.name || "Doctor"}</td>
                <td className="px-4 py-4 text-sm font-black text-blue-600">{invoice.currency} {invoice.totalAmount}</td>
                <td className="px-4 py-4 text-sm font-semibold text-slate-600">{new Date(invoice.issuedAt).toLocaleDateString()}</td>
                <td className="px-4 py-4">
                  <div className="flex gap-2">
                    <Button to={`/invoices/${invoice._id}`} variant="secondary" className="h-10 w-10 px-0" aria-label="Preview invoice">
                      <Eye size={17} />
                    </Button>
                    <Button variant="secondary" className="h-10 w-10 px-0" onClick={() => onDownload(invoice)} aria-label="Download invoice">
                      <Download size={17} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default InvoiceHistoryTable;
