import { AlertTriangle, CheckCircle, Download, FileText, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { doctorApi } from "../../api/doctorApi";
import { getApiErrorMessage } from "../../api/axios";
import Button from "../ui/Button";
import ErrorState from "../shared/ErrorState";
import Loader from "../ui/Loader";
import MetricCard from "../ui/MetricCard";
import Modal from "../ui/Modal";
import StatusBadge from "../ui/StatusBadge";
import Tabs from "../ui/Tabs";
import Textarea from "../ui/Textarea";
import { useToast } from "../../context/ToastContext";

const verificationTone = { pending: "warning", approved: "success", rejected: "danger" };
const documentStatusTone = { pending: "warning", verified: "success", rejected: "danger" };

const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

function DoctorDetailWorkspace({ doctorId, onChanged }) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [earnings, setEarnings] = useState(null);
  const [earningsError, setEarningsError] = useState(null);
  const [earningsLoading, setEarningsLoading] = useState(false);

  const [rejectReason, setRejectReason] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [verifyingDocId, setVerifyingDocId] = useState(null);
  // PHASE 2-D — public asset ENOENT bugfix: a profilePhotoUrl pointing at
  // a file that no longer exists on disk (see storage/doctor-profile
  // notes) previously rendered as a broken <img> with no fallback. The
  // backend already returns a controlled 404 for a missing file; this is
  // the matching frontend half -- fall back to the initials avatar
  // instead of a broken image icon.
  const [photoFailed, setPhotoFailed] = useState(false);

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getDoctorDetailAdmin(doctorId);
      setDetail(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPhotoFailed(false);
    loadDetail();
  }, [doctorId]);

  const loadEarnings = async () => {
    setEarningsLoading(true);
    setEarningsError(null);
    try {
      const res = await adminApi.getDoctorEarningsAdmin(doctorId);
      setEarnings(res.data);
    } catch (err) {
      setEarningsError(getApiErrorMessage(err));
    } finally {
      setEarningsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "earnings" && !earnings && !earningsLoading) {
      loadEarnings();
    }
  }, [activeTab]);

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await doctorApi.approveDoctor(doctorId);
      toast.success("Doctor approved successfully.");
      await loadDetail();
      onChanged?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Doctor approval failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.error("Rejection reason required");
      return;
    }
    setActionLoading(true);
    try {
      await doctorApi.rejectDoctor(doctorId, rejectReason.trim());
      toast.success("Doctor rejected.");
      setShowRejectDialog(false);
      setRejectReason("");
      await loadDetail();
      onChanged?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Verification update failed.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyDocument = async (documentId, status) => {
    setVerifyingDocId(documentId);
    try {
      await doctorApi.verifyDocument(doctorId, documentId, { status });
      toast.success(status === "verified" ? "Document verified." : "Document rejected.");
      await loadDetail();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Document could not be updated.");
    } finally {
      setVerifyingDocId(null);
    }
  };

  const handleDownloadDocument = async (doc) => {
    setDownloadingId(doc._id);
    try {
      const blob = await adminApi.downloadDoctorDocument(doctorId, doc._id);
      downloadBlob(blob, doc.fileName || `${doc.title}.pdf`);
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Document could not be loaded.");
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) return <Loader label="Loading doctor workspace" />;
  if (error) return <ErrorState description={error} onRetry={loadDetail} />;
  if (!detail) return null;

  const { doctor, appointmentCount, performance, reviews, reputation } = detail;
  const pendingDocs = (doctor.documents || []).filter((d) => d.status === "pending").length;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "verification", label: "Verification" },
    { id: "documents", label: "Documents", badge: pendingDocs },
    { id: "performance", label: "Performance" },
    { id: "reputation", label: "Reputation" },
    { id: "earnings", label: "Earnings" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {doctor.profilePhotoUrl && !photoFailed ? (
            <img
              src={doctor.profilePhotoUrl}
              alt={doctor.userId?.name || ""}
              className="h-16 w-16 rounded-2xl object-cover ring-1 ring-slate-200"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-lg font-black text-slate-400">
              {(doctor.userId?.name || "D").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
          <h3 className="text-xl font-bold text-slate-950">Dr. {doctor.userId?.name}</h3>
          <p className="text-sm text-slate-500">{doctor.userId?.email}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={verificationTone[doctor.verificationStatus] || "neutral"}>
            {doctor.verificationStatus}
          </StatusBadge>
          <StatusBadge tone={doctor.userId?.isActive ? "success" : "neutral"}>
            {doctor.userId?.isActive ? "Active" : "Deactivated"}
          </StatusBadge>
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Specialization" value={doctor.specialization} />
          <MetricCard label="Experience" value={`${doctor.experience} yrs`} />
          <MetricCard label="Consultation Fee" value={`₹${doctor.fees}`} />
          <MetricCard label="Rating" value={doctor.rating?.toFixed(1) || "0.0"} />
          <MetricCard label="Appointments" value={appointmentCount} caption="All-time · live" />
          <MetricCard
            label="Location"
            value={[doctor.city, doctor.state].filter(Boolean).join(", ") || "Not provided"}
          />
          {doctor.qualification && <MetricCard label="Qualification" value={doctor.qualification} />}
          {doctor.licenseNumber && <MetricCard label="License Number" value={doctor.licenseNumber} />}
          {doctor.consultationMode?.length > 0 && (
            <MetricCard label="Consultation Mode" value={doctor.consultationMode.join(", ")} />
          )}
        </div>
      )}

      {activeTab === "verification" && (
        <div className="space-y-4">
          <div className="rounded-card border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-700">Current status</p>
                <StatusBadge tone={verificationTone[doctor.verificationStatus] || "neutral"} className="mt-2">
                  {doctor.verificationStatus}
                </StatusBadge>
              </div>
              {doctor.verificationStatus === "pending" && (
                <div className="flex gap-2">
                  <Button variant="success" isLoading={actionLoading} onClick={handleApprove}>
                    <CheckCircle size={16} /> Approve
                  </Button>
                  <Button variant="danger" onClick={() => setShowRejectDialog(true)}>
                    <XCircle size={16} /> Reject
                  </Button>
                </div>
              )}
            </div>
            {doctor.verificationNotes && (
              <p className="mt-4 text-sm text-slate-600">
                <span className="font-semibold text-slate-700">Notes: </span>
                {doctor.verificationNotes}
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-slate-800">Verification History</p>
            {(doctor.verificationHistory || []).length === 0 ? (
              <p className="text-sm text-slate-500">No status changes recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {doctor.verificationHistory
                  .slice()
                  .reverse()
                  .map((entry, i) => (
                    <li key={i} className="rounded-control border border-slate-200 p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <StatusBadge tone={verificationTone[entry.status] || "neutral"}>{entry.status}</StatusBadge>
                        <span className="text-xs text-slate-400">
                          {new Date(entry.changedAt).toLocaleString()}
                        </span>
                      </div>
                      {entry.notes && <p className="mt-1 text-slate-600">{entry.notes}</p>}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {activeTab === "documents" && (
        <div className="space-y-3">
          {(doctor.documents || []).length === 0 ? (
            <p className="text-sm text-slate-500">No documents uploaded yet.</p>
          ) : (
            doctor.documents.map((doc) => (
              <div
                key={doc._id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-slate-200 p-3.5"
              >
                <div className="flex items-center gap-3">
                  <FileText size={18} className="text-slate-400" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{doc.title}</p>
                    <p className="text-xs text-slate-500">
                      {doc.type.replace(/_/g, " ")} · uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                      {doc.expiryDate && ` · expires ${new Date(doc.expiryDate).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={documentStatusTone[doc.status] || "neutral"}>{doc.status}</StatusBadge>
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={downloadingId === doc._id}
                    onClick={() => handleDownloadDocument(doc)}
                  >
                    <Download size={14} /> Download
                  </Button>
                  {doc.status === "pending" && (
                    <>
                      <Button
                        variant="success"
                        size="sm"
                        isLoading={verifyingDocId === doc._id}
                        onClick={() => handleVerifyDocument(doc._id, "verified")}
                      >
                        Verify
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        isLoading={verifyingDocId === doc._id}
                        onClick={() => handleVerifyDocument(doc._id, "rejected")}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "performance" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Completed Appointments" value={performance.completed} />
          <MetricCard label="Approval Rate" value={`${Math.round((performance.approvalRate || 0) * 100)}%`} />
          <MetricCard label="Cancellation Rate" value={`${Math.round((performance.cancellationRate || 0) * 100)}%`} />
          <MetricCard label="Patients Today" value={performance.patientsToday} />
          <MetricCard label="Pending Approvals" value={performance.pendingApprovals} tone={performance.pendingApprovals > 0 ? "warning" : "neutral"} />
          <MetricCard label="Pending Prescriptions" value={performance.pendingPrescriptions} tone={performance.pendingPrescriptions > 0 ? "warning" : "neutral"} />
          {performance.mostCommonConsultationType && (
            <MetricCard label="Most Common Visit Type" value={performance.mostCommonConsultationType} />
          )}
          {performance.mostActiveDay && <MetricCard label="Most Active Day" value={performance.mostActiveDay} />}
          {performance.revenue != null && (
            <MetricCard label="Total Revenue" value={`₹${performance.revenue}`} caption="Live · from paid payments" />
          )}
        </div>
      )}

      {activeTab === "reputation" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Rating" value={reputation.overview.rating} />
            <MetricCard label="Total Reviews" value={reputation.overview.totalReviews} />
            <MetricCard label="Satisfaction Rate" value={`${reputation.overview.satisfactionRate}%`} />
            <MetricCard label="Response Rate" value={`${reviews.responseRate}%`} />
            <MetricCard
              label="Negative Reviews"
              value={reviews.negativeCount}
              tone={reviews.negativeCount > 0 ? "danger" : "neutral"}
            />
            <MetricCard
              label="Unreplied Reviews"
              value={reviews.unrepliedCount}
              tone={reviews.unrepliedCount > 0 ? "warning" : "neutral"}
            />
          </div>
          {reputation.intelligence?.topStrengths?.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-bold text-slate-800">Top Strengths</p>
              <div className="flex flex-wrap gap-2">
                {reputation.intelligence.topStrengths.map((s, i) => (
                  <StatusBadge key={i} tone="success">
                    {s}
                  </StatusBadge>
                ))}
              </div>
            </div>
          )}
          {reputation.intelligence?.improvementOpportunities?.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-bold text-slate-800">Improvement Opportunities</p>
              <div className="flex flex-wrap gap-2">
                {reputation.intelligence.improvementOpportunities.map((s, i) => (
                  <StatusBadge key={i} tone="warning">
                    {s}
                  </StatusBadge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "earnings" && (
        <div>
          {earningsLoading && <Loader label="Loading earnings" />}
          {!earningsLoading && earningsError && (
            <ErrorState
              title={earningsError.toLowerCase().includes("permission") ? "Financial data restricted" : "Something went wrong"}
              description={earningsError}
              onRetry={earningsError.toLowerCase().includes("permission") ? undefined : loadEarnings}
            />
          )}
          {!earningsLoading && !earningsError && earnings && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard label="Total Earnings" value={`₹${earnings.totalEarnings}`} />
              <MetricCard label="Settled Earnings" value={`₹${earnings.settledEarnings}`} />
              <MetricCard label="Pending Earnings" value={`₹${earnings.pendingEarnings}`} />
              <MetricCard label="This Month" value={`₹${earnings.monthlyEarnings}`} />
              <MetricCard label="Platform Fees" value={`₹${earnings.platformFees}`} />
              <MetricCard label="Total Refunded" value={`₹${earnings.totalRefunded}`} />
              <MetricCard label="Upcoming Payout" value={`₹${earnings.upcomingPayout}`} />
              <MetricCard label="Total Payouts" value={earnings.totalPayouts} />
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={showRejectDialog}
        title="Reject doctor verification"
        onClose={() => {
          setShowRejectDialog(false);
          setRejectReason("");
        }}
      >
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-slate-600">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" /> The doctor will be notified and
            will need to resubmit for verification.
          </p>
          <Textarea
            label="Rejection reason"
            required
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Explain what needs to be corrected..."
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              disabled={actionLoading}
              onClick={() => {
                setShowRejectDialog(false);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" isLoading={actionLoading} onClick={handleReject}>
              Reject
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default DoctorDetailWorkspace;
