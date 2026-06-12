import {
  Wallet,
  IndianRupee,
  Clock3,
  CheckCircle2,
  Search,
  TrendingUp,
} from "lucide-react";

import { useEffect, useMemo, useState } from "react";

import { doctorApi } from "../../api/doctorApi";
import { getApiErrorMessage } from "../../api/axios";

import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";

const statusStyles = {
  pending: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
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

function DoctorEarnings() {
  const [earnings, setEarnings] =
    useState(null);

  const [payouts, setPayouts] =
    useState([]);

  const [search, setSearch] =
    useState("");

  const [statusFilter,
    setStatusFilter] =
    useState("all");

  const [isLoading,
    setIsLoading] =
    useState(true);

  const [error,
    setError] =
    useState("");

  const loadEarnings =
    async () => {

      setIsLoading(true);
      setError("");

      try {

        const response =
          await doctorApi.getEarnings();

        setEarnings(
          response.data
        );

        setPayouts(
          response.data
            ?.payouts || []
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
    loadEarnings();
  }, []);

  const filteredPayouts =
    useMemo(() => {

      return payouts.filter(
        (payout) => {

          const matchesSearch =
            payout.appointmentId
              ?._id
              ?.toLowerCase()
              ?.includes(
                search.toLowerCase()
              );

          const matchesStatus =
            statusFilter ===
              "all"
              ? true
              : payout.status ===
              statusFilter;

          return (
            matchesSearch &&
            matchesStatus
          );
        }
      );

    }, [
      payouts,
      search,
      statusFilter,
    ]);

  if (isLoading) {
    return (
      <Loader
        label="Loading earnings..."
      />
    );
  }

  return (
    <div className="space-y-6">

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">

        <div>

          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">
            Doctor Finance
          </p>

          <h1 className="mt-2 text-3xl font-black text-slate-950">
            Earnings Dashboard
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Track payouts,
            earnings and
            settlement status.
          </p>

        </div>

        <div className="flex gap-2">

          <Button
            variant="secondary"
            disabled
          >
            Withdrawal
            Coming Soon
          </Button>

          <Button
            onClick={
              loadEarnings
            }
          >
            Refresh
          </Button>

        </div>

      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">

        <Card>

          <IndianRupee
            className="text-blue-600"
          />

          <p className="mt-4 text-3xl font-black">
            ₹
            {
              earnings?.total ||
              0
            }
          </p>

          <p className="text-sm font-bold text-slate-500">
            Total Earnings
          </p>

        </Card>

        <Card>

          <CheckCircle2
            className="text-emerald-600"
          />

          <p className="mt-4 text-3xl font-black">
            ₹
            {
              earnings?.paid ||
              0
            }
          </p>

          <p className="text-sm font-bold text-slate-500">
            Paid Earnings
          </p>

        </Card>

        <Card>

          <Clock3
            className="text-amber-600"
          />

          <p className="mt-4 text-3xl font-black">
            ₹
            {
              earnings?.pending ||
              0
            }
          </p>

          <p className="text-sm font-bold text-slate-500">
            Pending Earnings
          </p>

        </Card>

        <Card>

          <TrendingUp
            className="text-violet-600"
          />

          <p className="mt-4 text-3xl font-black">
            {
              payouts.length
            }
          </p>

          <p className="text-sm font-bold text-slate-500">
            Total Payouts
          </p>

        </Card>

      </div>

      <Card title="Search & Filter">

        <div className="grid gap-4 md:grid-cols-2">

          <div className="relative">

            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              value={search}
              onChange={(e) =>
                setSearch(
                  e.target.value
                )
              }
              placeholder="Search appointment id..."
              className="w-full rounded-xl border border-slate-200 py-3 pl-11 pr-4"
            />

          </div>

          <select
            value={
              statusFilter
            }
            onChange={(e) =>
              setStatusFilter(
                e.target.value
              )
            }
            className="rounded-xl border border-slate-200 p-3"
          >
            <option value="all">
              All Status
            </option>

            <option value="pending">
              Pending
            </option>

            <option value="paid">
              Paid
            </option>

          </select>

        </div>

      </Card>

      <Card title="Payout History">

        {!filteredPayouts.length ? (

          <EmptyState
            title="No earnings yet"
            description="Your completed appointment payouts will appear here."
          />

        ) : (

          <div className="space-y-3">

            {filteredPayouts.map(
              (payout) => (

                <div
                  key={payout._id}
                  className="rounded-2xl border border-slate-200 p-4"
                >

                  <div className="grid gap-4 lg:grid-cols-6 lg:items-center">

                    <div>

                      <p className="font-black">
                        Appointment
                      </p>

                      <p className="text-xs text-slate-500 break-all">
                        {
                          payout
                            .appointmentId
                            ?._id ||
                          payout
                            .appointmentId
                        }
                      </p>

                    </div>

                    <div>

                      <p className="text-xs text-slate-500">
                        Gross
                      </p>

                      <p className="font-black">
                        ₹
                        {
                          payout.grossAmount
                        }
                      </p>

                    </div>

                    <div>

                      <p className="text-xs text-slate-500">
                        Platform Fee
                      </p>

                      <p className="font-black text-red-600">
                        ₹
                        {
                          payout.platformFee
                        }
                      </p>

                    </div>

                    <div>

                      <p className="text-xs text-slate-500">
                        Your Share
                      </p>

                      <p className="font-black text-emerald-600">
                        ₹
                        {
                          payout.doctorAmount
                        }
                      </p>

                    </div>

                    <div>

                      <span
                        className={`rounded-xl px-3 py-2 text-xs font-black capitalize ${statusStyles[payout.status]}`}
                      >
                        {
                          payout.status
                        }
                      </span>

                    </div>

                    <div>

                      <p className="text-sm font-medium text-slate-500">
                        {
                          formatDate(
                            payout.createdAt
                          )
                        }
                      </p>

                    </div>

                  </div>

                </div>

              )
            )}

          </div>

        )}

      </Card>

      <Card>

        <div className="flex items-center gap-3">

          <Wallet
            className="text-blue-600"
          />

          <div>

            <p className="font-black text-slate-950">
              Withdrawal System
            </p>

            <p className="text-sm text-slate-500">
              Bank transfer,
              UPI payout,
              settlement history
              and withdrawal
              requests will be
              available in the
              next update.
            </p>

          </div>

        </div>

      </Card>

    </div>
  );
}

export default DoctorEarnings;