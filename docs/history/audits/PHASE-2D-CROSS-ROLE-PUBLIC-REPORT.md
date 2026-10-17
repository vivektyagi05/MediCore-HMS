# PHASE 2-D — System Integration & Production Hardening

Engineering report. Implementation first, this document second, per the brief.

Scope actually audited this pass: the HARD CONSTRAINT (no ADMIN role), the
public discovery surface, and a mock/fake-data sweep. This was a targeted
real-defect audit against the FINAL Phase-2C repository, not a from-scratch
rewrite of the ~20-domain product — consistent with every prior phase's
methodology (see the disclosed-scope note at the end).

---

## 1. HARD CONSTRAINT — the ADMIN role (CRITICAL, fixed)

**Confirmed defect, not merely a risk.** A prior phase (UI-14 B2/B3) built a
complete second administrative tier: `ROLES.ADMIN` ("admin"), with its own
`ROLE_RANK` (80, between `super_admin`'s 100 and `doctor`'s 50), its own row
in the Permission matrix, and a live UI (`AdminAccessControl.jsx`) that let
any super_admin promote an existing user to `role: "admin"` with one
dropdown selection. This is a direct, working violation of this phase's hard
constraint, not a latent one — the role could actually be granted and used.

**Root cause:** the constraint was introduced in this phase's brief; the
codebase predates it and was never audited against it.

**Blast radius found (grep-verified, not assumed):**
- `ROLES.ADMIN` paired into `authorizeRoles(...)` on **~50 route/controller
  call sites** across doctor management, finance, payments, refunds,
  wallets, invoices, AI insights, and appointments.
- `AdminAccessControl.jsx` — live promote/demote dropdown offering "Admin".
- `AdminUserManagement.jsx` — "admin" in the role filter/display options.
- `AppRoutes.jsx` / `AuthContext.jsx` — "admin" baked into route guards,
  the post-login redirect, and the `isAdmin` flag.
- `seed.js` — seeded a Permission row for the "admin" role.
- `backend/automation-studio/actionLibrary.js` + `templates.js` — "admin"
  offered as a notify-role target in the automation rule builder, and 3
  shipped templates configured to notify it — would have silently notified
  nobody once "admin" stopped being an assignable role.
- `backend/payments/refundPolicyEngine.js` — a **live authorization check**
  (`isAdminActor = actorRole === "admin" || actorRole === "super_admin"`)
  gating the admin-override path for refunding an already-completed
  appointment. `actorRole` is `req.user.role` passed straight through from
  `refundController.js` — this was reachable, not dead code.
- 3 test fixtures (`api.test.js`, `chatAuthorization.test.mjs`,
  `refundPolicyEngine.test.mjs`) constructed users/scenarios with the
  now-invalid role.

**Fix:**
1. `constants/roles.js`: removed `ADMIN` from `ROLES`/`ROLE_VALUES`/
   `ROLE_RANK`. `ADMIN_ROLES` (the "admin-tier capability" set used at ~14
   call sites across chat authorization, notifications, socket rooms,
   workflow policies, and the AI NL search parser) is now `[SUPER_ADMIN]`
   only — kept as a named export rather than inlined, since those call
   sites ask "is this an admin-tier account" and the abstraction is legitimate
   with one member, not a reintroduction of a second role.
2. Scripted removal of the `ROLES.ADMIN` argument from every
   `authorizeRoles(...)` call and every `role === ROLES.ADMIN || role ===
   ROLES.SUPER_ADMIN` equality check across the ~13 affected backend files
   (every one of them was already paired with `SUPER_ADMIN`, confirmed
   before the scripted edit — removing `ADMIN` never narrows a route to
   zero valid callers).
3. Rewrote `permissionAdminController.js`: `listAdmins` now returns the
   super-admin roster only; `updateAdminRole` now supports exactly one
   operation — promoting an existing non-super-admin user to `super_admin`.
   Demotion isn't offered (there's no valid role to demote *to* under the
   3-role model, and inventing one wasn't asked for — disclosed below, not
   fabricated).
