export const getVerificationCycleId = (doctor) => {
  const pendingCycle = doctor?.verificationHistory
    ?.slice()
    .reverse()
    .find((entry) => entry.status === "pending")?._id;

  return pendingCycle?.toString() || doctor?._id?.toString();
};

export const buildVerificationEventKey = ({ doctorId, cycleId, status }) =>
  `verification:${doctorId}:${cycleId}:${status}`;
