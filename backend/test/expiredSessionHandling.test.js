const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const dns = require("node:dns");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

process.env.JCTSL_DIAGNOSTIC_MODE = "true";

// Mock DNS so it never attempts real external lookup
dns.promises.resolve4 = async () => ["127.0.0.1"];

let mockRoutesHandler = null;
let mockAllVehLocHandler = null;

// Intercept https.request to simulate JCTSL upstream responses
https.request = (options, callback) => {
  const req = new EventEmitter();
  req.destroy = (err) => req.emit("error", err);
  req.write = () => {};
  req.end = () => {
    const res = new EventEmitter();
    const chunks = [];

    let handler = null;
    if (options.path.includes("allvehloc")) {
      handler = mockAllVehLocHandler;
    } else if (options.path.includes("getAvailableroutes")) {
      handler = mockRoutesHandler;
    }

    if (!handler) {
      // Default: network error
      queueMicrotask(() => req.emit("error", new Error("Unexpected test path: " + options.path)));
      return;
    }

    const mockResult = handler(options);
    if (mockResult.error) {
      const err = new Error(mockResult.error.message || "Network error");
      err.code = mockResult.error.code || "ECONNRESET";
      queueMicrotask(() => req.emit("error", err));
      return;
    }

    res.statusCode = mockResult.status || 200;
    res.headers = {
      "content-type": mockResult.contentType || "application/json; charset=UTF-8",
      ...(mockResult.headers || {}),
    };

    queueMicrotask(() => {
      callback(res);
      if (mockResult.body !== undefined && mockResult.body !== null) {
        res.emit("data", Buffer.from(mockResult.body));
      }
      res.emit("end");
    });
  };

  return req;
};

const {
  verifyRestoredJctslSession,
  checkUpstreamSessionValidity,
  parseLiveBusResponse,
} = require("../server");
const { createSessionManager, createSessionStore } = require("../sessionStore");

function createTemporaryStore(t) {
  const tempPath = path.join(
    os.tmpdir(),
    `jbl-session-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  t.after(() => {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {}
  });
  return createSessionStore(tempPath);
}

const testCandidate = {
  authToken: "test-auth-token-12345",
  userId: "99999",
};

// 1. Explicit 401 expiry
test("1. Explicit 401 expiry: allvehloc returns 401 session-expired", async () => {
  mockAllVehLocHandler = () => ({
    status: 401,
    contentType: "application/json; charset=UTF-8",
    body: JSON.stringify({
      respCode: "401",
      respMessage: "Your session has been expired",
    }),
  });

  const parsed = parseLiveBusResponse({
    ok: false,
    status: 401,
    isJson: true,
    data: { respCode: "401", respMessage: "Your session has been expired" },
  });
  assert.equal(parsed.success, false);
  assert.equal(parsed.errorCode, "AUTH_SESSION_EXPIRED");

  const result = await verifyRestoredJctslSession(testCandidate);
  assert.equal(result.success, false);
  assert.equal(result.rejected, true);
  assert.equal(result.errorCode, "AUTH_SESSION_EXPIRED");
});

// 2. Empty allvehloc + validation 401
test("2. Empty allvehloc + validation 401: confirms expiry and triggers session clearing", async (t) => {
  mockAllVehLocHandler = () => ({
    status: 200,
    contentType: "text/html; charset=UTF-8",
    body: "", // Empty 0-byte body
  });

  mockRoutesHandler = () => ({
    status: 401,
    contentType: "application/json; charset=UTF-8",
    body: JSON.stringify({
      respCode: "401",
      respMessage: "Your session has been expired",
    }),
  });

  const store = createTemporaryStore(t);
  store.save(testCandidate);

  const manager = createSessionManager({
    store,
    verifySession: verifyRestoredJctslSession,
  });

  const restoreResult = await manager.ensureRestoredSession();
  assert.equal(restoreResult.success, false);
  assert.equal(restoreResult.errorCode, "AUTH_REQUIRED");
  assert.equal(manager.hasActiveSession(), false);

  // Expired session must be cleanly cleared from the store
  assert.equal(store.load().session, null);
});

// 3. Empty allvehloc + validation success
test("3. Empty allvehloc + validation success: preserves session without clearing", async (t) => {
  mockAllVehLocHandler = () => ({
    status: 200,
    contentType: "text/html; charset=UTF-8",
    body: "", // Empty 0-byte body
  });

  mockRoutesHandler = () => ({
    status: 200,
    contentType: "application/json; charset=UTF-8",
    body: JSON.stringify({
      respCode: "200",
      respMessage: "Available routes fetched successfully",
      respData: [],
    }),
  });

  const store = createTemporaryStore(t);
  store.save(testCandidate);

  const manager = createSessionManager({
    store,
    verifySession: verifyRestoredJctslSession,
  });

  const restoreResult = await manager.ensureRestoredSession();
  assert.equal(restoreResult.success, false);
  assert.equal(restoreResult.errorCode, "NON_JSON_RESPONSE");
  assert.equal(manager.hasActiveSession(), false);

  // Session must be PRESERVED in the store (not cleared)
  const saved = store.load().session;
  assert.ok(saved);
  assert.equal(saved.authToken, testCandidate.authToken);
});

// 4. Validation network failure
test("4. Validation network failure: preserves session on network error", async (t) => {
  mockAllVehLocHandler = () => ({
    status: 200,
    contentType: "text/html; charset=UTF-8",
    body: "", // Empty 0-byte body
  });

  mockRoutesHandler = () => ({
    error: { message: "Connection reset by peer", code: "ECONNRESET" },
  });

  const store = createTemporaryStore(t);
  store.save(testCandidate);

  const manager = createSessionManager({
    store,
    verifySession: verifyRestoredJctslSession,
  });

  const restoreResult = await manager.ensureRestoredSession();
  assert.equal(restoreResult.success, false);
  assert.equal(restoreResult.errorCode, "NON_JSON_RESPONSE");
  assert.equal(manager.hasActiveSession(), false);

  // Session must be PRESERVED in the store (never cleared on network failure)
  const saved = store.load().session;
  assert.ok(saved);
  assert.equal(saved.authToken, testCandidate.authToken);
});

// 5. Normal valid live-bus response
test("5. Normal valid live-bus response: activates session and digests telemetry", async (t) => {
  mockAllVehLocHandler = () => ({
    status: 200,
    contentType: "application/json; charset=UTF-8",
    body: JSON.stringify({
      respCode: "200",
      respMessage: "All vehicle info successfully",
      respData: [
        {
          vehno: "RJ14PC9999",
          curlat: "26.9124",
          curlong: "75.7873",
          speed: "35",
          devid: "dev-001",
          rno: "9A",
        },
      ],
    }),
  });

  const store = createTemporaryStore(t);
  store.save(testCandidate);

  const manager = createSessionManager({
    store,
    verifySession: verifyRestoredJctslSession,
  });

  const restoreResult = await manager.ensureRestoredSession();
  assert.equal(restoreResult.success, true);
  assert.equal(manager.hasActiveSession(), true);
  assert.equal(manager.getActiveSession().authToken, testCandidate.authToken);

  // Stored session remains intact
  const saved = store.load().session;
  assert.ok(saved);
  assert.equal(saved.authToken, testCandidate.authToken);
});
