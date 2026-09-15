import { Download, FileText } from "lucide-react";
import Button from "../ui/Button";
import Card from "../ui/Card";

function InvoiceCard({ invoice, onDownload, isDownloading = false }) {
  return (
    <Card className="transition hover:scale-[1.01]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/25">
            <FileText size={22} />
          </div>
          <div>
            <p className="text-lg font-black text-slate-950">{invoice.invoiceNumber}</p>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {new Date(invoice.issuedAt).toLocaleDateString()} • {invoice.currency} {invoice.totalAmount}
            </p>
          </div>
        </div>
        <Button onClick={onDownload} isLoading={isDownloading}>
          <Download size={17} /> Download
        </Button>
      </div>
    </Card>
  );
}

export default InvoiceCard;
