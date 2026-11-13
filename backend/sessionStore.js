const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");

function normalizeSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const authToken = value.authToken;
  const rawUserId = value.userId;
  const userId =
    typeof rawUserId === "string" || typeof rawUserId === "number"
      ? String(rawUserId)
      : "";

  if (
    typeof authToken !== "string" ||
    !authToken.trim() ||
    authToken.length > 8192 ||
    !userId.trim() ||
    userId.length > 256
  ) {
    return null;
  }

  return { authToken, userId };
}

function createSessionStore(filePath) {
  const sessionFile = path.resolve(filePath);

  function clear() {
    try {
      fs.unlinkSync(sessionFile);
    } catch (error) {
      if (error.code !== "ENOENT") {
        const safeError = new Error("Unable to clear the local JCTSL session file");
        safeError.code = "SESSION_STORE_CLEAR_FAILED";
        throw safeError;
      }
    }
  }

  function clearIfMatch(value) {
    const expected = normalizeSession(value);
    if (!expected) return false;
    const loaded = load();
    if (
      !loaded.session ||
      loaded.session.authToken !== expected.authToken ||
      loaded.session.userId !== expected.userId
    ) {
      return false;
    }
    clear();
    return true;
  }

  function load() {
    let contents;
    try {
      if (process.platform !== "win32") fs.chmodSync(sessionFile, 0o600);
      contents = fs.readFileSync(sessionFile, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { session: null, invalid: false };
      const safeError = new Error("Unable to read the local JCTSL session file");
      safeError.code = "SESSION_STORE_READ_FAILED";
      throw safeError;
    }

    let parsed;
    try {
      parsed = JSON.parse(contents);
    } catch {
      clear();
      return { session: null, invalid: true };
    }

    const session = normalizeSession(parsed);
    if (!session) {
      clear();
      return { session: null, invalid: true };
    }
    return { session, invalid: false };
  }

  function save(value) {
    const session = normalizeSession(value);
    if (!session) {
      const error = new Error("Refusing to persist an invalid JCTSL session");
      error.code = "INVALID_SESSION";
      throw error;
    }

    const directory = path.dirname(sessionFile);
    const temporaryFile = `${sessionFile}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    let descriptor;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      descriptor = fs.openSync(temporaryFile, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(session), "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryFile, sessionFile);
      if (process.platform !== "win32") fs.chmodSync(sessionFile, 0o600);
    } catch {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {}
      }
      try {
        fs.unlinkSync(temporaryFile);
      } catch {}
      const error = new Error("Unable to persist the local JCTSL session");
      error.code = "SESSION_STORE_WRITE_FAILED";
      throw error;
    }
  }

  return { clear, clearIfMatch, load, save, filePath: sessionFile };
}

function createRedisSessionStore({
  url,
  token,
  fetchImpl = globalThis.fetch,
  key = "jbl:jctsl:session",
}) {
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    throw new TypeError("A valid Upstash Redis REST URL is required");
  }
  if (
    endpoint.protocol !== "https:" ||
    typeof token !== "string" ||
    !token.trim() ||
    typeof fetchImpl !== "function" ||
    typeof key !== "string" ||
    !key.trim()
  ) {
    throw new TypeError("Valid Upstash Redis session store configuration is required");
  }

  const redisUrl = endpoint.toString().replace(/\/$/, "");
  const deleteIfMatchScript =
    "local current = redis.call('GET', KEYS[1]); if not current then return 0 end; local ok, stored = pcall(cjson.decode, current); local expected = cjson.decode(ARGV[1]); if ok and type(stored) == 'table' and stored.authToken == expected.authToken and stored.userId == expected.userId then return redis.call('DEL', KEYS[1]) else return 0 end";
  const deleteRawIfMatchScript =
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

  async function command(parts, failureCode) {
    let response;
    try {
      response = await fetchImpl(redisUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parts),
      });
    } catch {
      const error = new Error("Upstash session storage is unavailable");
      error.code = failureCode;
      throw error;
    }

    if (!response?.ok) {
      const error = new Error("Upstash session storage request failed");
      error.code = failureCode;
      throw error;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      const error = new Error("Upstash returned an invalid session storage response");
      error.code = failureCode;
      throw error;
    }
    if (!payload || payload.error || !Object.hasOwn(payload, "result")) {
      const error = new Error("Upstash session storage request failed");
      error.code = failureCode;
      throw error;
    }
    return payload.result;
  }

  async function load() {
    const value = await command(["GET", key], "SESSION_STORE_READ_FAILED");
    if (value === null) return { session: null, invalid: false };
    if (typeof value !== "string") {
      const error = new Error("Upstash returned an invalid stored session");
      error.code = "SESSION_STORE_READ_FAILED";
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      await deleteRawIfMatch(value);
      return { session: null, invalid: true };
    }
    const session =
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof parsed.authToken === "string" &&
      typeof parsed.userId === "string"
        ? normalizeSession(parsed)
        : null;
    if (!session) {
      await deleteRawIfMatch(value);
      return { session: null, invalid: true };
    }
    return { session, invalid: false };
  }

  async function deleteRawIfMatch(value) {
    await command(
      ["EVAL", deleteRawIfMatchScript, "1", key, value],
      "SESSION_STORE_CLEAR_FAILED"
    );
  }

  async function save(value) {
    const session = normalizeSession(value);
    if (!session) {
      const error = new Error("Refusing to persist an invalid JCTSL session");
      error.code = "INVALID_SESSION";
      throw error;
    }
    await command(
      ["SET", key, JSON.stringify(session)],
      "SESSION_STORE_WRITE_FAILED"
    );
  }

  async function clear() {
    await command(["DEL", key], "SESSION_STORE_CLEAR_FAILED");
  }

  async function clearIfMatch(value) {
    const session = normalizeSession(value);
    if (!session) return false;
    const result = await command(
      [
        "EVAL",
        deleteIfMatchScript,
        "1",
        key,
        JSON.stringify(session),
      ],
      "SESSION_STORE_CLEAR_FAILED"
    );
    return Number(result) === 1;
  }

  return { clear, clearIfMatch, load, save, refreshOnRead: true };
}

function createSessionStoreForRuntime({
  env = process.env,
  localFilePath,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (env.VERCEL === "1") {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      const error = new Error("Upstash Redis session storage is not configured");
      error.code = "SESSION_STORE_CONFIGURATION_ERROR";
      throw error;
    }
    return createRedisSessionStore({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
      fetchImpl,
    });
  }
  if (!localFilePath) {
    throw new TypeError("A local session file path is required outside Vercel");
  }
  return createSessionStore(localFilePath);
}

function createSessionManager({
  store,
  verifySession,
  requireStoredSession = false,
}) {
  if (!store || typeof verifySession !== "function") {
    throw new TypeError("A session store and session verifier are required");
  }

  let activeSession = null;
  let activeSource = null;
  let restoredSession = null;
  let validationPromise = null;
  let lastValidationErrorCode = null;

  function getActiveSession() {
    return activeSession;
  }

  function sameSession(left, right) {
    const normalizedLeft = normalizeSession(left);
    const normalizedRight = normalizeSession(right);
    return Boolean(
      normalizedLeft &&
        normalizedRight &&
        normalizedLeft.authToken === normalizedRight.authToken &&
        normalizedLeft.userId === normalizedRight.userId
    );
  }

  function applyLoadedSession(loaded) {
    if (loaded.session) {
      if (!sameSession(activeSession, loaded.session) || activeSource !== "stored") {
        activeSession = null;
        activeSource = null;
        restoredSession = loaded.session;
      }
      lastValidationErrorCode = null;
      return;
    }
    if (activeSource === "stored") {
      activeSession = null;
      activeSource = null;
    }
    restoredSession = null;
    if (loaded.invalid) {
      lastValidationErrorCode = "INVALID_STORED_SESSION";
    } else if (lastValidationErrorCode !== "AUTH_REQUIRED") {
      lastValidationErrorCode = null;
    }
  }

  let initialLoadPromise;
  try {
    const loaded = store.load();
    if (loaded && typeof loaded.then === "function") {
      initialLoadPromise = loaded.then(applyLoadedSession).catch((error) => {
        lastValidationErrorCode = error.code || "SESSION_STORE_READ_FAILED";
      });
    } else {
      applyLoadedSession(loaded);
      initialLoadPromise = Promise.resolve();
    }
  } catch (error) {
    lastValidationErrorCode = error.code || "SESSION_STORE_READ_FAILED";
    initialLoadPromise = Promise.resolve();
  }

  function hasActiveSession() {
    return Boolean(activeSession);
  }

  function hasRestoredSession() {
    return Boolean(restoredSession);
  }

  function getLastValidationErrorCode() {
    return lastValidationErrorCode;
  }

  function setConfiguredSession(session) {
    if (requireStoredSession) {
      const error = new Error("Configured sessions are disabled for this runtime");
      error.code = "CONFIGURED_SESSION_DISABLED";
      throw error;
    }
    const normalized = normalizeSession(session);
    if (!normalized) throw new TypeError("Configured JCTSL session is invalid");
    activeSession = { ...session, ...normalized };
    activeSource = "configured";
    restoredSession = null;
    lastValidationErrorCode = null;
  }

  function saveVerifiedSession(session) {
    const normalized = normalizeSession(session);
    if (!normalized) throw new TypeError("Verified JCTSL session is invalid");
    const saved = store.save(normalized);
    const activate = () => {
      activeSession = { ...session, ...normalized };
      activeSource = "stored";
      restoredSession = null;
      lastValidationErrorCode = null;
    };
    if (saved && typeof saved.then === "function") return saved.then(activate);
    activate();
  }

  function logout() {
    const cleared = store.clear();
    const finish = () => {
      activeSession = null;
      activeSource = null;
      restoredSession = null;
      lastValidationErrorCode = null;
    };
    if (cleared && typeof cleared.then === "function") return cleared.then(finish);
    finish();
  }

  function invalidate() {
    return invalidateIfCurrent(activeSession);
  }

  async function invalidateIfCurrent(value) {
    const expected = normalizeSession(value);
    if (!expected) return false;
    const activeMatches = sameSession(activeSession, expected);
    if (activeMatches) {
      activeSession = null;
      activeSource = null;
    }
    if (sameSession(restoredSession, expected)) restoredSession = null;
    lastValidationErrorCode = "AUTH_REQUIRED";

    let cleared = false;
    if (typeof store.clearIfMatch === "function") {
      cleared = await store.clearIfMatch(expected);
    } else if (activeMatches) {
      await store.clear();
      cleared = true;
    }
    return cleared;
  }

  async function refreshFromStore() {
    await initialLoadPromise;
    if (!store.refreshOnRead) return;
    const loaded = await store.load();
    applyLoadedSession(loaded);
  }

  async function ensureRestoredSession() {
    try {
      await refreshFromStore();
    } catch (error) {
      lastValidationErrorCode = error.code || "SESSION_STORE_READ_FAILED";
      return { success: false, errorCode: lastValidationErrorCode };
    }
    if (activeSession) return { success: true };
    if (!restoredSession) {
      return {
        success: false,
        errorCode: lastValidationErrorCode || "AUTH_REQUIRED",
      };
    }
    if (validationPromise) return validationPromise;

    const candidate = restoredSession;
    validationPromise = (async () => {
      let result;
      try {
        result = await verifySession(candidate);
      } catch (error) {
        result = {
          success: false,
          errorCode: /^[A-Z0-9_:-]{1,64}$/i.test(error?.code || "")
            ? error.code
            : "SESSION_VALIDATION_FAILED",
        };
      }

      if (result?.success) {
        try {
          await store.save(candidate);
        } catch (error) {
          lastValidationErrorCode = error.code || "SESSION_STORE_WRITE_FAILED";
          return { success: false, errorCode: lastValidationErrorCode };
        }
        activeSession = candidate;
        activeSource = "stored";
        restoredSession = null;
        lastValidationErrorCode = null;
        return { success: true };
      }

      if (result?.rejected) {
        restoredSession = null;
        lastValidationErrorCode = "AUTH_REQUIRED";
        try {
          if (typeof store.clearIfMatch === "function") {
            await store.clearIfMatch(candidate);
          } else {
            await store.clear();
          }
        } catch (error) {
          return {
            success: false,
            errorCode: "AUTH_REQUIRED",
            persistenceErrorCode: error.code || "SESSION_STORE_CLEAR_FAILED",
          };
        }
        return { success: false, errorCode: "AUTH_REQUIRED" };
      }

      lastValidationErrorCode = result?.errorCode || "SESSION_VALIDATION_FAILED";
      return { success: false, errorCode: lastValidationErrorCode };
    })().finally(() => {
      validationPromise = null;
    });

    return validationPromise;
  }

  return {
    ensureRestoredSession,
    getActiveSession,
    getLastValidationErrorCode,
    hasActiveSession,
    hasRestoredSession,
    invalidate,
    invalidateIfCurrent,
    logout,
    saveVerifiedSession,
    setConfiguredSession,
  };
}

module.exports = {
  createRedisSessionStore,
  createSessionManager,
  createSessionStore,
  createSessionStoreForRuntime,
  normalizeSession,
};
