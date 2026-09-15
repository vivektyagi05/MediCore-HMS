// ─────────────────────────────────────────────────────────────────────────
// PHASE DOC-03 — real security gap found and fixed.
//
// Neither the chat:send socket handler nor roomManager.canJoinRoom's
// "chat:" branch, nor the REST getConversation endpoint, ever verified
// that a real doctor-patient (or staff) relationship exists between the
// two participants — only that the requester's own id was one of the two
// ids embedded in the conversationKey, and (for chat:send) that the
// recipient account is active. Any authenticated user could message, or
// read the full message history of, any other user on the platform by
// supplying their id. This module is the single, shared authorization
// check — reused by the socket handler, roomManager, and the REST
// endpoint, so this is fixed once, not three different ways.
// ─────────────────────────────────────────────────────────────────────────
import Doctor from "../models/Doctor.js";
import Appointment from "../models/Appointment.js";
import { ADMIN_ROLES, ROLES } from "../constants/roles.js";

/**
 * Whether two users are allowed to have/read a conversation.
 * - Either side being admin/super_admin (support) is always allowed.
 * - A doctor and a patient may chat only if a real Appointment exists
 *   between them (the same "treated this patient" relationship
 *   ensureDoctorTreatedPatient checks elsewhere in the doctor workflow).
 * - Any other pairing (patient-patient, doctor-doctor, receptionist-*,
 *   self-chat) is not a supported relationship in this product and is
 *   denied — no chat feature exists for those pairings anywhere in the
 *   frontend, so allowing them would only be an unused attack surface.
 */
export async function usersCanChat(userA, userB) {
  if (!userA?._id || !userB?._id) return false;
  if (userA._id.toString() === userB._id.toString()) return false;

  if (ADMIN_ROLES.includes(userA.role) || ADMIN_ROLES.includes(userB.role)) return true;

  const doctorUser = userA.role === ROLES.DOCTOR ? userA : userB.role === ROLES.DOCTOR ? userB : null;
  const patientUser = userA.role === ROLES.PATIENT ? userA : userB.role === ROLES.PATIENT ? userB : null;

  if (!doctorUser || !patientUser || doctorUser._id.toString() === patientUser._id.toString()) return false;

  const doctorProfile = await Doctor.findOne({ userId: doctorUser._id }).select("_id").lean();
  if (!doctorProfile) return false;

  const hasRelationship = await Appointment.exists({
    doctorId: doctorProfile._id,
    patientId: patientUser._id,
  });

  return Boolean(hasRelationship);
}
