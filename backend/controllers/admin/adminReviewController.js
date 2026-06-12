import Review from "../../models/Review.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";

export const getAllReviews =
asyncHandler(async (req,res)=>{

  const reviews =
  await Review.find()
    .populate(
      "userId",
      "name email"
    )
    .populate({
      path:"doctorId",
      populate:{
        path:"userId",
        select:"name"
      }
    })
    .sort({
      createdAt:-1
    })
    .lean();

  res.status(200).json({
    success:true,
    data:{
      reviews
    }
  });

});

export const deleteReview =
asyncHandler(async(req,res)=>{

  const review =
  await Review.findById(
    req.params.id
  );

  if(!review){
    throw new AppError(
      "Review not found",
      404
    );
  }

  await review.deleteOne();

  res.status(200).json({
    success:true,
    message:
      "Review deleted successfully"
  });

});