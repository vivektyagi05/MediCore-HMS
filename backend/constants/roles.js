export const ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  DOCTOR: "doctor",
  RECEPTIONIST: "receptionist",
  PATIENT: "patient",
});

export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

export const ADMIN_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.ADMIN]);

export const ROLE_RANK = Object.freeze({
  [ROLES.SUPER_ADMIN]: 100,
  [ROLES.ADMIN]: 80,
  [ROLES.DOCTOR]: 50,
  [ROLES.RECEPTIONIST]: 40,
  [ROLES.PATIENT]: 10,
});
