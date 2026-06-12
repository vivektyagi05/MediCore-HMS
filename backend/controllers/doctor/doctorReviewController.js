import Doctor from "../../models/Doctor.js";
import Review from "../../models/Review.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";

export const getDoctorReviews =
asyncHandler(async (req, res) => {

  const doctor =
  await Doctor.findOne({
    userId: req.user._id,
  });

  if (!doctor) {
    throw new AppError(
      "Doctor profile not found",
      404
    );
  }

  const reviews =
  await Review.find({
    doctorId: doctor._id,
  })
  .populate(
    "userId",
    "name"
  )
  .sort({
    createdAt: -1,
  })
  .lean();

  const averageRating =
    reviews.length
      ? (
          reviews.reduce(
            (sum, item) =>
              sum + item.rating,
            0
          ) / reviews.length
        ).toFixed(1)
      : 0;

  res.status(200).json({
    success: true,
    data: {
      reviews,
      averageRating,
      totalReviews:
        reviews.length,
    },
  });
});

export const replyToReview =
asyncHandler(async (req, res) => {

  const review =
    await Review.findById(
      req.params.id
    );

  if (!review) {
    throw new AppError(
      "Review not found",
      404
    );
  }

  const doctor =
    await Doctor.findOne({
      userId: req.user._id,
    });

  if (
    !doctor ||
    review.doctorId.toString() !==
      doctor._id.toString()
  ) {
    throw new AppError(
      "Unauthorized review",
      403
    );
  }

  review.doctorReply = {
    message:
      req.body.message,
    repliedAt:
      new Date(),
  };

  await review.save();

  res.status(200).json({
    success: true,
    data: {
      review,
    },
    message:
      "Reply saved successfully",
  });
});