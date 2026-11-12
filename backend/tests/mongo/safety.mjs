/**
 * Guard for destructive real-Mongo integration suites.
 * These suites call dropDatabase(), so a database-name substring alone is not
 * sufficient evidence that the target is disposable. Remote hosts require an
 * explicit opt-in in addition to a dedicated *_test database name.
 */
export function getDisposableMongoTestUri(env = process.env) {
  const uri = env.MONGODB_TEST_URI;
  if (!uri) return null;

  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("REFUSING: MONGODB_TEST_URI must be a valid MongoDB URL");
  }
  if (!["mongodb:", "mongodb+srv:"].includes(parsed.protocol)) {
    throw new Error("REFUSING: MONGODB_TEST_URI must use mongodb:// or mongodb+srv://");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!/^(?:test|.+[_-]test)$/i.test(databaseName)) {
    throw new Error("REFUSING: destructive MongoDB tests require a dedicated database named test or ending in _test/-test");
  }

  const host = parsed.hostname.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!localHosts.has(host) && env.MONGODB_TEST_ALLOW_REMOTE !== "1") {
    throw new Error("REFUSING: remote MongoDB test targets require explicit MONGODB_TEST_ALLOW_REMOTE=1 after verifying the cluster is disposable");
  }

  return uri;
}
