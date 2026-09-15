import { ShieldCheck } from "lucide-react";
import Card from "../ui/Card";

function InsuranceCard({ policy }) {
  return (
    <Card>
      <ShieldCheck className="text-blue-600" size={28} />
      <p className="mt-5 text-xl font-black text-slate-950">{policy.provider}</p>
      <p className="mt-1 text-sm font-semibold text-slate-500">{policy.policyNumber}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white/60 p-3">
          <p className="text-xs font-bold text-slate-500">Valid till</p>
          <p className="font-black text-slate-950">{new Date(policy.validTill).toLocaleDateString()}</p>
        </div>
        <div className="rounded-xl bg-white/60 p-3">
          <p className="text-xs font-bold text-slate-500">Claim status</p>
          <p className="font-black capitalize text-blue-600">{policy.claimStatus.replaceAll("_", " ")}</p>
        </div>
      </div>
    </Card>
  );
}

export default InsuranceCard;
