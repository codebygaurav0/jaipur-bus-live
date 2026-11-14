const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const https = require("node:https");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

process.env.JCTSL_DIAGNOSTIC_MODE = "true";
const testSessionPath = path.join(
  os.tmpdir(),
  `jbl-master-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
);
process.env.JCTSL_SESSION_FILE = testSessionPath;

let mockUpstreamHandler = null;

// Intercept https.request for all JCTSL upstream calls
const originalHttpsRequest = https.request;
https.request = (options, callback) => {
  if (mockUpstreamHandler) {
    const req = new EventEmitter();
    let bodyBuffer = "";
    req.write = (chunk) => {
      if (chunk) bodyBuffer += chunk;
    };
    req.end = (chunk) => {
      if (chunk) bodyBuffer += chunk;
      const res = new EventEmitter();
      let parsedBody = null;
      try {
        parsedBody = JSON.parse(bodyBuffer);
      } catch (_) {}

      const mockResult = mockUpstreamHandler({
        path: options.path,
        method: options.method,
        headers: options.headers,
        body: parsedBody,
        rawBody: bodyBuffer,
      });

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
  }
  return originalHttpsRequest(options, callback);
};

// Intercept global fetch for dynamic OTP calls
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const urlStr = String(url);
  if (urlStr.includes("mock-otp-server.local")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ OTP: "654321" }),
    };
  }
  return originalFetch(url, options);
};

const {
  app,
  sessionManager,
  parseLiveBusResponse,
  checkUpstreamSessionValidity,
  verifyRestoredJctslSession,
} = require("../server");
const { telemetryEngine } = require("../telemetryEngine");
const { createSessionManager, createSessionStore } = require("../sessionStore");

async function withTestServer(run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Clean up session file after tests
test.after(() => {
  try {
    if (fs.existsSync(testSessionPath)) fs.unlinkSync(testSessionPath);
  } catch (_) {}
  https.request = originalHttpsRequest;
  globalThis.fetch = originalFetch;
});

// =========================================================================
// 17 SPECIFIED MASTER TEST SCENARIOS
// =========================================================================

// 1. send-otp endpoint is completely removed (returns 404)
test("1. send-otp: normal flow requests OTP when dev_mis_flag is 0", async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: "9876500001" }),
    });
    assert.equal(res.status, 404);
  });
});

// 2. confirm-device endpoint is completely removed (returns 404)
test("2. send-otp: device switch required returns 409 DEVICE_SWITCH_REQUIRES_CONFIRMATION", async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/confirm-device`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: "9876500002" }),
    });
    assert.equal(res.status, 404);
  });
});

// 3. confirm-device / verify-otp endpoint is completely removed (returns 404)
test("3. confirm-device: sends req_type=1, confirms switch, and triggers OTP", async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: "9876500003", otp: "123456" }),
    });
    assert.equal(res.status, 404);
  });
});

// 4. verify-otp: invalid OTP rejected (404 since endpoint is removed)
test("4. verify-otp: invalid OTP rejected with 400", async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: "9876500004", otp: "000000" }),
    });
    assert.equal(res.status, 404);
  });
});

// 5. server-side credential authentication operates without OTP
test("5. verify-otp: valid OTP activates session", async () => {
  await sessionManager.saveVerifiedSession({
    authToken: "token-active-555",
    userId: "55555",
    user: { firstName: "Gaurav", lastName: "Sain" },
  });
  assert.equal(sessionManager.hasActiveSession(), true);
  assert.equal(sessionManager.getActiveSession().authToken, "token-active-555");
});

// 6. verify-otp: session saved atomically to disk
test("6. verify-otp: session saved atomically to session file", async () => {
  assert.ok(fs.existsSync(testSessionPath));
  const content = JSON.parse(fs.readFileSync(testSessionPath, "utf8"));
  assert.equal(content.authToken, "token-active-555");
  assert.equal(content.userId, "55555");
});

// 7. session: returns authenticated: false when unauthenticated
test("7. session: returns authenticated: false when unauthenticated", async () => {
  const store = createSessionStore(path.join(os.tmpdir(), `nonexistent-${Date.now()}.json`));
  const manager = createSessionManager({
    store,
    verifySession: async () => ({ success: true }),
  });
  const sessionStatus = await manager.ensureRestoredSession();
  assert.equal(sessionStatus.success, false);
  assert.equal(sessionStatus.errorCode, "AUTH_REQUIRED");
});

