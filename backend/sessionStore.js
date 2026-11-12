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

  return { clear, load, save, filePath: sessionFile };
}

function createSessionManager({ store, verifySession }) {
  if (!store || typeof verifySession !== "function") {
    throw new TypeError("A session store and session verifier are required");
  }

  const loaded = store.load();
  let activeSession = null;
  let restoredSession = loaded.session;
  let validationPromise = null;
  let lastValidationErrorCode = loaded.invalid ? "INVALID_STORED_SESSION" : null;

  function getActiveSession() {
    return activeSession;
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
    const normalized = normalizeSession(session);
    if (!normalized) throw new TypeError("Configured JCTSL session is invalid");
    activeSession = { ...session, ...normalized };
    restoredSession = null;
    lastValidationErrorCode = null;
  }

  function saveVerifiedSession(session) {
    const normalized = normalizeSession(session);
    if (!normalized) throw new TypeError("Verified JCTSL session is invalid");
    store.save(normalized);
    activeSession = { ...session, ...normalized };
    restoredSession = null;
    lastValidationErrorCode = null;
  }

  function logout() {
    activeSession = null;
    restoredSession = null;
    lastValidationErrorCode = null;
    store.clear();
  }

  function invalidate() {
    activeSession = null;
    restoredSession = null;
    lastValidationErrorCode = "AUTH_REQUIRED";
    store.clear();
  }

  async function ensureRestoredSession() {
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
          store.save(candidate);
        } catch (error) {
          lastValidationErrorCode = error.code || "SESSION_STORE_WRITE_FAILED";
          return { success: false, errorCode: lastValidationErrorCode };
        }
        activeSession = candidate;
        restoredSession = null;
        lastValidationErrorCode = null;
        return { success: true };
      }

      if (result?.rejected) {
        restoredSession = null;
        lastValidationErrorCode = "AUTH_REQUIRED";
        try {
          store.clear();
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
    logout,
    saveVerifiedSession,
    setConfiguredSession,
  };
}

module.exports = {
  createSessionManager,
  createSessionStore,
  normalizeSession,
};
