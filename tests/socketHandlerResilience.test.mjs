// Regression test for the production stability bug: every socket.io event
// handler used to be an unguarded `async (...) => {...}` function. If one
// threw (bad payload, transient DB error, etc.) the rejection escaped as a
// process-level unhandledRejection, which server.js's old handler treated
// as fatal for the ENTIRE process -- taking down every other connected
// user over a single bad event.
//
// This test proves wrapAsyncSocketHandler / wrapAsyncConnectionHandler
// catch the error at the source: no unhandledRejection is ever emitted,
// the ack callback still resolves (so the client doesn't hang waiting
// forever), and a scoped error event is sent instead of the whole
// process going down.
import assert from "assert";
import { wrapAsyncSocketHandler, wrapAsyncConnectionHandler } from "../socket/asyncSocketHandler.js";

const makeFakeSocket = () => {
  const emitted = [];
  let disconnected = false;
  return {
    id: "test-socket-1",
    user: { _id: { toString: () => "user-1" } },
    emit: (event, payload) => emitted.push({ event, payload }),
    disconnect: () => { disconnected = true; },
    _emitted: emitted,
    get _disconnected() { return disconnected; },
  };
};

const run = async () => {
  // --- socket.on(event, ...) handler that throws synchronously inside destructuring ---
  {
    const socket = makeFakeSocket();
    let unhandledRejectionFired = false;
    const onUnhandled = () => { unhandledRejectionFired = true; };
    process.on("unhandledRejection", onUnhandled);

    const badHandler = wrapAsyncSocketHandler(socket, "chat:send", async ({ recipientId }) => {
      // Simulates the real bug: destructuring a field off an undefined payload throws.
      return recipientId.toUpperCase();
    });

    let ackResult = null;
    // Call with `undefined` as the payload -- exactly what a malformed/empty
    // client emit produces, and exactly what used to crash the process.
    await badHandler(undefined, (result) => { ackResult = result; });

    // Give any stray microtask a chance to surface before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    process.off("unhandledRejection", onUnhandled);

    assert.strictEqual(unhandledRejectionFired, false, "a throwing handler must NOT produce a process-level unhandledRejection");
    assert.strictEqual(ackResult?.success, false, "the ack callback must still be resolved with a failure instead of hanging");
    assert.ok(socket._emitted.some((e) => e.event === "realtime:error"), "a scoped realtime:error must be emitted to the socket");
    console.log("PASS: throwing socket.on handler is contained -- no process-level unhandledRejection, ack still resolves");
  }

  // --- io.on("connection", ...) handler that throws (e.g. DB hiccup while joining default rooms) ---
  {
    const socket = makeFakeSocket();
    let unhandledRejectionFired = false;
    const onUnhandled = () => { unhandledRejectionFired = true; };
    process.on("unhandledRejection", onUnhandled);

    const badConnectionHandler = wrapAsyncConnectionHandler(async () => {
      throw new Error("simulated DB hiccup while computing default rooms");
    });

    await badConnectionHandler(socket);
    await new Promise((resolve) => setImmediate(resolve));

    process.off("unhandledRejection", onUnhandled);

    assert.strictEqual(unhandledRejectionFired, false, "a throwing connection handler must NOT produce a process-level unhandledRejection");
    assert.ok(socket._disconnected, "the socket should be cleanly disconnected instead of left in a half-initialized state");
    console.log("PASS: throwing connection handler is contained -- no process-level unhandledRejection, socket cleanly disconnected");
  }

  console.log("ALL SOCKET HANDLER RESILIENCE TESTS PASSED");
};

run().catch((error) => {
  console.error("SOCKET HANDLER RESILIENCE TEST FAILED", error);
  process.exit(1);
});
