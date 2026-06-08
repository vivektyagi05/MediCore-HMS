import {
  CreditCard,
  Search,
  CheckCircle2,
  Clock3,
  IndianRupee,
} from "lucide-react";

import { useEffect, useMemo, useState } from "react";

import { paymentApi } from "../../api/paymentApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";

const statusStyles = {
  pending: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

function formatDate(value) {
  return new Date(value).toLocaleDateString(
    undefined,
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    }
  );
}

function PatientPayments() {
  const [payments, setPayments] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState("all");

  const [isLoading, setIsLoading] =
    useState(true);

  const [error, setError] = useState("");

  const loadPayments = async () => {
    setIsLoading(true);
    setError("");

    try {
      const response =
        await paymentApi.getPayments();

      setPayments(
        response.data?.payments || []
      );
    } catch (err) {
      setError(
        getApiErrorMessage(err)
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPayments();
  }, []);

  const filteredPayments =
    useMemo(() => {
      return payments.filter(
        (payment) => {
          const doctorName =
            payment.appointmentId
              ?.doctorId?.userId?.name ||
            "";

          const matchesSearch =
            doctorName
              .toLowerCase()
              .includes(
                search.toLowerCase()
              );

          const matchesStatus =
            statusFilter === "all"
              ? true
              : payment.status ===
                statusFilter;

          return (
            matchesSearch &&
            matchesStatus
          );
        }
      );
    }, [
      payments,
      search,
      statusFilter,
    ]);

  const stats = {
    total: payments.length,

    paid: payments.filter(
      (p) => p.status === "paid"
    ).length,

    pending: payments.filter(
      (p) =>
        p.status === "pending"
    ).length,

    amount: payments
      .filter(
        (p) => p.status === "paid"
      )
      .reduce(
        (sum, p) =>
          sum +
          Number(
            p.amount || 0
          ),
        0
      ),
  };

  if (isLoading) {
    return (
      <Loader label="Loading payments..." />
    );
  }

  return (
    <div className="space-y-6">

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">

        <div>

          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">
            Patient Payments
          </p>

          <h1 className="mt-2 text-3xl font-black">
            Payment History
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Review all payment
            transactions and
            invoices.
          </p>

        </div>

        <Button
          onClick={loadPayments}
        >
          Refresh
        </Button>

      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">

        <Card>
          <CreditCard className="text-blue-600" />

          <p className="mt-4 text-3xl font-black">
            {stats.total}
          </p>

          <p className="text-sm font-bold text-slate-500">
            Total Payments
          </p>
        </Card>

        <Card>
          <CheckCircle2 className="text-emerald-600" />

          <p className="mt-4 text-3xl font-black">
            {stats.paid}
          </p>

          <p className="text-sm font-bold text-slate-500">
            Paid
          </p>
        </Card>

        <Card>
          <Clock3 className="text-amber-600" />

          <p className="mt-4 text-3xl font-black">
            {stats.pending}
          </p>

          <p className="text-sm font-bold text-slate-500">
            Pending
          </p>
        </Card>

        <Card>
          <IndianRupee className="text-blue-600" />

          <p className="mt-4 text-3xl font-black">
            ₹{stats.amount}
          </p>

          <p className="text-sm font-bold text-slate-500">
            Total Paid
          </p>
        </Card>

      </div>

      <Card title="Search & Filter">

        <div className="grid gap-4 md:grid-cols-2">

          <input
            value={search}
            onChange={(e) =>
              setSearch(
                e.target.value
              )
            }
            placeholder="Search doctor..."
            className="rounded-xl border border-slate-200 p-3"
          />

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value
              )
            }
            className="rounded-xl border border-slate-200 p-3"
          >
            <option value="all">
              All
            </option>

            <option value="paid">
              Paid
            </option>

            <option value="pending">
              Pending
            </option>

            <option value="failed">
              Failed
            </option>

          </select>

        </div>

      </Card>

      <Card title="Payment History">

        {!filteredPayments.length ? (
          <EmptyState
            title="No payments found"
            description="Payment records will appear here."
          />
        ) : (
          <div className="space-y-3">

            {filteredPayments.map(
              (payment) => (
                <div
                  key={payment._id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">

                    <div>

                      <h3 className="font-black">
                        Dr.{" "}
                        {
                          payment
                            .appointmentId
                            ?.doctorId
                            ?.userId
                            ?.name
                        }
                      </h3>

                      <p className="mt-2 text-sm text-slate-500">
                        {formatDate(
                          payment.createdAt
                        )}
                      </p>

                    </div>

                    <div className="flex items-center gap-2">

                      <span className="font-black">
                        ₹
                        {
                          payment.amount
                        }
                      </span>

                      <span
                        className={`rounded-xl px-3 py-2 text-xs font-black capitalize ${statusStyles[payment.status]}`}
                      >
                        {
                          payment.status
                        }
                      </span>

                    </div>

                  </div>
                </div>
              )
            )}

          </div>
        )}

      </Card>

    </div>
  );
}

export default PatientPayments;