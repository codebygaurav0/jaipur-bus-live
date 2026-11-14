const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const test = require("node:test");
const dns = require("node:dns");
const https = require("node:https");

// Set runtime environment for Vercel production simulation
process.env.VERCEL = "1";
process.env.NODE_ENV = "production";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-upstash-token";
process.env.JCTSL_AUTH_TOKEN = "test-env-auth-token-secret-123";
process.env.JCTSL_USER_ID = "test-env-user-secret-456";
process.env.ADMIN_API_KEY = "test-admin-secret-key-789";
process.env.JCTSL_DIAGNOSTIC_MODE = "true";

// In-memory Redis simulation
const redisStorage = new Map();
const redisCommands = [];

globalThis.fetch = async (url, options = {}) => {
  if (url.includes("redis.example.test")) {
    const command = JSON.parse(options.body);
    redisCommands.push(command);
    const [action, key, ...args] = command;

    let result = null;
    if (action === "GET") {
      result = redisStorage.has(key) ? redisStorage.get(key) : null;
    } else if (action === "SET") {
      redisStorage.set(key, args[0]);
      result = "OK";
    } else if (action === "DEL") {
      const existed = redisStorage.delete(key);
      result = existed ? 1 : 0;
    } else if (action === "EVAL") {
      const targetKey = args[1];
      const expected = JSON.parse(args[2]);
      const currentRaw = redisStorage.get(targetKey);
      let match = false;
      if (currentRaw) {
        try {
          const current = JSON.parse(currentRaw);
          match =
            current.authToken === expected.authToken &&
            String(current.userId) === String(expected.userId);
        } catch {}
      }
      if (match) {
        redisStorage.delete(targetKey);
        result = 1;
      } else {
        result = 0;
      }
    }
    return {
      ok: true,
      json: async () => ({ result }),
    };
  }

  return {
    ok: true,
    json: async () => ({}),
  };
};

dns.promises.resolve4 = async () => ["127.0.0.1"];

let upstreamStatus = 200;
let upstreamShouldFail = false;
let upstreamVehicles = [
  {
    vehno: "RJ14PC1001",
    rno: "AC-1",
    curlat: "26.9124",
    curlong: "75.7873",
    speed: "28.5",
  },
  {
    vehno: "RJ14PC1002",
    rno: "9A",
    curlat: "26.9200",
    curlong: "75.7900",
    speed: "0.0",
  },
];

https.request = (options, callback) => {
  const req = new EventEmitter();
  req.destroy = (err) => req.emit("error", err);
  req.end = (body) => {
    const res = new EventEmitter();
    res.statusCode = upstreamShouldFail ? 500 : upstreamStatus;
    res.headers = { "content-type": "application/json; charset=UTF-8" };

    queueMicrotask(() => {
      callback(res);
      if (upstreamShouldFail) {
        res.emit(
          "data",
          Buffer.from(JSON.stringify({ respCode: "500", respMessage: "Upstream failure" }))
        );
      } else if (options.path.includes("allvehloc")) {
        res.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              respCode: "200",
              respMessage: "Success",
              respData: upstreamVehicles,
            })
          )
        );
      } else if (options.path.includes("citibuslist")) {
        res.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              respCode: "200",
              respMessage: "Success",
              respData: [
                { bus_stop_id: "1", stop_name: "Ajmeri Gate", lat: "26.91", long: "75.82" },
              ],
            })
          )
        );
      } else if (options.path.includes("getAvailableroutes")) {
        res.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              respCode: "200",
              respMessage: "Success",
              respData: [
                { route_id: "1", route_orgno: "AC-1", route_name: "Sanganer to Ajmeri Gate" },
              ],
            })
          )
        );
      } else {
        res.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              respCode: "200",
              respMessage: "Success",
              respData: [],
            })
          )
        );
      }
      res.emit("end");
    });
  };
  return req;
};

const {
  app,
  ensureAuthHeaders,
  sessionManager,
  telemetryEngine,
  telemetryStore,
  setLastLiveBusFetchTimestamp,
} = require("../server");
const {
  createRedisSessionStore,
} = require("../sessionStore");
const {
  createRedisTelemetryStore,
} = require("../telemetryStore");