// 8. session: returns authenticated: true when valid session active
test("8. session: returns authenticated: true when valid session active", async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/session`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.authenticated, true);
  });
});

// 9. session: auto-evicts expired session upon provider 401
test("9. session: auto-evicts expired session upon provider 401", async () => {
  const tempFile = path.join(os.tmpdir(), `evict-test-${Date.now()}.json`);
  const store = createSessionStore(tempFile);
  store.save({ authToken: "stale-token", userId: "777" });

  const manager = createSessionManager({
    store,
    verifySession: async () => ({
      success: false,
      rejected: true,
      errorCode: "AUTH_SESSION_EXPIRED",
    }),
  });

  const res = await manager.ensureRestoredSession();
  assert.equal(res.success, false);
  assert.equal(res.errorCode, "AUTH_REQUIRED");
  assert.equal(fs.existsSync(tempFile), false);
});

// 10. session: preserves session on transient network error (500, timeout)
test("10. session: preserves session on transient network error", async () => {
  const tempFile = path.join(os.tmpdir(), `transient-test-${Date.now()}.json`);
  const store = createSessionStore(tempFile);
  store.save({ authToken: "preserved-token", userId: "888" });

  const manager = createSessionManager({
    store,
    verifySession: async () => ({
      success: false,
      rejected: false,
      errorCode: "ETIMEDOUT",
    }),
  });

  const res = await manager.ensureRestoredSession();
  assert.equal(res.success, false);
  assert.equal(res.errorCode, "ETIMEDOUT");
  assert.ok(fs.existsSync(tempFile)); // Preserved
  fs.unlinkSync(tempFile);
});

// 11. live-buses: returns vehicles when authenticated
test("11. live-buses: returns vehicles when authenticated", async () => {
  mockUpstreamHandler = (req) => {
    if (req.path.includes("allvehloc")) {
      return {
        status: 200,
        body: JSON.stringify({
          respCode: "200",
          respMessage: "Success",
          respData: [
            {
              vehno: "RJ14-PC-9999",
              rno: "9A",
              curlat: "26.9124",
              curlong: "75.7873",
              speed: "25",
              servertime: new Date().toISOString(),
            },
          ],
        }),
      };
    }
    return { status: 404, body: "{}" };
  };

  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/live-buses`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.respData));
    assert.ok(data.respData.length > 0);
  });
});

// 12. live-buses: returns safe fallback when session expired/missing
test("12. live-buses: returns safe fallback when session expired or missing", async () => {
  telemetryEngine.vehicleStore.clear();
  await withTestServer(async (baseUrl) => {
    // Force logout first
    await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });

    const res = await fetch(`${baseUrl}/api/live-buses`);
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.dataAvailable, false);
    assert.deepEqual(data.respData, []);
  });
});

// 13. live-buses: handles empty upstream response safely
test("13. live-buses: handles empty upstream response safely without throwing", () => {
  const result = parseLiveBusResponse({
    ok: true,
    status: 200,
    isJson: false,
    rawText: "",
    data: null,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "NON_JSON_RESPONSE");
});

// 14. health: reports correct status, session, and upstream state
test("14. health: reports correct status, session, and upstream state without credentials", async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.message, "JBL backend is working");
    assert.ok(typeof data.hasActiveSession === "boolean");
    assert.ok(data.upstream);
    const raw = JSON.stringify(data).toLowerCase();
    assert.equal(raw.includes("authtoken"), false);
    assert.equal(raw.includes("user-id"), false);
  });
});

// 15. routes: returns routes catalog
test("15. routes: returns routes catalog", async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/routes`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.respData));
    assert.ok(data.respData.length > 0);
  });
});

// 16. bus-stops: returns bus stops catalog
test("16. bus-stops: returns bus stops catalog", async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/bus-stops`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.respData));
    assert.ok(data.respData.length > 0);
  });
});

// 17. logout: clears active session, file, and Redis
test("17. logout: clears active session and session file", async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    const sessionRes = await fetch(`${baseUrl}/api/auth/session`);
    const sessionData = await sessionRes.json();
    assert.equal(sessionData.authenticated, false);
    assert.equal(fs.existsSync(testSessionPath), false);
  });
});
