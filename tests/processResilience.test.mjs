// Regression test for the other half of the stability bug: the old
// unhandledRejection handler did `server.close(() => process.exit(1))`.
// server.close()'s callback only fires once every open connection has
// ended naturally -- open Socket.IO/WebSocket connections don't do that,
// so under real traffic that callback (and the process.exit inside it)
// could simply never run, leaving the process alive but unresponsive
// forever (exactly "stops responding until manually restarted").
//
// This test simulates that exact scenario -- a server.close() that never
// calls back, standing in for connections that never drain -- and proves
// the new registerProcessSafety shuts the process down anyway, within a
// bounded window, via the forced-exit timeout.
import assert from "assert";
import { registerProcessSafety } from "../utils/processResilience.js";

const run = async () => {
  // --- Case 1: fatal error while a "hung" server.close() never completes ---
  {
    const exitCodes = [];
    let dbClosed = false;

    const fakeServer = {
      close: (_cb) => {
        // Deliberately never invoke _cb -- simulates open connections
        // that never drain, which is exactly what caused the original
        // indefinite hang.
      },
    };

    registerProcessSafety({
      getServer: () => fakeServer,
      getIO: () => null,
      disconnectDB: async () => { dbClosed = true; },
      forceExitMs: 50,
      exit: (code) => exitCodes.push(code),
    });

    process.emit("unhandledRejection", new Error("simulated unexpected rejection"));

    // Wait comfortably past the forced-exit window.
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.strictEqual(exitCodes.length, 1, "process must be force-exited exactly once, even though server.close() never called back");
    assert.strictEqual(exitCodes[0], 1, "a fatal error must exit with a non-zero code");
    // dbClosed is NOT expected to be true here -- the whole point of the
    // forced-exit path is that it does not wait on anything that might hang.
    console.log("PASS: fatal error with a hung server.close() still force-exits within the bounded window (no infinite hang)");
  }

  // --- Case 2: a clean shutdown where server.close() *does* call back promptly ---
  {
    const exitCodes = [];
    let dbClosed = false;

    const fakeServer = {
      close: (cb) => setImmediate(cb),
    };

    registerProcessSafety({
      getServer: () => fakeServer,
      getIO: () => null,
      disconnectDB: async () => { dbClosed = true; },
      forceExitMs: 5000, // large on purpose -- the clean path should win the race
      exit: (code) => exitCodes.push(code),
    });

    process.emit("uncaughtException", new Error("simulated crash"));

    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.strictEqual(exitCodes.length, 1, "process must exit exactly once on a clean shutdown too");
    assert.strictEqual(dbClosed, true, "the DB connection must be closed as part of a clean shutdown");
    console.log("PASS: clean shutdown path closes the DB connection and exits promptly, without waiting for the forced timeout");
  }

  console.log("ALL PROCESS RESILIENCE TESTS PASSED");
};

run().catch((error) => {
  console.error("PROCESS RESILIENCE TEST FAILED", error);
  process.exit(1);
});
