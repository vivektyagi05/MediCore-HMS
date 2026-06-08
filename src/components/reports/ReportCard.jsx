import { Download, FileText } from "lucide-react";
import Button from "../ui/Button";
import Card from "../ui/Card";

function ReportCard({ report, onDownload, onPreview }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg">
            <FileText size={21} />
          </div>
          <p className="text-lg font-black text-slate-950">{report.title}</p>
          <p className="mt-1 text-sm font-semibold text-slate-500">{report.category} • {new Date(report.reportDate).toLocaleDateString()}</p>
          {report.tags?.length ? <p className="mt-3 text-xs font-bold text-blue-600">{report.tags.join(" / ")}</p> : null}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onPreview}>Preview</Button>
          <Button onClick={onDownload}><Download size={16} /></Button>
        </div>
      </div>
    </Card>
  );
}

export default ReportCard;
