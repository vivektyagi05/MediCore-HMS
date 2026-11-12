import assert from "node:assert/strict";
import { getDisposableMongoTestUri } from "./mongo/safety.mjs";

assert.equal(getDisposableMongoTestUri({}), null);
assert.equal(getDisposableMongoTestUri({ MONGODB_TEST_URI: "mongodb://localhost:27017/hms_phase00_test" }), "mongodb://localhost:27017/hms_phase00_test");
assert.equal(getDisposableMongoTestUri({ MONGODB_TEST_URI: "mongodb://127.0.0.1:27017/test" }), "mongodb://127.0.0.1:27017/test");
assert.throws(() => getDisposableMongoTestUri({ MONGODB_TEST_URI: "mongodb://localhost:27017/hms_test_backup" }), /ending in _test/);
assert.throws(() => getDisposableMongoTestUri({ MONGODB_TEST_URI: "mongodb+srv://cluster.example.net/hms_phase00_test" }), /MONGODB_TEST_ALLOW_REMOTE=1/);
assert.equal(getDisposableMongoTestUri({ MONGODB_TEST_URI: "mongodb+srv://cluster.example.net/hms_phase00_test", MONGODB_TEST_ALLOW_REMOTE: "1" }), "mongodb+srv://cluster.example.net/hms_phase00_test");
assert.throws(() => getDisposableMongoTestUri({ MONGODB_TEST_URI: "https://example.com/hms_test" }), /mongodb:\/\//);
console.log("PASS: destructive Mongo suites require an explicitly named test database; remote hosts require explicit opt-in");
