// Regression test for the most severe bug found this session: notFound and
// errorMiddleware were imported into app.js but never actually registered
// with the Express app, so every thrown AppError across the ENTIRE product
// fell through to Express's own default error handler instead of the app's
// JSON error contract. This makes REAL HTTP requests against the real `app`
// export (via supertest) — no mocking of the middleware chain — so it proves
// the fix works end-to-end, not just that the file parses.
import request from "supertest";
import assert from "assert";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-validation-1234";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.RATE_LIMIT_MAX = "1000";

const { default: app } = await import("../app.js");

// 1. Unmatched route must hit our JSON notFound handler, not Express's HTML default.
const notFoundRes = await request(app).get("/api/this-route-does-not-exist");
assert.strictEqual(notFoundRes.status, 404);
assert.strictEqual(notFoundRes.body.success, false);
assert.ok(notFoundRes.body.message.includes("Route not found"));
console.log("PASS: unmatched route returns the app's JSON 404 contract, not Express's default");

// 2. A route that throws an AppError before touching the DB (protect middleware
// rejecting a missing token) must return the app's JSON error contract too.
const unauthedRes = await request(app).get("/api/appointments/available-slots");
assert.strictEqual(unauthedRes.status, 401);
assert.strictEqual(unauthedRes.body.success, false);
assert.ok(typeof unauthedRes.body.message === "string" && unauthedRes.body.message.length > 0);
console.log("PASS: an AppError thrown deep in the middleware chain reaches the JSON error handler, not Express's default");

console.log("ALL ERROR MIDDLEWARE WIRING TESTS PASSED");