async function withServer(fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function requestJson(url, options = {}) {
  const method = options.method || "GET";
  const headers = options.headers || {};
  const body = options.body ? JSON.stringify(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data,
          raw,
        });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("1. Public visitor accessing /api/live-buses without auth headers returns 200 with vehicle data", async () => {
  redisStorage.clear();
  upstreamShouldFail = false;

  await withServer(async (baseUrl) => {
    // Visitor makes clean GET request without any auth tokens or user IDs
    const res = await requestJson(`${baseUrl}/api/live-buses`);
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.respCode, "200");
    assert.equal(Array.isArray(res.data.respData), true);
    assert.equal(res.data.respData.length, 2);
    assert.equal(res.data.respData[0].vehicleNumber, "RJ14PC1001");
    // Ensure no auth was demanded
    assert.equal(res.data.requiresAuth, undefined);
  });
});

test("2. Public visitor accessing /api/bus-stops and /api/routes without auth headers returns 200 catalog", async () => {
  await withServer(async (baseUrl) => {
    // 2a. Bus stops catalog
    const stopsRes = await requestJson(`${baseUrl}/api/bus-stops`);
    assert.equal(stopsRes.status, 200);
    assert.equal(stopsRes.data.success, true);
    assert.equal(Array.isArray(stopsRes.data.respData), true);
    assert.ok(stopsRes.data.respData.length > 0);
    assert.equal(stopsRes.data.requiresAuth, undefined);

    // 2b. Available routes catalog
    const routesRes = await requestJson(`${baseUrl}/api/routes`);
    assert.equal(routesRes.status, 200);
    assert.equal(routesRes.data.success, true);
    assert.equal(Array.isArray(routesRes.data.respData), true);
    assert.ok(routesRes.data.respData.length > 0);
    assert.equal(routesRes.data.requiresAuth, undefined);
  });
});

test("3. Redis session storage and retrieval uses only minimal jbl:jctsl:session key", async () => {
  const store = createRedisSessionStore({
    url: "https://redis.example.test",
    token: "test-upstash-token",
  });

  redisCommands.length = 0;
  await store.save({
    authToken: "valid-token-abc",
    userId: "valid-user-123",
    extraSecretPII: "should-not-be-stored",
  });

  const lastSet = redisCommands.find((c) => c[0] === "SET" && c[1] === "jbl:jctsl:session");
  assert.ok(lastSet);
  const storedJson = JSON.parse(lastSet[2]);
  assert.deepEqual(storedJson, { authToken: "valid-token-abc", userId: "valid-user-123" });
  assert.equal(storedJson.extraSecretPII, undefined);

  const loaded = await store.load();
  assert.equal(loaded.session.authToken, "valid-token-abc");
  assert.equal(loaded.session.userId, "valid-user-123");
});

test("4. Telemetry snapshot caching in Redis uses jbl:telemetry:snapshot with 15-minute TTL", async () => {
  const teleStore = createRedisTelemetryStore({
    url: "https://redis.example.test",
    token: "test-upstash-token",
  });

  redisCommands.length = 0;
  const dummySnapshot = {
    schemaVersion: 1,
    savedAt: Date.now(),
    vehicles: [["RJ14PC1001", { vehicleNumber: "RJ14PC1001", currentTimestamp: Date.now() }]],
    observations: [],
    latestSummary: { totalReceived: 1, validGps: 1 },
  };

  await teleStore.save(dummySnapshot);

  const saveCmd = redisCommands.find((c) => c[0] === "SET" && c[1] === "jbl:telemetry:snapshot");
  assert.ok(saveCmd);
  assert.equal(saveCmd[3], "EX");
  assert.equal(saveCmd[4], "900"); // Exactly 900 seconds = 15 minutes TTL

  const loaded = await teleStore.load();
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(loaded.vehicles[0][0], "RJ14PC1001");
});

test("5. Serverless cold start restores session and telemetry from Redis", async () => {
  // Pre-seed Redis
  redisStorage.set(
    "jbl:jctsl:session",
    JSON.stringify({ authToken: "persisted-token-xyz", userId: "persisted-user-999" })
  );
  redisStorage.set(
    "jbl:telemetry:snapshot",
    JSON.stringify({
      schemaVersion: 1,
      savedAt: Date.now(),
      vehicles: [
        [
          "RJ14COLD01",
          {
            vehicleNumber: "RJ14COLD01",
            currentTimestamp: Date.now(),
            latitude: 26.9,
            longitude: 75.8,
            routeNumber: "1",
            status: "LIVE · MOVING",
          },
        ],
      ],
      observations: [],
      latestSummary: { totalReceived: 1, validGps: 1, lastUpdated: new Date().toISOString() },
    })
  );

  const headers = await ensureAuthHeaders({});
  assert.ok(headers);
  assert.equal(headers["Auth-token"], "persisted-token-xyz");
  assert.equal(headers["User-ID"], "persisted-user-999");
});

