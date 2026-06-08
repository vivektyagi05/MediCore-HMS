import { Bookmark, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { appointmentApi } from "../../api/appointmentApi";
import { getApiErrorMessage } from "../../api/axios";
import { doctorApi } from "../../api/doctorApi";
import { patientWorkflowApi } from "../../api/patientWorkflowApi";
import RatingStars from "../../components/reviews/RatingStars";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Loader from "../../components/ui/Loader";
import { useToast } from "../../context/ToastContext";

function PatientDoctors() {
  const [doctors, setDoctors] = useState([]);
  const [saved, setSaved] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [reviewForm, setReviewForm] = useState({ appointmentId: "", rating: 5, comment: "" });
  const [isLoading, setIsLoading] = useState(true);
  const toast = useToast();

  const load = async () => {
    setIsLoading(true);
    try {
      const [doctorRes, savedRes, apptRes, reviewRes] = await Promise.all([
        doctorApi.getDoctors({ limit: 100 }),
        patientWorkflowApi.getSavedDoctors(),
        appointmentApi.getAppointments({ limit: 100 }),
        patientWorkflowApi.getReviews(),
      ]);
      setDoctors(doctorRes.data.doctors || []);
      setSaved(savedRes.data.savedDoctors || []);
      setAppointments(apptRes.data.appointments || []);
      setReviews(reviewRes.data.reviews || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const savedIds = useMemo(() => new Set(saved.map((item) => item.doctorId?._id)), [saved]);
  const completedAppointments = appointments.filter((item) => item.status === "completed");

  const saveDoctor = async (doctorId) => {
    try {
      if (savedIds.has(doctorId)) await patientWorkflowApi.removeSavedDoctor(doctorId);
      else await patientWorkflowApi.saveDoctor({ doctorId });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  const saveReview = async (event) => {
    event.preventDefault();
    try {
      await patientWorkflowApi.saveReview(reviewForm);
      toast.success("Review saved");
      setReviewForm({ appointmentId: "", rating: 5, comment: "" });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  if (isLoading) return <Loader label="Loading doctors and reviews" />;

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Doctors</p><h1 className="mt-2 text-3xl font-black text-slate-950">Saved doctors and feedback</h1></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {doctors.map((doctor) => (
          <Card key={doctor._id}>
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-lg font-black text-slate-950">Dr. {doctor.userId?.name}</p><p className="mt-1 text-sm font-semibold text-slate-500">{doctor.specialization}</p><p className="mt-3 flex items-center gap-1 text-sm font-black text-amber-500"><Star size={16} fill="currentColor" /> {doctor.rating}</p></div>
              <Button variant={savedIds.has(doctor._id) ? "primary" : "secondary"} onClick={() => saveDoctor(doctor._id)}><Bookmark size={16} /></Button>
            </div>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <Card title="Write Review">
          <form className="grid gap-4" onSubmit={saveReview}>
            <select className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={reviewForm.appointmentId} onChange={(e) => setReviewForm({ ...reviewForm, appointmentId: e.target.value })}>
              <option value="">Completed appointment</option>
              {completedAppointments.map((item) => <option key={item._id} value={item._id}>Dr. {item.doctorId?.userId?.name} - {new Date(item.date).toLocaleDateString()}</option>)}
            </select>
            <RatingStars value={reviewForm.rating} onChange={(rating) => setReviewForm({ ...reviewForm, rating })} />
            <Input label="Feedback" value={reviewForm.comment} onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })} />
            <Button type="submit">Save Review</Button>
          </form>
        </Card>
        <Card title="My Reviews">
          <div className="space-y-3">{reviews.map((review) => <div key={review._id} className="rounded-2xl bg-white/60 p-4 shadow-lg"><RatingStars value={review.rating} /><p className="mt-2 font-black text-slate-950">Dr. {review.doctorId?.userId?.name}</p><p className="mt-1 text-sm text-slate-600">{review.comment}</p></div>)}</div>
        </Card>
      </div>
    </div>
  );
}

export default PatientDoctors;
