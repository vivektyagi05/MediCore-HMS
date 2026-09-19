// PHASE 2-D — HARD CONSTRAINT: only SUPER_ADMIN, DOCTOR and PATIENT (the
// product's "USER" role) exist at runtime. A prior phase (UI-14 B2/B3)
// built a full second-tier "admin" role (its own ROLE_RANK, its own
// Permission-matrix row, a promote/demote UI) that is a direct violation
// of this constraint and has been removed. Do not reintroduce ROLES.ADMIN,
// alias it, or recreate its semantics under a different name — every call
// site that referenced it has been repointed at SUPER_ADMIN only (see
// permissionAdminController.js, adminMiddleware.js, doctorRoutes.js,
// workflowRoutes.js, userAdminRoutes.js, and the frontend admin pages).
// PATIENT is the codebase's runtime name for the product's USER account.
export const ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  DOCTOR: "doctor",
  PATIENT: "patient",
});

export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

// Roles with platform-wide administrative capability. Now a single-role
// set by design (see comment above) — kept as a named export rather than
// inlining ROLES.SUPER_ADMIN at its ~14 call sites, since those sites are
// asking "is this an admin-tier account", not "is this specifically a
// super admin"; the distinction matters if a second admin tier is ever
// legitimately reintroduced through proper design review, not silently.
export const ADMIN_ROLES = Object.freeze([ROLES.SUPER_ADMIN]);

export const ROLE_RANK = Object.freeze({
  [ROLES.SUPER_ADMIN]: 100,
  [ROLES.DOCTOR]: 50,
  [ROLES.PATIENT]: 10,
});
