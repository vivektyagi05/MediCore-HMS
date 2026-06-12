import {
  MessageSquare,
  Search,
  Star,
  TrendingUp,
  User,
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { doctorApi } from "../../api/doctorApi";
import { getApiErrorMessage } from "../../api/axios";
import Input from "../../components/ui/Input";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";

function DoctorReviews() {
  const [reviews, setReviews] =
    useState([]);

  const [averageRating,
    setAverageRating] =
    useState(0);

  const [totalReviews,
    setTotalReviews] =
    useState(0);

  const [search,
    setSearch] =
    useState("");

  const [ratingFilter,
    setRatingFilter] =
    useState("all");

  const [loading,
    setLoading] =
    useState(true);

  const [error,
    setError] =
    useState("");
    const [
    replyText,
    setReplyText
    ] = useState({});

    const [
    replyingId,
    setReplyingId
    ] = useState("");

    const saveReply =
    async (reviewId) => {

    try {

        setReplyingId(
        reviewId
        );

        await doctorApi.replyReview(
        reviewId,
        {
            message:
            replyText[
                reviewId
            ],
        }
        );

        await loadReviews();

    } catch (error) {

        console.error(
        error
        );

    } finally {

        setReplyingId("");

    }
};

  const loadReviews =
    async () => {

      setLoading(true);
      setError("");

      try {

        const response =
          await doctorApi.getReviews();

        setReviews(
          response.data.reviews || []
        );

        setAverageRating(
          Number(
            response.data
              .averageRating || 0
          )
        );

        setTotalReviews(
          response.data
            .totalReviews || 0
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

  const filteredReviews =
    useMemo(() => {

      return reviews.filter(
        (review) => {

          const patientName =
            review.userId?.name ||
            "";

          const matchesSearch =
            patientName
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

  const ratingStats =
    useMemo(() => {

      return {
        five:
          reviews.filter(
            (r) =>
              r.rating === 5
          ).length,

        four:
          reviews.filter(
            (r) =>
              r.rating === 4
          ).length,

        three:
          reviews.filter(
            (r) =>
              r.rating === 3
          ).length,

        two:
          reviews.filter(
            (r) =>
              r.rating === 2
          ).length,

        one:
          reviews.filter(
            (r) =>
              r.rating === 1
          ).length,
      };

    }, [reviews]);

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
            Doctor Reviews
          </p>

          <h1 className="mt-2 text-3xl font-black">
            Patient Feedback
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Monitor patient
            satisfaction and
            improve care quality.
          </p>

        </div>

        <Button
          onClick={loadReviews}
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

          <Star
            className="text-amber-500"
          />

          <p className="mt-4 text-3xl font-black">
            {averageRating}
          </p>

          <p className="text-sm font-bold text-slate-500">
            Average Rating
          </p>

        </Card>

        <Card>

          <MessageSquare
            className="text-blue-600"
          />

          <p className="mt-4 text-3xl font-black">
            {totalReviews}
          </p>

          <p className="text-sm font-bold text-slate-500">
            Total Reviews
          </p>

        </Card>

        <Card>

          <TrendingUp
            className="text-emerald-600"
          />

          <p className="mt-4 text-3xl font-black">
            {ratingStats.five}
          </p>

          <p className="text-sm font-bold text-slate-500">
            Five Star Reviews
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
            Visible Reviews
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
              placeholder="Search patient..."
              className="w-full rounded-xl border border-slate-200 py-3 pl-11 pr-4"
            />

          </div>

          <select
            value={ratingFilter}
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
              ⭐ 5 Star
            </option>

            <option value="4">
              ⭐ 4 Star
            </option>

            <option value="3">
              ⭐ 3 Star
            </option>

            <option value="2">
              ⭐ 2 Star
            </option>

            <option value="1">
              ⭐ 1 Star
            </option>

          </select>

        </div>

      </Card>

      <Card title="Patient Reviews">

        {!filteredReviews.length ? (

          <EmptyState
            title="No reviews found"
            description="Patient feedback will appear here."
          />

        ) : (

          <div className="space-y-4">

            {filteredReviews.map(
              (review) => (

                <div
                  key={review._id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >

                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

                    <div>

                      <h3 className="font-black text-slate-950">
                        {
                          review.userId
                            ?.name ||
                          "Patient"
                        }
                      </h3>

                      <p className="mt-1 text-sm text-slate-500">
                        {new Date(
                          review.createdAt
                        ).toLocaleDateString()}
                      </p>

                    </div>

                    <div className="flex items-center gap-1">

                      {[
                        1,
                        2,
                        3,
                        4,
                        5,
                      ].map(
                        (
                          star
                        ) => (
                          <Star
                            key={
                              star
                            }
                            size={
                              18
                            }
                            fill={
                              star <=
                              review.rating
                                ? "currentColor"
                                : "none"
                            }
                            className={
                              star <=
                              review.rating
                                ? "text-amber-500"
                                : "text-slate-300"
                            }
                          />
                        )
                      )}

                    </div>

                  </div>

                  <div className="mt-4 rounded-xl bg-slate-50 p-4">

                    <p className="text-sm leading-6 text-slate-700">
                      {review.doctorReply?.message ? (

                        <div className="mt-4 rounded-xl bg-blue-50 p-4">

                            <p className="text-xs font-black uppercase text-blue-700">
                            Doctor Reply
                            </p>

                            <p className="mt-2 text-sm text-slate-700">
                            {
                                review.doctorReply
                                .message
                            }
                            </p>

                        </div>

                        ) : (

                        <div className="mt-4 space-y-3">

                            <Input
                            placeholder="Reply to patient..."
                            value={
                                replyText[
                                review._id
                                ] || ""
                            }
                            onChange={(e) =>
                                setReplyText(
                                (
                                    current
                                ) => ({
                                    ...current,
                                    [review._id]:
                                    e.target.value,
                                })
                                )
                            }
                            />

                            <Button
                            onClick={() =>
                                saveReply(
                                review._id
                                )
                            }
                            isLoading={
                                replyingId ===
                                review._id
                            }
                            >
                            Reply
                            </Button>

                        </div>

                        )}
                    </p>

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

export default DoctorReviews;