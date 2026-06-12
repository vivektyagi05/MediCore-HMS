import apiClient from "./axios";

export const adminReviewApi = {

 getReviews() {
   return apiClient
   .get(
    "/admin/reviews"
   )
   .then(
    res=>res.data
   );
 },

 deleteReview(id) {
   return apiClient
   .delete(
    `/admin/reviews/${id}`
   )
   .then(
    res=>res.data
   );
 }

};