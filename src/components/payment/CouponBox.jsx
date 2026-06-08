import { BadgePercent } from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";

function CouponBox({ couponCode, discountAmount, error, isLoading, onApply, onChange }) {
  return (
    <div className="rounded-2xl border border-white/60 bg-white/60 p-4 shadow-lg backdrop-blur-lg">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-blue-600/10 p-2 text-blue-600">
          <BadgePercent size={20} />
        </span>
        <div>
          <p className="font-black text-slate-950">Coupon</p>
          <p className="text-xs font-semibold text-slate-500">Validated by backend before order creation</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Input
          className="uppercase"
          name="couponCode"
          placeholder="HMSCARE"
          value={couponCode}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          error={error}
        />
        <Button className="sm:w-36" variant="secondary" onClick={onApply} isLoading={isLoading} disabled={!couponCode}>
          Apply
        </Button>
      </div>
      {discountAmount > 0 && (
        <p className="mt-3 text-sm font-black text-emerald-600">Discount applied: INR {discountAmount}</p>
      )}
    </div>
  );
}

export default CouponBox;
