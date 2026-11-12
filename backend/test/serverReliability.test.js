const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

process.env.JCTSL_AUTH_TOKEN = "";
process.env.JCTSL_USER_ID = "";
process.env.JCTSL_SESSION_FILE = path.join(
  os.tmpdir(),
  `jbl-server-reliability-${process.pid}.json`
);

const {
  app,
  upstreamState,
  updateUpstreamSuccess,
  updateUpstreamFailure,
  TRANSIENT_ERROR_CODES,
  JCTSL_BASE_URL,
  JCTSL_HOST,
} = require("../server");
const { telemetryEngine } = require("../telemetryEngine");

test("JCTSL_BASE_URL is normalized and JCTSL_HOST matches hostname", () => {
  assert.ok(JCTSL_BASE_URL.endsWith("/"));
  assert.equal(JCTSL_HOST, new URL(JCTSL_BASE_URL).hostname);
  assert.ok(JCTSL_BASE_URL.includes("/OMB/"));
});

test("TRANSIENT_ERROR_CODES only contains network errors and not auth or client codes", () => {
  assert.ok(TRANSIENT_ERROR_CODES.has("ETIMEDOUT"));
  assert.ok(TRANSIENT_ERROR_CODES.has("ECONNRESET"));
  assert.ok(TRANSIENT_ERROR_CODES.has("UND_ERR_CONNECT_TIMEOUT"));
  assert.equal(TRANSIENT_ERROR_CODES.has("401"), false);
  assert.equal(TRANSIENT_ERROR_CODES.has("403"), false);
  assert.equal(TRANSIENT_ERROR_CODES.has("AUTH_ERROR"), false);
});

test("upstreamState tracks success and sanitized failure without credentials", () => {
  updateUpstreamSuccess();
  assert.equal(upstreamState.reachable, true);
  assert.ok(upstreamState.lastSuccessAt);
  assert.equal(upstreamState.consecutiveFailures, 0);

  updateUpstreamFailure("ETIMEDOUT");
  assert.equal(upstreamState.reachable, false);
  assert.equal(upstreamState.lastErrorCode, "ETIMEDOUT");
  assert.equal(upstreamState.consecutiveFailures, 1);

  // Unsanitized code with strange characters is safely normalized
  updateUpstreamFailure("error with spaces and <script>");
  assert.equal(upstreamState.lastErrorCode, "UNKNOWN");
});

test("/api/health never exposes PII, tokens, or credentials", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.success, true);
    assert.equal(typeof data.hasActiveSession, "boolean");
    assert.ok(data.upstream);
    assert.ok("reachable" in data.upstream);

    // Strict PII audit
    const rawString = JSON.stringify(data).toLowerCase();
    assert.equal(rawString.includes("sessionuser"), false, "sessionUser must not be present");
    assert.equal(rawString.includes("authtoken"), false, "authToken must not be present");
    assert.equal(rawString.includes("user-id"), false, "User-ID must not be present");
    assert.equal(rawString.includes("mobile"), false, "mobile must not be present");
    assert.equal(rawString.includes("email"), false, "email must not be present");
    assert.equal(rawString.includes("firstname"), false, "firstName must not be present");
    assert.equal(rawString.includes("lastname"), false, "lastName must not be present");
    assert.equal(rawString.includes("password"), false, "password must not be present");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("/api/auth/session explains when no server-side JCTSL session is available", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/session`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.authenticated, false);
    assert.equal(data.user, null);
    assert.equal(data.error.code, "AUTH_REQUIRED");
    assert.match(data.error.message, /server-side JCTSL session/i);
    assert.equal(JSON.stringify(data).toLowerCase().includes("authtoken"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("/api/live-buses distinguishes unavailable telemetry from cached real telemetry", async () => {
  telemetryEngine.processTelemetry([]);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // A missing session and empty cache must not resemble a genuine zero-bus response.
    const resNoAuth = await fetch(`http://127.0.0.1:${port}/api/live-buses`);
    assert.equal(resNoAuth.status, 503);
    const unavailable = await resNoAuth.json();
    assert.equal(unavailable.success, false);
    assert.equal(unavailable.respCode, "0");
    assert.equal(unavailable.isCached, false);
    assert.equal(unavailable.error.code, "AUTH_REQUIRED");
    assert.match(unavailable.respMessage, /no active server-side JCTSL session/i);

    telemetryEngine.processTelemetry([{
      vehno: "RJ14TEST001",
      rno: "1",
      curlat: "26.9",
      curlong: "75.8",
    }]);
    const resCached = await fetch(`http://127.0.0.1:${port}/api/live-buses`);
    assert.equal(resCached.status, 200);
    const cached = await resCached.json();
    assert.equal(cached.success, true);
    assert.equal(cached.isCached, true);
    assert.equal(cached.upstreamReachable, false);
    assert.equal(cached.respData.length, 1);

    const summary = telemetryEngine.getSummary();
    const vehicles = telemetryEngine.getLiveVehicles();
    assert.ok(Array.isArray(vehicles));
    assert.ok(typeof summary === "object");
    telemetryEngine.processTelemetry([]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
