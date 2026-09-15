// PHASE P4 audit finding: appointmentCancellationService.cancelAppointmentCore
// decided who to notify with an if/else — "notify the patient" OR "notify
// the doctor" — which only ever covered the two cases it was written for
// (patient cancels -> tell doctor; doctor cancels -> tell patient). Admin
// cancellation also passes cancelledBy="admin" (see
// controllers/admin/appointmentAdminController.js), which fell into the
// `!== "patient"` branch and notified ONLY the patient. The doctor was never
// told their own appointment had been cancelled by the clinic — a real
// cross-role consistency gap (brief §16: Doctor <-> Patient <-> Admin state
// must remain consistent on cancellation). This locks in the source
// contract: both notifications must be independent (`if`/`if`), not
// mutually exclusive (`if`/`else`), so a third actor value can never again
// silently drop one side's notification.
import assert from "assert";
import fs from "fs";

const source = fs.readFileSync(
  new URL("../services/appointmentCancellationService.js", import.meta.url),
  "utf8",
);

const start = source.indexOf("export const cancelAppointmentCore");
assert.ok(start !== -1, "cancelAppointmentCore must exist in appointmentCancellationService.js");
const body = source.slice(start);

// The two notification blocks must both be gated by independent `if`
// conditions on cancelledBy, not a single if/else pair.
assert.ok(
  /if \(cancelledBy !== "patient"\)/.test(body),
  "must notify the patient whenever they are not the one who cancelled",
);
assert.ok(
  /if \(cancelledBy !== "doctor"\)/.test(body),
  "must notify the doctor whenever they are not the one who cancelled",
);

// The specific bug this locks against: an `else` tying doctor notification
// to "not patient" (which silently excludes the admin-cancels-notify-doctor
// case) must not be present between the two notification blocks.
const patientBlockStart = body.indexOf('if (cancelledBy !== "patient")');
const doctorBlockStart = body.indexOf('if (cancelledBy !== "doctor")');
assert.ok(patientBlockStart !== -1 && doctorBlockStart !== -1 && doctorBlockStart > patientBlockStart);
const between = body.slice(patientBlockStart, doctorBlockStart);
assert.ok(
  !/}\s*else\s*{/.test(between),
  "patient and doctor cancellation notifications must not be if/else — admin cancellation must reach both",
);

console.log("PASS: cancelAppointmentCore notifies patient and doctor independently (admin cancellation reaches both)");
