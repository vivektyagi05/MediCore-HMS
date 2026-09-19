export const appendAppointmentHistory = ({ appointment, status, fromStatus = "", actorId = null, actorRole = "system", reason = "", at = new Date() }) => {
  appointment.statusHistory = appointment.statusHistory || [];
  appointment.statusHistory.push({ status, fromStatus, actorId, actorRole, reason, at });
};
