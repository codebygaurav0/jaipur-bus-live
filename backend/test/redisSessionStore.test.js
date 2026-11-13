const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createRedisSessionStore,
  createSessionManager,
  createSessionStore,
  createSessionStoreForRuntime,
} = require("../sessionStore");

const sessionA = { authToken: "test-token-a", userId: "test-user" };
const sessionB = { authToken: "test-token-b", userId: "test-user" };

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
    } else if (command[0] === "EVAL") {
      const current = values.get(command[3]);
      let matches = current === command[4];
      if (!matches && command[1].includes("cjson.decode") && current) {
        try {
          const currentSession = JSON.parse(current);
          const expectedSession = JSON.parse(command[4]);
          matches =
            currentSession.authToken === expectedSession.authToken &&
            String(currentSession.userId) === String(expectedSession.userId);
        } catch {}
      }
      if (matches) {
        values.delete(command[3]);
        result = 1;
      } else {
        result = 0;
      }
    } else {
      throw new Error("Unexpected Redis command");
    }
    return { ok: true, json: async () => ({ result }) };
  };
  return { fetchImpl, requests, values };
}

function createStore(fetchImpl) {
  return createRedisSessionStore({
    url: "https://redis.example.test",
    token: "test-redis-bearer",
    fetchImpl,
  });
}

test("Redis session reads return only validated auth fields", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);
  redis.values.set(
    "jbl:jctsl:session",
    JSON.stringify({ ...sessionA, profile: "must not escape" })
  );

  assert.deepEqual(await store.load(), { session: sessionA, invalid: false });
});

test("Redis session replacement uses SET with only authToken and userId", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);
  await store.save({ ...sessionA, profile: { name: "must not persist" } });
  await store.save(sessionB);

  assert.equal(redis.requests[0].command[0], "SET");
  assert.deepEqual(JSON.parse(redis.requests[0].command[2]), sessionA);
  assert.deepEqual(await store.load(), { session: sessionB, invalid: false });
  assert.equal(redis.requests.every((request) =>
    request.options.headers.Authorization === "Bearer test-redis-bearer"), true);
});

test("Redis invalidation atomically deletes only the matching session", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);
  await store.save(sessionA);
  await store.save(sessionB);

  assert.equal(await store.clearIfMatch(sessionA), false);
  assert.deepEqual(await store.load(), { session: sessionB, invalid: false });
  assert.equal(await store.clearIfMatch(sessionB), true);
  assert.deepEqual(await store.load(), { session: null, invalid: false });
  assert.equal(redis.requests.some((request) => request.command[0] === "EVAL"), true);
});

test("Redis invalidation matches sessions independent of JSON property order", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);
  redis.values.set(
    "jbl:jctsl:session",
    JSON.stringify({ userId: sessionA.userId, authToken: sessionA.authToken })
  );

  assert.equal(await store.clearIfMatch(sessionA), true);
  assert.equal(redis.values.has("jbl:jctsl:session"), false);
});

test("invalid Redis session data is compare-and-deleted", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);
  redis.values.set("jbl:jctsl:session", JSON.stringify({ authToken: "incomplete" }));

  assert.deepEqual(await store.load(), { session: null, invalid: true });
  assert.equal(redis.values.has("jbl:jctsl:session"), false);
});

test("malformed JSON, arrays, and non-string user IDs are rejected in Redis", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);

  for (const invalidValue of [
    "{",
    JSON.stringify([sessionA]),
    JSON.stringify({ authToken: sessionA.authToken, userId: 123 }),
    JSON.stringify({ authToken: "", userId: sessionA.userId }),
  ]) {
    redis.values.set("jbl:jctsl:session", invalidValue);
    assert.deepEqual(await store.load(), { session: null, invalid: true });
    assert.equal(redis.values.has("jbl:jctsl:session"), false);
  }
});

test("Redis request failures are surfaced with safe error codes", async () => {
  const store = createStore(async () => {
    throw new Error("sensitive provider response must not be copied");
  });

  await assert.rejects(store.load(), (error) => {
    assert.equal(error.code, "SESSION_STORE_READ_FAILED");
    assert.equal(error.message, "Upstash session storage is unavailable");
    return true;
  });
});

test("session manager fails closed when Redis cannot be read", async () => {
  const store = createStore(async () => {
    throw new Error("sensitive provider response must not be copied");
  });
  let verificationCalled = false;
  const manager = createSessionManager({
    store,
    verifySession: async () => {
      verificationCalled = true;
      return { success: true };
    },
  });

  assert.deepEqual(await manager.ensureRestoredSession(), {
    success: false,
    errorCode: "SESSION_STORE_READ_FAILED",
  });
  assert.equal(verificationCalled, false);
  assert.equal(manager.hasActiveSession(), false);
});

