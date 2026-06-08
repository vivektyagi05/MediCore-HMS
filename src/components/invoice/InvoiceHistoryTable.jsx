import { Download, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import Button from "../ui/Button";

function InvoiceHistoryTable({ invoices, onDownload }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/50 shadow-xl backdrop-blur-lg">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-950 text-white">
            <tr>
              {["Invoice", "Patient", "Doctor", "Total", "Issued", "Actions"].map((heading) => (
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
