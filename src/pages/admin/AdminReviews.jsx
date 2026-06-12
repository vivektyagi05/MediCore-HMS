import {
  MessageSquare,
  Search,
  Star,
  Trash2,
  User,
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  adminReviewApi,
} from "../../api/adminReviewApi";

import {
  getApiErrorMessage,
} from "../../api/axios";

import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";

import {
  useToast,
} from "../../context/ToastContext";

function AdminReviews() {

  const toast = useToast();

  const [reviews, setReviews] =
    useState([]);

  const [search, setSearch] =
    useState("");

  const [ratingFilter,
    setRatingFilter] =
    useState("all");

  const [loading,
    setLoading] =
    useState(true);

  const [deletingId,
    setDeletingId] =
    useState("");

  const [error,
    setError] =
    useState("");

  const loadReviews =
    async () => {

      setLoading(true);
      setError("");

      try {

        const response =
          await adminReviewApi.getReviews();

        setReviews(
          response.data.reviews || []
        );

      } catch (err) {

        setError(
          getApiErrorMessage(err)
        );

      } finally {

        setLoading(false);

      }
    };

  useEffect(() => {
    loadReviews();
  }, []);

  const deleteReview =
    async (reviewId) => {

      if (
        !window.confirm(
          "Delete this review?"
        )
      ) {
        return;
      }

      setDeletingId(
        reviewId
      );

      try {

        await adminReviewApi.deleteReview(
          reviewId
        );

        toast.success(
          "Review deleted"
        );

        loadReviews();

      } catch (err) {

        toast.error(
          getApiErrorMessage(
            err
          )
        );

      } finally {

        setDeletingId("");

      }
    };

  const filteredReviews =
    useMemo(() => {

      return reviews.filter(
        (review) => {

          const patient =
            review.userId?.name ||
            "";

          const doctor =
            review.doctorId?.userId
              ?.name || "";

          const matchesSearch =
            patient
              .toLowerCase()
              .includes(
                search.toLowerCase()
              ) ||
            doctor
              .toLowerCase()
              .includes(
                search.toLowerCase()
              );

          const matchesRating =
            ratingFilter === "all"
              ? true
              : review.rating ===
                Number(
                  ratingFilter
                );

          return (
            matchesSearch &&
            matchesRating
          );
        }
      );

    }, [
      reviews,
      search,
      ratingFilter,
    ]);

  const averageRating =
    reviews.length
      ? (
          reviews.reduce(
            (
              sum,
              item
            ) =>
              sum +
              item.rating,
            0
          ) /
          reviews.length
        ).toFixed(1)
      : 0;

  if (loading) {
    return (
      <Loader
        label="Loading reviews..."
      />
    );
  }

  return (
    <div className="space-y-6">

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">

        <div>

          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">
            Reviews Management
          </p>

          <h1 className="mt-2 text-3xl font-black">
            Patient Reviews
          </h1>

        </div>

        <Button
          onClick={
            loadReviews
          }
        >
          Refresh
        </Button>

      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-3">

        <Card>

          <MessageSquare
            className="text-blue-600"
          />

          <p className="mt-4 text-3xl font-black">
            {
              reviews.length
            }
          </p>

          <p className="text-sm font-bold text-slate-500">
            Total Reviews
          </p>

        </Card>

        <Card>

          <Star
            className="text-amber-500"
          />

          <p className="mt-4 text-3xl font-black">
            {
              averageRating
            }
          </p>

          <p className="text-sm font-bold text-slate-500">
            Average Rating
          </p>

        </Card>

        <Card>

          <User
            className="text-violet-600"
          />

          <p className="mt-4 text-3xl font-black">
            {
              filteredReviews.length
            }
          </p>

          <p className="text-sm font-bold text-slate-500">
            Filtered Results
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
            placeholder="Search patient or doctor..."
            className="rounded-xl border border-slate-200 p-3"
          />

          <select
            value={
              ratingFilter
            }
            onChange={(e) =>
              setRatingFilter(
                e.target.value
              )
            }
            className="rounded-xl border border-slate-200 p-3"
          >

            <option value="all">
              All Ratings
            </option>

            <option value="5">
              5 Stars
            </option>

            <option value="4">
              4 Stars
            </option>

            <option value="3">
              3 Stars
            </option>

            <option value="2">
              2 Stars
            </option>

            <option value="1">
              1 Star
            </option>

          </select>

        </div>

      </Card>

      <Card title="All Reviews">

        {!filteredReviews.length ? (

          <EmptyState
            title="No Reviews"
            description="Reviews will appear here."
          />

        ) : (

          <div className="space-y-4">

            {filteredReviews.map(
              (
                review
              ) => (

                <div
                  key={
                    review._id
                  }
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >

                  <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">

                    <div>

                      <p className="font-black">
                        Patient:
                        {" "}
                        {
                          review.userId
                            ?.name
                        }
                      </p>

                      <p className="text-sm text-slate-500">
                        Doctor:
                        {" "}
                        {
                          review.doctorId
                            ?.userId
                            ?.name
                        }
                      </p>

                      <p className="mt-2 text-amber-500 font-bold">
                        ⭐
                        {" "}
                        {
                          review.rating
                        }
                        /5
                      </p>

                      <p className="mt-3 text-slate-600">
                        {
                          review.comment
                        }
                      </p>

                    </div>

                    <Button
                      variant="danger"
                      onClick={() =>
                        deleteReview(
                          review._id
                        )
                      }
                      isLoading={
                        deletingId ===
                        review._id
                      }
                    >
                      <Trash2
                        size={16}
                      />
                    </Button>

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

export default AdminReviews;