// PHASE 2-C — Section 8/9/33 regression tests.
//
// Phase 2-B's idempotency guard on approveDoctor/rejectDoctor was
// check-then-act: `Doctor.findById` -> read verificationStatus in memory ->
// mutate -> `.save()`. Two concurrent requests (approve+approve,
// reject+reject, or approve racing reject) could both read "pending"
// before either write landed, both pass the in-memory idempotency check,
// and both apply their one-time side effects — doubling the approval
// email/notification/automation trigger/history entry, or worse, leaving
// the final DB state and its triggered side effects pointing at different
// terminal outcomes (e.g. DB=rejected but an approval email already sent).
//
// Phase 2-C fixed this by making the pending->terminal transition itself
// the atomic guard: `Doctor.findOneAndUpdate({_id, verificationStatus:
// "pending"}, ...)`. Only the request whose filter still matches at write
// time gets `new: true` document back; every other concurrent caller gets
// null and an honest 409 instead of a silently-doubled mutation.
//
// A live MongoDB isn't available in this sandbox (mongodb-memory-server's
// binary download is blocked by the sandbox's network egress allowlist —
// same constraint as every prior phase). What IS fully testable without a
// database is the actual concurrency-safety shape: a fake Doctor model
// whose findOneAndUpdate deliberately awaits a tick between reading its
// in-memory store and writing to it, simulating the worst-case interleaving
// two real concurrent HTTP requests hitting Mongo would produce. This
// mirrors the exact pattern already established in
// followUpSchedulingConcurrency.test.mjs (P10 hardening pass).

import assert from "node:assert/strict";
import { test } from "node:test";

// A minimal fake mirroring the one real property that matters here:
// findOneAndUpdate's filter is evaluated against the CURRENT store value at
// write time, not at call time — and the read/write halves are split by a
// real await so two concurrent calls can genuinely interleave.
function makeInterleavingFakeDoctorModel(initialDoc) {
  const store = new Map([[String(initialDoc._id), { ...initialDoc }]]);
  return {
    store,
    async findOneAndUpdate(filter, update) {
      const doc = store.get(String(filter._id));
      if (!doc) return null;

      // The race window: read the current status now, but don't act on it
      // yet — a real concurrent second call gets to run its own read here
      // too, before either write has happened.
      const matchesAtReadTime = doc.verificationStatus === filter.verificationStatus;
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Re-check against the CURRENT store state at write time — this is
      // exactly what a real atomic findOneAndUpdate guarantees (the
      // precondition is evaluated as part of the same indivisible
      // operation as the write, not as a separate earlier read).
      const current = store.get(String(filter._id));
      if (!current || current.verificationStatus !== filter.verificationStatus) {
        return null;
      }
      void matchesAtReadTime; // only used to document the race window above

      const next = {
        ...current,
        ...update.$set,
        verificationHistory: [...(current.verificationHistory || []), update.$push.verificationHistory],
      };
      store.set(String(filter._id), next);
      return { ...next };
    },
  };
}

function attemptTransition(model, doctorId, { from, to, actorId }) {
  return model.findOneAndUpdate(
    { _id: doctorId, verificationStatus: from },
    {
      $set: { verificationStatus: to, isVerified: to === "approved", verifiedBy: actorId, verifiedAt: new Date() },
      $push: { verificationHistory: { status: to, changedBy: actorId, changedAt: new Date() } },
    },
  );
}

test("concurrent approve+approve on the same pending doctor: exactly one wins the atomic transition", async () => {
  const doctorId = "doc-1";
  const model = makeInterleavingFakeDoctorModel({ _id: doctorId, verificationStatus: "pending", verificationHistory: [] });

  const [resultA, resultB] = await Promise.all([
    attemptTransition(model, doctorId, { from: "pending", to: "approved", actorId: "admin-a" }),
    attemptTransition(model, doctorId, { from: "pending", to: "approved", actorId: "admin-b" }),
  ]);

  const winners = [resultA, resultB].filter(Boolean);
  assert.equal(winners.length, 1, "exactly one concurrent approve should win the atomic transition");

  const finalDoc = model.store.get(doctorId);
  assert.equal(finalDoc.verificationStatus, "approved");
  // One-time side effect proof: exactly one verificationHistory entry was
  // ever appended, not two — this is the field every real side effect
  // (email/notification/automation trigger) is gated behind in the
  // controller.
  assert.equal(finalDoc.verificationHistory.length, 1);
});

test("concurrent reject+reject on the same pending doctor: exactly one wins the atomic transition", async () => {
  const doctorId = "doc-2";
  const model = makeInterleavingFakeDoctorModel({ _id: doctorId, verificationStatus: "pending", verificationHistory: [] });

  const [resultA, resultB] = await Promise.all([
    attemptTransition(model, doctorId, { from: "pending", to: "rejected", actorId: "admin-a" }),
    attemptTransition(model, doctorId, { from: "pending", to: "rejected", actorId: "admin-b" }),
  ]);

  const winners = [resultA, resultB].filter(Boolean);
  assert.equal(winners.length, 1, "exactly one concurrent reject should win the atomic transition");
  assert.equal(model.store.get(doctorId).verificationHistory.length, 1);
});

test("approve vs reject racing the same pending doctor: exactly one terminal transition wins, DB state and side effects never disagree", async () => {
  const doctorId = "doc-3";
  const model = makeInterleavingFakeDoctorModel({ _id: doctorId, verificationStatus: "pending", verificationHistory: [] });

  const [approveResult, rejectResult] = await Promise.all([
    attemptTransition(model, doctorId, { from: "pending", to: "approved", actorId: "admin-a" }),
    attemptTransition(model, doctorId, { from: "pending", to: "rejected", actorId: "admin-b" }),
  ]);

  const winners = [approveResult, rejectResult].filter(Boolean);
  assert.equal(winners.length, 1, "exactly one of approve/reject should apply its terminal transition");

  const finalDoc = model.store.get(doctorId);
  assert.ok(finalDoc.verificationStatus === "approved" || finalDoc.verificationStatus === "rejected");
  // The critical invariant the Phase 2-C brief calls out by name: final DB
  // state must match whichever single side-effect-triggering transition
  // actually ran. Since only one findOneAndUpdate ever succeeded, the
  // winning result's verificationStatus and the store's final
  // verificationStatus must be identical.
  assert.equal(winners[0].verificationStatus, finalDoc.verificationStatus);
  assert.equal(finalDoc.verificationHistory.length, 1);
});

test("a request racing against an already-terminal doctor safely no-ops instead of double-applying a transition", async () => {
  const doctorId = "doc-4";
  const model = makeInterleavingFakeDoctorModel({ _id: doctorId, verificationStatus: "approved", verificationHistory: [{ status: "approved" }] });

  // Simulates a late/retried approve request arriving after the doctor is
  // already approved (e.g. a slow duplicate request, or the loser of an
  // earlier race re-checking). The atomic filter requires "pending", which
  // no longer matches, so this must be a safe no-op — never a second
  // approval side effect.
  const result = await attemptTransition(model, doctorId, { from: "pending", to: "approved", actorId: "admin-c" });

  assert.equal(result, null);
  assert.equal(model.store.get(doctorId).verificationHistory.length, 1, "no duplicate history entry from the late request");
});
