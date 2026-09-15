import { CreditCard, ReceiptText, ShieldCheck } from "lucide-react";
import Card from "../ui/Card";

function PaymentSummaryCard({ payment, appointment }) {
  return (
    <Card title="Payment Summary">
      <div className="space-y-4">
        <div className="rounded-2xl bg-slate-950 p-5 text-white">
          <CreditCard className="text-blue-400" size={28} />
          <p className="mt-5 text-sm font-bold text-slate-400">Payable amount</p>
          <p className="mt-2 text-4xl font-black">
            {payment ? `${payment.currency} ${payment.gatewayAmount || payment.totalAmount}` : "Preparing..."}
          </p>
          {payment?.totalAmount !== payment?.gatewayAmount && (
            <p className="mt-2 text-sm font-bold text-slate-300">
              Invoice total {payment.currency} {payment.totalAmount}
            </p>
          )}
        </div>
        {payment && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/60 p-4 shadow-lg">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Discount</p>
              <p className="mt-2 text-lg font-black text-emerald-600">{payment.currency} {payment.discountAmount || 0}</p>
            </div>
            <div className="rounded-2xl bg-white/60 p-4 shadow-lg">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Wallet</p>
              <p className="mt-2 text-lg font-black text-blue-600">{payment.currency} {payment.walletAmount || 0}</p>
            </div>
            <div className="rounded-2xl bg-white/60 p-4 shadow-lg">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Tax</p>
              <p className="mt-2 text-lg font-black text-slate-950">{payment.currency} {payment.taxAmount || 0}</p>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-white/60 p-4 shadow-lg">
            <ReceiptText className="text-blue-600" size={22} />
            <p className="mt-3 text-sm font-bold text-slate-500">Appointment</p>
            <p className="mt-1 text-sm font-black text-slate-950">
              {appointment ? `${new Date(appointment.date).toLocaleDateString()} at ${appointment.timeSlot}` : "Selected booking"}
            </p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 shadow-lg">
            <ShieldCheck className="text-blue-600" size={22} />
            <p className="mt-3 text-sm font-bold text-slate-500">Gateway</p>
            <p className="mt-1 text-sm font-black text-slate-950">Razorpay verified</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default PaymentSummaryCard;
