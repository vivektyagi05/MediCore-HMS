import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  paymentApi,
} from "../../api/paymentApi";

import {
  getApiErrorMessage,
} from "../../api/axios";

import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Modal from "../../components/ui/Modal";
import Loader from "../../components/ui/Loader";

import {
  useToast,
} from "../../context/ToastContext";

function AdminPayments() {

  const toast =
    useToast();

  const [payments,
    setPayments] =
    useState([]);

  const [summary,
    setSummary] =
    useState(null);

  const [loading,
    setLoading] =
    useState(true);

  const [search,
    setSearch] =
    useState("");

  const [selectedPayment,
    setSelectedPayment] =
    useState(null);

    const [statusFilter,
  setStatusFilter] =
  useState("all");

      const loadData =
    async () => {

      try {

        setLoading(true);

        const [
          paymentRes,
          summaryRes,
        ] =
        await Promise.all([

          paymentApi.getPayments({
            limit: 100,
          }),

          paymentApi.getSummary(),

        ]);

        setPayments(
          paymentRes.data
            ?.payments || []
        );

        setSummary(
          summaryRes.data
        );

      } catch (error) {

        toast.error(
          getApiErrorMessage(
            error
          )
        );

      } finally {

        setLoading(false);

      }
    };

    const revenueToday =
  payments
    .filter((payment) => {

      const today =
        new Date()
          .toDateString();

      return (
        payment.status ===
          "captured"

        &&

        new Date(
          payment.createdAt
        ).toDateString()

        ===

        today
      );
    })
    .reduce(
      (sum, payment) =>
        sum +
        (
          payment.totalAmount || 0
        ),
      0
    );

      const filteredPayments =
    useMemo(() => {

      const keyword =
        search.toLowerCase();

      return payments.filter(
        (payment) => {

          const patient =
            payment.userId
              ?.name
              ?.toLowerCase() || "";

          const email =
            payment.userId
              ?.email
              ?.toLowerCase() || "";

        const matchesStatus =

  statusFilter ===
  "all"

    ? true

    : payment.status ===
      statusFilter;

          return (
  matchesStatus &&
  (
    patient.includes(
      keyword
    )

    ||

    email.includes(
      keyword
    )

    ||

    payment.paymentId
      ?.toLowerCase()
      ?.includes(
        keyword
      )
  )
);
        }
      );

    }, [
      payments,
      search,
    ]);

      useEffect(() => {
    loadData();
  }, []);

    if (loading) {

    return (
      <Loader
        label="Loading payments..."
      />
    );

  }

    return (

    <div className="space-y-6">

              <div className="flex items-center justify-between">

        <div>

          <p className="text-blue-600 font-black uppercase">
            Payments
          </p>

          <h1 className="text-3xl font-black">
            Payment Management
          </h1>

        </div>

        <Button
          onClick={loadData}
        >
          Refresh
        </Button>

      </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">

        <Card>
          <p>Total Revenue</p>
          <h2 className="text-3xl font-black">
            ₹{
              summary?.totalEarnings || 0
            }
          </h2>
        </Card>

        <Card>
          <p>Refunded</p>
          <h2 className="text-3xl font-black text-red-500">
            ₹{
              summary?.refundedAmount || 0
            }
          </h2>
        </Card>

        <Card>
          <p>Captured</p>
          <h2 className="text-3xl font-black text-green-600">
            {
              summary?.capturedPayments || 0
            }
          </h2>
        </Card>

        <Card>
          <p>Failed</p>
          <h2 className="text-3xl font-black text-red-600">
            {
              summary?.failedPayments || 0
            }
          </h2>
        </Card>

        <Card>
          <p>Success Rate</p>
          <h2 className="text-3xl font-black text-blue-600">
            {
              summary?.successRatio || 0
            }%
          </h2>
        </Card>

        <Card>

        <p>
            Today's Revenue
        </p>

        <h2 className="text-3xl font-black text-green-600">

            ₹
            {
            revenueToday
            }

        </h2>

        </Card>

        <Card>

  <h2 className="text-xl font-black mb-4">

    Top Doctors Revenue

  </h2>

  <div className="space-y-3">

    {
      Object.entries(

        payments
        .filter(
            (payment) =>
            payment.status ===
            "captured"
        )
        .reduce(
          (
            acc,
            payment
          ) => {

            const doctor =
              payment
                .doctorId
                ?.userId
                ?.name ||

              "Unknown";

            acc[doctor] =
              (
                acc[doctor] || 0
              )

              +

              (
                payment
                  .totalAmount || 0
              );

            return acc;

          },
          {}
        )

      )

      .sort(
        (
          a,
          b
        ) => b[1] - a[1]
      )

      .slice(0, 5)

      .map(
        ([doctor, amount]) => (

          <div
            key={doctor}
            className="flex justify-between rounded-xl border p-3"
          >

            <span>
              {doctor}
            </span>

            <span className="font-bold">

              ₹{amount}

            </span>

          </div>

        )
      )
    }

  </div>

</Card>

      </div>

            <Card>

  <div className="flex flex-col gap-4 md:flex-row">

    <div className="flex-1">

      <Input
        placeholder="Search payment..."
        value={search}
        onChange={(e) =>
          setSearch(
            e.target.value
          )
        }
      />

    </div>

    <select
      value={statusFilter}
      onChange={(e) =>
        setStatusFilter(
          e.target.value
        )
      }
      className="rounded-xl border p-3"
    >

      <option value="all">
        All Status
      </option>

      <option value="created">
        Created
      </option>

      <option value="pending">
        Pending
      </option>

      <option value="captured">
        Captured
      </option>

      <option value="failed">
        Failed
      </option>

    </select>

  </div>

</Card>

<Card>

  <div className="overflow-x-auto">

    <table className="w-full">

      <thead>

        <tr className="border-b">

          <th className="p-3 text-left">
            Patient
          </th>

          <th className="p-3 text-left">
            Doctor
          </th>

          <th className="p-3 text-left">
            Amount
          </th>

          <th className="p-3 text-left">
            Status
          </th>

          <th className="p-3 text-left">
            Date
          </th>

          <th className="p-3 text-left">
            Invoice
        </th>

          <th className="p-3 text-left">
            Actions
          </th>

        </tr>

      </thead>

      <tbody>

        {filteredPayments.map(
          (payment) => (

            <tr
              key={payment._id}
              className="border-b"
            >

              <td className="p-3">
                {
                  payment.userId
                    ?.name
                }
              </td>

              <td className="p-3">
                {
                  payment.doctorId
                    ?.userId
                    ?.name ||
                  "N/A"
                }
              </td>

              <td className="p-3 font-bold">
                ₹{
                  payment.totalAmount
                }
              </td>

              <td className="p-3">

                <span
                  className={`font-bold
                  ${
                    payment.status ===
                    "captured"

                      ? "text-green-600"

                      : payment.status ===
                        "failed"

                      ? "text-red-600"

                      : "text-amber-500"
                  }`}
                >

                  {
                    payment.status
                  }

                </span>

              </td>

              <td className="p-3">

                {
                  new Date(
                    payment.createdAt
                  ).toLocaleDateString()
                }

              </td>

              <td className="p-3">

                <Button
                  variant="secondary"
                  onClick={() =>
                    setSelectedPayment(
                      payment
                    )
                  }
                >
                  View
                </Button>

              </td>

              {
                filteredPayments.length === 0 && (

                    <tr>

                    <td
                        colSpan="7"
                        className="p-8 text-center text-slate-500"
                    >

                        No Payments Found

                    </td>

                    </tr>

                )
                }

            </tr>   

          )
        )}

      </tbody>

    </table>

  </div>

</Card>

<Modal
  isOpen={
    !!selectedPayment
  }
  title="Payment Details"
  onClose={() =>
    setSelectedPayment(
      null
    )
  }
>

  {selectedPayment && (

    <div className="space-y-4">

      <p>

        <strong>
          Patient:
        </strong>

        {" "}

        {
          selectedPayment
            .userId?.name
        }

      </p>

      <p>

        <strong>
          Email:
        </strong>

        {" "}

        {
          selectedPayment
            .userId?.email
        }

      </p>

      <p>

        <strong>
          Doctor:
        </strong>

        {" "}

        {
          selectedPayment
            .doctorId
            ?.userId
            ?.name || "N/A"
        }

      </p>

      <p>

        <strong>
          Amount:
        </strong>

        {" "}

        ₹{
          selectedPayment
            .totalAmount
        }

      </p>

      <p>

        <strong>
          Tax:
        </strong>

        {" "}

        ₹{
          selectedPayment
            .taxAmount
        }

      </p>

      <p>

        <strong>
          Wallet:
        </strong>

        {" "}

        ₹{
          selectedPayment
            .walletAmount
        }

      </p>

      <p>

        <strong>
          Status:
        </strong>

        {" "}

        {
          selectedPayment
            .status
        }

      </p>

      <p>

        <strong>
          Payment ID:
        </strong>

        {" "}

        {
          selectedPayment
            .paymentId ||

          "Not Available"
        }

      </p>

      <p>

  <strong>
    Invoice:
  </strong>

  {" "}

  {
    selectedPayment
      .invoiceId
      ?.invoiceNumber ||

    "Not Generated"
  }

</p>

<p>

  <strong>
    Discount:
  </strong>

  {" "}

  ₹{
    selectedPayment
      .discountAmount || 0
  }

</p>

<p>

  <strong>
    Gateway Amount:
  </strong>

  {" "}

  ₹{
    selectedPayment
      .gatewayAmount || 0
  }

</p>

    </div>

  )}

</Modal>


        </div>
    );
}

export default AdminPayments;
