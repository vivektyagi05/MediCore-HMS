# MediCore HMS — Performance Audit Summary

## Fixed in this phase

| Area | Finding | Fix |
|---|---|---|
| Response compression | No `compression` middleware anywhere — every JSON response (paginated lists, admin analytics/executive-brief payloads, AI-generated text) was sent uncompressed over the wire. | Added `compression` middleware in `app.js`, applied globally. Cheap, safe win for both bandwidth and perceived latency on larger payloads (admin overview/analytics, doctor search result pages, AI drafts). |

## Reviewed and already solid (no change made)

- **MongoDB indexing**: spot-checked the highest-traffic models. `Appointment`
  has a compound index (`models/Appointment.js:162`) tuned for the slot/date
  query patterns from the earlier slot-engine work; `Payment` has
  `{ userId, createdAt }` and `{ appointmentId, status }` compound indexes;
  `NotificationDelivery` has `{ recipientId, readAt, createdAt }` plus a
  unique-sparse `{ eventKey, recipientId }` index for idempotent delivery.
  22 of 34 models declare explicit indexes (field-level `index: true` or
  schema-level `.index()`). This is a healthy baseline already built up over
  prior phases — no missing-index bugs found in the models reviewed.
- **Query shape**: 25 of 27 controllers already use `.lean()` for read-only
  queries (skips Mongoose document hydration overhead) — this was clearly a
  deliberate, consistent pattern from earlier phases, not something added now.
- **Pagination**: admin/patient/doctor list endpoints spot-checked
  (`getPayments`, doctor search, appointments) all use `skip`/`limit` with a
  bounded `limit` (clamped to a max, e.g. 100) rather than returning unbounded
  result sets.
- **Connection pooling**: Mongoose's default connection pool (`maxPoolSize:
  100`) was left at its default, which is reasonable for this app's expected
  concurrency; not changed since there's no load data from a real deployment
  to size it against (see Remaining Risks).

## Frontend

- **Build output**: `npm run build` is clean but reports one chunk warning —
  the main JS bundle is ~576 KB minified (~181 KB gzipped). Vite already
  code-splits per-route (`DoctorDashboard`, `PatientDashboard`,
  `BookAppointment`, etc. are all separate chunks in the build output) — the
  576 KB is the shared vendor/app-shell chunk, not a single mega-bundle.
  Further splitting (e.g. dynamic `import()` for rarely-used admin-only
  screens, or manual vendor chunking) is a reasonable follow-up but wasn't
  done in this phase — it's a tuning exercise that benefits from real usage
  data (which routes are actually hit first) rather than a blind guess.
- No image-optimization or lazy-loading audit was done on actual media
  assets in this pass (would need a content/asset inventory, not just code
  review).

## Not measured in this phase

No load/stress test was run against a live instance — there is no live
MongoDB or deployed environment available in this environment to generate
real concurrency numbers against (see Verification Report for exactly what
*was* run). Recommendations above are based on static code review, not
profiling. Before relying on this as a performance sign-off, run a real load
test (e.g. `autocannon`/`k6`) against a staging deployment with a real
database, particularly against the appointment-booking and payment-verify
endpoints under concurrent load, since those are the two flows explicitly
called out as production-critical.
