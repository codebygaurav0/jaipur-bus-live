const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

process.env.JCTSL_AUTH_TOKEN = "";
process.env.JCTSL_USER_ID = "";
process.env.JCTSL_SESSION_FILE = path.join(
  os.tmpdir(),
  `jbl-jctsl-endpoints-${process.pid}.json`
);

const {
  app,
  refreshJctslSession,
  ensureAuthHeaders,
  parseLiveBusResponse,
  allowOtpRequest,
} = require("../server");
const { telemetryEngine } = require("../telemetryEngine");

async function withServer(run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("bus stop catalog returns the canonical fallback with explicit metadata", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/bus-stops`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.respCode, "200");
    assert.equal(data.success, true);
    assert.equal(data.isFallback, true);
    assert.equal(data.dataAvailable, true);
    assert.equal(typeof data.timestamp, "string");
    assert.ok(Array.isArray(data.respData));
    assert.ok(data.respData.length > 100);
    assert.ok(data.respData[0].bus_stop_name);
  });
});

test("routes catalog returns the canonical fallback with explicit metadata", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/routes`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.respCode, "200");
    assert.equal(data.success, true);
    assert.equal(data.isFallback, true);
    assert.equal(data.dataAvailable, true);
    assert.ok(Array.isArray(data.respData));
    assert.ok(data.respData.length > 5);
    assert.ok(data.respData[0].route_id);
  });
});

test("live buses reports unavailable instead of an empty successful live result", async () => {
  telemetryEngine.processTelemetry([]);
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/live-buses`);
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.dataAvailable, false);
    assert.equal(data.respCode, "0");
    assert.equal(data.upstreamReachable, false);
    assert.equal(data.isCached, false);
    assert.deepEqual(data.respData, []);
  });
});

test("status endpoint returns safe diagnostics without user credentials", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ok");
    assert.equal(data.hasActiveSession, false);
    assert.ok(data.telemetry);
    assert.ok(data.catalogs);
    const raw = JSON.stringify(data).toLowerCase();
    assert.equal(raw.includes("authtoken"), false);
    assert.equal(raw.includes("user-id"), false);
    assert.equal(raw.includes("password"), false);
    assert.equal(raw.includes("mobile"), false);
  });
});

test("expired sessions do not trigger a login or OTP bypass", async () => {
  assert.equal(await ensureAuthHeaders(), null);
  assert.equal(await refreshJctslSession(), false);
});

test("OTP requests are rate limited by mobile and source IP", () => {
  const now = 1_900_000_000_000;
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(allowOtpRequest("test-ip", "1234567890", now), true);
  }
  assert.equal(allowOtpRequest("test-ip", "1234567890", now), false);
  assert.equal(
    allowOtpRequest("test-ip", "1234567890", now + 10 * 60 * 1000),
    true
  );
});

test("live-bus parsing distinguishes a valid zero from invalid upstream responses", () => {
  const empty = parseLiveBusResponse({
    ok: true,
    isJson: true,
    data: { respCode: "200", respData: [] },
  });
  assert.equal(empty.success, true);
  assert.deepEqual(empty.vehicles, []);

  assert.deepEqual(parseLiveBusResponse({
    ok: true,
    isJson: false,
    data: null,
  }), {
    success: false,
    errorCode: "NON_JSON_RESPONSE",
  });

  assert.deepEqual(parseLiveBusResponse({
    ok: true,
    isJson: true,
    data: { respCode: "403", respData: [] },
  }), {
    success: false,
    errorCode: "INVALID_UPSTREAM_RESPONSE",
  });

  assert.deepEqual(parseLiveBusResponse({
    ok: false,
    status: 401,
    isJson: true,
    data: null,
  }), {
    success: false,
    errorCode: "AUTH_SESSION_EXPIRED",
  });
});

test("caller-controlled city_url cannot receive provider auth headers", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/bus-stops?city_url=${encodeURIComponent("https://example.invalid/")}`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.message, "city_url must use the configured JCTSL HTTPS origin");
  });
});