test("6. Automatic initialization from environment variables when Redis session is missing", async () => {
  redisStorage.delete("jbl:jctsl:session");
  await sessionManager.invalidate();

  // Fresh cold start with missing session: initializes from process.env.JCTSL_AUTH_TOKEN
  const headers = await ensureAuthHeaders({});
  assert.ok(headers);
  assert.equal(headers["Auth-token"], "test-env-auth-token-secret-123");
  assert.equal(headers["User-ID"], "test-env-user-secret-456");

  // Verify that it saved the verified session into Redis
  assert.ok(redisStorage.has("jbl:jctsl:session"));
  const saved = JSON.parse(redisStorage.get("jbl:jctsl:session"));
  assert.equal(saved.authToken, "test-env-auth-token-secret-123");
  assert.equal(saved.userId, "test-env-user-secret-456");
});

test("7. Graceful degradation when upstream JCTSL is down serves cached snapshot with 200", async () => {
  upstreamShouldFail = true;
  setLastLiveBusFetchTimestamp(0);

  // Process a known telemetry record into the engine so cache exists
  telemetryEngine.processTelemetry([
    {
      vehno: "RJ14CACHED99",
      rno: "5",
      curlat: "26.9100",
      curlong: "75.8100",
      speed: "35.0",
    },
  ]);

  await withServer(async (baseUrl) => {
    const res = await requestJson(`${baseUrl}/api/live-buses`);
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.isCached, true);
    assert.equal(res.data.upstreamReachable, false);
    assert.ok(res.data.respData.length >= 1);
    assert.ok(res.data.respData.some((v) => v.vehicleNumber === "RJ14CACHED99"));
    assert.equal(res.data.requiresAuth, undefined);
  });

  upstreamShouldFail = false;
});

test("8. Verify no tokens or sensitive headers are leaked in public API responses", async () => {
  await withServer(async (baseUrl) => {
    const endpoints = [
      "/api/live-buses",
      "/api/bus-stops",
      "/api/routes",
      "/api/routes/search?q=1",
      "/api/health",
      "/api/status",
    ];

    for (const ep of endpoints) {
      const res = await requestJson(`${baseUrl}${ep}`);
      const rawText = res.raw;

      assert.equal(
        rawText.includes("test-env-auth-token-secret-123"),
        false,
        `Token leaked in ${ep}`
      );
      assert.equal(
        rawText.includes("test-upstash-token"),
        false,
        `Redis token leaked in ${ep}`
      );
      assert.equal(
        rawText.includes("test-admin-secret-key-789"),
        false,
        `Admin key leaked in ${ep}`
      );
    }
  });
});

test("9. Verify OTP endpoints are completely removed and return 404", async () => {
  await withServer(async (baseUrl) => {
    // 9a. /api/auth/send-otp is completely removed (returns 404)
    const sendOtpRes = await requestJson(`${baseUrl}/api/auth/send-otp`, {
      method: "POST",
      body: { mobile: "9876543210" },
    });
    assert.equal(sendOtpRes.status, 404);

    // 9b. /api/auth/confirm-device is completely removed (returns 404)
    const confirmDeviceRes = await requestJson(`${baseUrl}/api/auth/confirm-device`, {
      method: "POST",
      body: { mobile: "9876543210" },
    });
    assert.equal(confirmDeviceRes.status, 404);

    // 9c. /api/auth/verify-otp is completely removed (returns 404)
    const verifyOtpRes = await requestJson(`${baseUrl}/api/auth/verify-otp`, {
      method: "POST",
      body: { mobile: "9876543210", otp: "1234" },
    });
    assert.equal(verifyOtpRes.status, 404);
  });
});


test("10. Serverless on-demand fetching: serves cache within 15s and refreshes from upstream when stale", async () => {
  upstreamShouldFail = false;
  upstreamVehicles = [
    {
      vehno: "RJ14ONDEMAND1",
      rno: "1A",
      curlat: "26.9124",
      curlong: "75.7873",
      speed: "22.0",
    },
  ];

  await withServer(async (baseUrl) => {
    // Force cache to be older than 15s
    setLastLiveBusFetchTimestamp(Date.now() - 20000);

    const res1 = await requestJson(`${baseUrl}/api/live-buses`);
    assert.equal(res1.status, 200);
    assert.equal(res1.data.isCached, false);
    assert.equal(res1.data.upstreamReachable, true);
    assert.ok(res1.data.respData.some((v) => v.vehicleNumber === "RJ14ONDEMAND1"));

    // Second immediate call within 15s serves from cache without hitting upstream
    const res2 = await requestJson(`${baseUrl}/api/live-buses`);
    assert.equal(res2.status, 200);
    assert.equal(res2.data.isCached, true);
  });
});