test("Redis write and clear failures are surfaced without response details", async () => {
  const store = createStore(async () => ({
    ok: false,
    json: async () => ({ error: "sensitive response detail" }),
  }));

  await assert.rejects(store.save(sessionA), (error) => {
    assert.equal(error.code, "SESSION_STORE_WRITE_FAILED");
    assert.equal(error.message, "Upstash session storage request failed");
    return true;
  });
  await assert.rejects(store.clear(), (error) => {
    assert.equal(error.code, "SESSION_STORE_CLEAR_FAILED");
    assert.equal(error.message, "Upstash session storage request failed");
    return true;
  });
});

test("session manager restores Redis sessions and compare-deletes rejected sessions", async () => {
  const redis = createRedisMock();
  const store = createStore(redis.fetchImpl);
  await store.save(sessionA);
  const manager = createSessionManager({
    store,
    verifySession: async () => ({ success: true }),
  });

  test("Vercel session manager never accepts configured credentials", async () => {
    const redis = createRedisMock();
    const store = createStore(redis.fetchImpl);
    const manager = createSessionManager({
      store,
      verifySession: async () => ({ success: true }),
      requireStoredSession: true,
    });

    assert.throws(
      () => manager.setConfiguredSession(sessionA),
      (error) => error.code === "CONFIGURED_SESSION_DISABLED"
    );
    assert.deepEqual(await manager.ensureRestoredSession(), {
      success: false,
      errorCode: "AUTH_REQUIRED",
    });
  });

  test("delayed Redis initialization cannot activate configured credentials", async () => {
    let releaseRead;
    const delayedLoad = new Promise((resolve) => {
      releaseRead = () => resolve({ session: null, invalid: false });
    });
    const store = {
      refreshOnRead: true,
      load: () => delayedLoad,
      save: async () => {},
      clear: async () => {},
    };
    const manager = createSessionManager({
      store,
      verifySession: async () => ({ success: true }),
      requireStoredSession: true,
    });
    assert.throws(
      () => manager.setConfiguredSession(sessionA),
      (error) => error.code === "CONFIGURED_SESSION_DISABLED"
    );

    let settled = false;
    const validation = manager.ensureRestoredSession().then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    releaseRead();
    assert.deepEqual(await validation, { success: false, errorCode: "AUTH_REQUIRED" });
  });

  test("logout cannot reactivate a configured session in Vercel mode", async () => {
    const redis = createRedisMock();
    const store = createStore(redis.fetchImpl);
    await store.save(sessionA);
    const manager = createSessionManager({
      store,
      verifySession: async () => ({ success: true }),
      requireStoredSession: true,
    });
    assert.deepEqual(await manager.ensureRestoredSession(), { success: true });
    await manager.logout();

    assert.throws(
      () => manager.setConfiguredSession(sessionA),
      (error) => error.code === "CONFIGURED_SESSION_DISABLED"
    );
    assert.deepEqual(await manager.ensureRestoredSession(), {
      success: false,
      errorCode: "AUTH_REQUIRED",
    });
  });

  test("local session manager retains configured environment session support", async () => {
    const store = {
      load: () => ({ session: null, invalid: false }),
      save: () => {},
      clear: () => {},
    };
    const manager = createSessionManager({
      store,
      verifySession: async () => ({ success: true }),
    });

    manager.setConfiguredSession(sessionA);
    assert.deepEqual(await manager.ensureRestoredSession(), { success: true });
    assert.equal(manager.getActiveSession().authToken, sessionA.authToken);
  });

  assert.deepEqual(await manager.ensureRestoredSession(), { success: true });
  assert.deepEqual(
    { authToken: manager.getActiveSession().authToken, userId: manager.getActiveSession().userId },
    sessionA
  );

  await manager.invalidateIfCurrent(sessionA);
  assert.equal(manager.hasActiveSession(), false);
  assert.deepEqual(await store.load(), { session: null, invalid: false });
});

test("runtime selects Upstash on Vercel and the local store otherwise", (t) => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ result: null }) });
  const redisStore = createSessionStoreForRuntime({
    env: {
      VERCEL: "1",
      UPSTASH_REDIS_REST_URL: "https://redis.example.test",
      UPSTASH_REDIS_REST_TOKEN: "test-redis-bearer",
    },
    fetchImpl,
  });
  assert.equal(redisStore.refreshOnRead, true);

  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-runtime-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const localStore = createSessionStoreForRuntime({
    env: {},
    localFilePath: path.join(directory, ".session.json"),
  });
  assert.equal(typeof localStore.filePath, "string");
  assert.throws(
    () => createSessionStoreForRuntime({ env: { VERCEL: "1" } }),
    (error) => error.code === "SESSION_STORE_CONFIGURATION_ERROR"
  );
});

test("local file store retains compare-and-delete compatibility", (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-local-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSessionStore(path.join(directory, ".session.json"));
  store.save(sessionA);

  assert.equal(store.clearIfMatch(sessionB), false);
  assert.deepEqual(store.load(), { session: sessionA, invalid: false });
  assert.equal(store.clearIfMatch(sessionA), true);
  assert.deepEqual(store.load(), { session: null, invalid: false });
});
