const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createMemoryTelemetryStore,
  createRedisTelemetryStore,
  createTelemetryStoreForRuntime,
} = require("../telemetryStore");

const snapshot = {
  schemaVersion: 1,
  savedAt: 1000,
  vehicles: [],
  observations: [],
  latestSummary: { total: 0, lastUpdated: null },
};

function createRedisMock() {
  const values = new Map();
  const requests = [];

  const fetchImpl = async (url, options) => {
    const command = JSON.parse(options.body);
    requests.push({ url, options, command });

    let result;
    if (command[0] === "GET") {
      result = values.get(command[1]) ?? null;
    } else if (command[0] === "SET") {
      values.set(command[1], command[2]);
      result = "OK";
    } else if (command[0] === "DEL") {
      result = Number(values.delete(command[1]));
    } else {
      throw new Error("Unexpected Redis command");
    }

    return { ok: true, json: async () => ({ result }) };
  };

  return { fetchImpl, requests, values };
}

function createStore(fetchImpl) {
  return createRedisTelemetryStore({
    url: "https://redis.example.test",
    token: "test-redis-bearer",
    fetchImpl,
  });
}

test("Redis telemetry store saves and restores snapshots", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);

  await store.save(snapshot);

  assert.equal(redis.requests[0].command[0], "SET");
  assert.equal(redis.requests[0].command[1], "jbl:telemetry:snapshot");
  assert.deepEqual(JSON.parse(redis.requests[0].command[2]), snapshot);
  assert.deepEqual(await store.load(), snapshot);
  assert.equal(redis.requests[1].command[0], "GET");
});

test("Redis telemetry snapshots expire after fifteen minutes", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);

  await store.save(snapshot);

  assert.deepEqual(redis.requests[0].command.slice(3), ["EX", "900"]);
});

test("Redis telemetry store clears the snapshot", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);

  await store.save(snapshot);
  await store.clear();

  assert.equal(redis.requests[1].command[0], "DEL");
  assert.equal(await store.load(), null);
});

test("Redis telemetry store rejects invalid stored JSON", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);
  redis.values.set("jbl:telemetry:snapshot", "{invalid");

  await assert.rejects(
    store.load(),
    (error) => error.code === "TELEMETRY_STORE_INVALID_DATA"
  );
});

test("Redis telemetry store rejects oversized snapshots", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);

  await assert.rejects(
    store.save({ data: "x".repeat(5 * 1024 * 1024) }),
    (error) => error.code === "TELEMETRY_STORE_INVALID_DATA"
  );
});

test("Redis telemetry store reports safe read failures", async () => {
  const store = createStore(async () => {
    throw new Error("private network detail");
  });

  await assert.rejects(
    store.load(),
    (error) =>
      error.code === "TELEMETRY_STORE_READ_FAILED" &&
      !error.message.includes("private network detail")
  );
});

test("local telemetry store saves and restores snapshots", async () => {
  const store = createMemoryTelemetryStore();

  await store.save(snapshot);
  assert.deepEqual(await store.load(), snapshot);

  await store.clear();
  assert.equal(await store.load(), null);
});

test("runtime selects Redis on Vercel and memory locally", () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ result: null }) });

  const vercelStore = createTelemetryStoreForRuntime({
    env: {
      VERCEL: "1",
      UPSTASH_REDIS_REST_URL: "https://redis.example.test",
      UPSTASH_REDIS_REST_TOKEN: "test-token",
    },
    fetchImpl,
  });

  const localStore = createTelemetryStoreForRuntime({
    env: {},
    fetchImpl,
  });

  assert.equal(typeof vercelStore.load, "function");
  assert.equal(typeof localStore.load, "function");
});

test("Vercel runtime rejects missing Redis configuration", () => {
  assert.throws(
    () => createTelemetryStoreForRuntime({ env: { VERCEL: "1" } }),
    /Invalid telemetry Redis configuration/
  );
});
