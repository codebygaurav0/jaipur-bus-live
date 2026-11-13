const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const test = require("node:test");
const dns = require("node:dns");
const https = require("node:https");

process.env.VERCEL = "1";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-redis-token";
process.env.JCTSL_AUTH_TOKEN = "test-environment-token";
process.env.JCTSL_USER_ID = "test-environment-user";
process.env.JCTSL_DIAGNOSTIC_MODE = "true";

const redis = {
  mode: "missing",
  record: null,
};
const providerRequests = [];

globalThis.fetch = async (_url, options) => {
  if (redis.mode === "failure") throw new Error("storage unavailable");
  const command = JSON.parse(options.body);
  let result = null;
  if (command[0] === "GET") {
    result = redis.record;
  } else if (command[0] === "SET") {
    redis.record = command[2];
    result = "OK";
  } else if (command[0] === "DEL") {
    const existed = redis.record !== null;
    redis.record = null;
    result = Number(existed);
  } else if (command[0] === "EVAL") {
    const current = redis.record;
    const expected = JSON.parse(command[4]);
    let matches = current === command[4];
    if (!matches && current && command[1].includes("cjson.decode")) {
      try {
        const parsed = JSON.parse(current);
        matches =
          parsed.authToken === expected.authToken &&
          parsed.userId === expected.userId;
      } catch {}
    }
    if (matches) {
      redis.record = null;
      result = 1;
    }
  }
  return { ok: true, json: async () => ({ result }) };
};

dns.promises.resolve4 = async () => ["127.0.0.1"];
https.request = (options, callback) => {
  const request = new EventEmitter();
  request.destroy = (error) => request.emit("error", error);
  request.end = (body) => {
    providerRequests.push({
      path: options.path,
      headers: options.headers,
      body: body ? JSON.parse(body) : null,
    });
    const response = new EventEmitter();
    response.statusCode = 200;
    response.headers = { "content-type": "application/json" };
    queueMicrotask(() => {
      callback(response);
      response.emit(
        "data",
        Buffer.from(JSON.stringify({
          respCode: "200",
          respMessage: "Success",
          respData: [],
        }))
      );
      response.emit("end");
    });
  };
  return request;
};

const {
  app,
  ensureAuthHeaders,
} = require("../server");

async function withServer(run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function getJson(baseUrl, route, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${route}`, { headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
      });
    }).on("error", reject);
  });
}

test("Vercel missing Redis session returns 401 despite environment credentials", async () => {
  redis.mode = "missing";
  redis.record = null;

  const headers = await ensureAuthHeaders({
    headers: {
      "auth-token": "test-inbound-token",
      "user-id": "test-inbound-user",
    },
  });
  assert.equal(headers, null);

  await withServer(async (baseUrl) => {
    const response = await getJson(baseUrl, "/api/auth/session");
    assert.equal(response.status, 401);
    assert.equal(response.body.authenticated, false);
    assert.equal(response.body.error.code, "AUTH_REQUIRED");
    const liveResponse = await getJson(baseUrl, "/api/live-buses", {
      "auth-token": "test-inbound-token",
      "user-id": "test-inbound-user",
    });
    assert.equal(liveResponse.status, 401);
    assert.equal(liveResponse.body.error.code, "AUTH_REQUIRED");
  });
});

test("Vercel Redis read failure returns 503 instead of environment fallback", async () => {
  redis.mode = "failure";
  await withServer(async (baseUrl) => {
    const response = await getJson(baseUrl, "/api/auth/session");
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "SESSION_STORE_UNAVAILABLE");
    const liveResponse = await getJson(baseUrl, "/api/live-buses");
    assert.equal(liveResponse.status, 503);
    assert.equal(liveResponse.body.error.code, "SESSION_STORE_UNAVAILABLE");
  });
});

test("Vercel valid Redis session is provider-verified and sent upstream", async () => {
  redis.mode = "available";
  redis.record = JSON.stringify({
    authToken: "test-redis-session",
    userId: "test-redis-user",
  });
  providerRequests.length = 0;

  await withServer(async (baseUrl) => {
    const response = await getJson(baseUrl, "/api/auth/session");
    assert.equal(response.status, 200);
    assert.equal(response.body.authenticated, true);
  });

  const validationRequest = providerRequests.find((request) =>
    request.path.includes("allvehloc")
  );
  assert.ok(validationRequest);
  assert.equal(validationRequest.headers["Auth-token"], "test-redis-session");
  assert.equal(validationRequest.headers["User-ID"], "test-redis-user");
  assert.equal(JSON.parse(redis.record).authToken, "test-redis-session");
});

test("Vercel logout cannot reactivate environment or inbound credentials", async () => {
  redis.mode = "available";
  redis.record = null;

  await withServer(async (baseUrl) => {
    const response = await new Promise((resolve, reject) => {
      const request = http.request(
        `${baseUrl}/api/auth/logout`,
        {
          method: "POST",
          headers: {
            "auth-token": "test-inbound-token",
            "user-id": "test-inbound-user",
          },
        },
        (result) => {
          const chunks = [];
          result.on("data", (chunk) => chunks.push(chunk));
          result.on("end", () =>
            resolve({
              status: result.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            })
          );
        }
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(response.status, 200);
    const session = await getJson(baseUrl, "/api/auth/session");
    assert.equal(session.status, 401);
    assert.equal(session.body.error.code, "AUTH_REQUIRED");
  });
});