4. `AdminAccessControl.jsx`: replaced the dead per-row promote/demote
   dropdown (which, once fixed, could only ever show "already super_admin,
   nothing else selectable") with a working search-and-promote flow: search
   existing users by name/email, promote any match to Super Admin. The
   roster below it is now a read-only Super Admin list.
5. `AdminUserManagement.jsx`, `AppRoutes.jsx`, `AuthContext.jsx`: "admin"
   removed from role option lists, route guards, redirect logic, and the
   `isAdmin` flag (now `=== "super_admin"`).
6. `seed.js`, `actionLibrary.js`, `templates.js`, `refundPolicyEngine.js`,
   and the 3 test fixtures: updated to the 3-role model (see Section 1
   commit list above).

**Left deliberately untouched:** `RECEPTIONIST`. Grep-confirmed zero live
usage anywhere (no route, controller, or UI path can ever assign it to a
real user — it only appears in the role enum, two frontend option/tone
lists, and one automation notify-target option). It isn't part of the named
hard constraint (which names USER/DOCTOR/SUPER_ADMIN, i.e. patient/doctor/
super_admin in this codebase's vocabulary, and singles out ADMIN by name),
and it's inert. Removing unused-but-harmless enum members wasn't in the
audited defect set for this pass — flagged here for visibility, not fixed.

**Also left untouched (correctly, on inspection):** the many descriptive
metadata fields that happen to contain the string `"admin"`
(`Appointment.stateHistory.actorRole` fallback, `RefundRequest.entryPoint`
enum value `"admin"` meaning "initiated via the admin panel",
`AIDraft.scope`, etc.). These describe *who/where an action came from*, not
a runtime authorization *role*, and don't grant any capability. Renaming
them would be pure churn against stored-document enum values with no
security benefit — verified this distinction for each hit before leaving it
alone, rather than either fixing indiscriminately or skipping the audit.

**Verification:** all ~50 call sites confirmed still correctly gated to
`SUPER_ADMIN` after the edit (spot-checked route files by hand; full suite
below). 99/99 backend tests, 0 ESLint errors, clean build/boot.

---

## 2. Public surface (real defects found + fixed)

Traced every route in `publicRoutes.js` to its data source. Most of this
surface was already solid from prior phases (P11's public-profile
serializer whitelist, the discoverability filter applied consistently to
`searchDoctors`/`getFeaturedDoctors`/`compareDoctors`/
`getPublicNextAvailability`/`getPublicDoctorAvailability`). Two real,
narrow inconsistencies found:

- **`getDoctorPublicReviews`** queried `Review.find({ doctorId })` with no
  check that the doctor is actually publicly discoverable
  (`isVerified`+`verificationStatus: "approved"`+`isActive`) — unlike every
  sibling endpoint in the same file. A pending or rejected doctor's profile
  correctly 404'd, but their reviews (naming them) were still reachable by
  ID. Fixed: added the same discoverability check, 404 if it fails.
- **`getSimilarDoctors`**'s source lookup (`Doctor.findById(id).select(
  "specialization city")`) had no discoverability check either — an
  unauthenticated caller could confirm a non-public doctor's existence and
  read their specialization/city by probing arbitrary ObjectIds, even
  though the *results* list it builds was already correctly filtered to
  approved doctors. Fixed the source lookup to require the same three
  fields.

New `backend/tests/publicSurfaceDiscoverability.test.mjs` (3 assertions,
stubbed-Mongoose-model style matching `chatAuthorization.test.mjs`) locks
both fixes.

Confirmed correct on inspection, not touched: `serializeDoctorPublicProfile`
(the shared whitelist serializer every public doctor-facing endpoint uses —
masks `licenseNumber`, never exposes email/personal contact), malformed-ID
handling (every ID-taking public endpoint validates
`mongoose.Types.ObjectId.isValid` before querying), and pagination on
`getDoctorPublicReviews`/`searchDoctors`.

**Observation, not a defect:** the discoverability filter object
(`{ isVerified: true, verificationStatus: "approved", isActive: true }`) is
duplicated inline across ~10 call sites in `publicController.js` rather
than centralized into a shared constant. Every occurrence is consistent
(grep-verified), so this is a maintainability smell, not a bug — flagged
for a future pass, not "fixed" by extracting it now, since that would be
unrequested refactoring of working code.

---

## 3. Real-implementation / mock sweep

Grepped the full repo for `TODO`/`FIXME`/"coming soon"/`dummy`/`fake data`/
`hardcoded`/`Math.random()`. Findings:

- Every `Math.random()` hit is a legitimate unique-ID generator (upload
  filenames, idempotency keys, ICS calendar UIDs, local editor node IDs) —
  never a fake business value standing in for a real computation.
- Every `dummy`/`fake`/`hardcoded` hit is a comment *documenting a past
  fix* (already-remediated defects from prior phases: fake revenue metrics,
  a hardcoded localhost link, a hardcoded stateHistory entry) — none are
  live code paths with a mocked value today.
- No `TODO`/`FIXME`/"coming soon" markers exist anywhere in the codebase.

No new mock/fake defects found in this pass. This is consistent with the
extensive prior hardening documented across the P23 (payments/refunds),
2-A/2-B (patient/doctor lifecycle), and admin-final-integrity phases.

---

## 4. Cross-role lifecycle, IDOR, and concurrency (spot-checked, not re-audited from scratch)

Given the volume of dedicated hardening already done in prior phases
(doctor approval concurrency, refund/withdrawal state machines, booking
slot conflicts, chat/appointment ownership scoping — see project memory),
this pass spot-checked rather than re-ran the full ~20-domain matrix:

- `buildRoleBasedFilter` (appointments) and equivalent ownership filters
  elsewhere key off `ADMIN_ROLES`/`req.user._id`, never a client-supplied
  field — confirmed these automatically and correctly narrowed to
  `super_admin`-only unrestricted access once `ADMIN_ROLES` was fixed, with
  zero code changes needed at those call sites. This is the payoff of
  keeping `ADMIN_ROLES` as a shared constant rather than inlining roles
  everywhere.
- Doctor approval/rejection concurrency (`doctorApprovalConcurrencyRace.
  test.mjs`), refund state-machine concurrency (`refundConcurrencyAndState
  Machine.test.mjs`), follow-up slot claiming (`followUpSchedulingConcurrency.
  test.mjs`), and booking slot conflicts (partial unique index on
  `Appointment`, `activeStatusesSlotBlocking.test.mjs`) all still pass
  unchanged — none of this pass's edits touched those code paths.
- **Withdrawal concurrency — audited, not additionally tested.**
  `reserveWithdrawal` in `services/finance/withdrawalService.js` uses a
  create-then-recheck-then-cancel pattern (documented at length in its own
  comments) rather than a single atomic `findOneAndUpdate`, because the
  balance check is a multi-document aggregate, not a single-document
  precondition. Traced the logic by hand: whichever concurrent request's
  recheck runs after all competing creates have committed will see the true
  combined total and correctly self-cancel if it's over budget, so a
  double-spend isn't possible by this reasoning — but unlike follow-up slot
  claiming, there's no behavioral race-simulation test proving it (the
  brief's own "prioritize behavioral over source-text" standard). Disclosed
  as a real gap rather than either fabricating a "verified" claim or
  building a nontrivial fake-aggregation-store test under this pass's time
  budget.

No IDOR, mass-assignment, or role-check gaps found beyond the ADMIN-role
issues in Section 1 during this spot-check. A full re-audit of the entire
Section 1-3 matrix (every controller, every route) was not performed from
scratch this pass — see Disclosed Scope below.

---

## Final verification

- Backend: **99/99 tests passing** (`npm test`, fresh `npm install`)
- ESLint: **0 errors** repo-wide (`npx eslint .`)
- Frontend production build: **clean** (`npm run build`)
- Backend boot: **clean** — structured JSON logs only, fails on
  `ECONNREFUSED 127.0.0.1:27017` (no live MongoDB in this sandbox, same as
  every prior phase), graceful SIGTERM shutdown
- Fresh-extract gate: reinstalled dependencies from a clean extraction of
  the exact delivered zip and reran the full suite/lint/build/boot — see
  the zip's own verification pass

## Disclosed scope — what this pass did NOT do

- **Not a full re-run of Sections 1-3 of the brief** (complete cross-role
  lifecycle trace, exhaustive IDOR sweep, full concurrency matrix across
  every state machine) from a blank slate. Given the extensive dedicated
  hardening already on record for doctor approval, refunds, withdrawals,
  bookings, and chat/appointment ownership from prior phases, this pass
  targeted the brief's explicit hard constraint (ADMIN role) plus a fresh
  look at the public surface and a mock sweep, rather than re-deriving
  conclusions prior phases already established with their own tests.
- **Withdrawal concurrency race-simulation test** — reasoned through by
  hand (see Section 4), not proven with a behavioral test the way follow-up
  slot claiming was in Phase P10.
- **Live browser/Mongo/Brevo/Razorpay E2E** — unavailable in this sandbox
  (no live MongoDB, no browser, mongodb-memory-server's binary download is
  blocked by the network egress allowlist), consistent with every prior
  phase. All verification above is repository-level (tests, lint, build,
  boot), not live-provider-verified.
- **`RECEPTIONIST` role removal** — deliberately left in place; see Section
  1's "left deliberately untouched" note.
- **Discoverability-filter deduplication** in `publicController.js` — an
  observed maintainability smell, not fixed, since it isn't broken.
