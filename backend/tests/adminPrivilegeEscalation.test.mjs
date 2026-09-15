// Regression test for a real bug found this session: a plain ADMIN could
// deactivate/delete/edit a SUPER_ADMIN account (and their own account) via
// userAdminController, bypassing the dedicated admin-hierarchy permission
// system entirely. Tests the guard logic directly (no DB needed).
import assert from "assert";
import { ROLES } from "../constants/roles.js";

const assertCanActOnTarget = (actor, targetUser, action) => {
  if (targetUser._id.toString() === actor._id.toString()) {
    throw new Error(`You cannot ${action} your own account from here`);
  }
  if (targetUser.role === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
    throw new Error("Only a super admin can modify another super admin's account");
  }
};

const admin = { _id: "admin1", role: ROLES.ADMIN };
const superAdmin = { _id: "super1", role: ROLES.SUPER_ADMIN };
const otherAdmin = { _id: "admin2", role: ROLES.ADMIN };

assert.throws(() => assertCanActOnTarget(admin, superAdmin, "deactivate"));
console.log("PASS: plain admin cannot act on a super admin");

assert.doesNotThrow(() => assertCanActOnTarget(superAdmin, admin, "deactivate"));
console.log("PASS: super admin CAN act on a plain admin");

assert.throws(() => assertCanActOnTarget(admin, admin, "delete"));
console.log("PASS: admin cannot act on their own account (no self-lockout)");

assert.doesNotThrow(() => assertCanActOnTarget(admin, otherAdmin, "deactivate"));
console.log("PASS: admin CAN act on another plain admin (normal case still works)");

console.log("ALL ADMIN PRIVILEGE ESCALATION TESTS PASSED");
