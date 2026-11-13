const express = require("express");
const cors = require("cors");
const dns = require("dns");
const https = require("https");
const path = require("path");
const { createHash } = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { telemetryEngine } = require("./telemetryEngine");
const { runJctslNetworkDiagnostic } = require("./jctslNetworkDiagnostic");
const {
  createSessionManager,
  createSessionStoreForRuntime,
} = require("./sessionStore");

// Force IPv4 DNS resolution first to avoid IPv6 NAT64 prefix (64:ff9b::) timeouts on cloud hosts (Render/Docker/Linux)
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

const app = express();

const allowedOrigins = new Set([
  "https://jaipur-bus-live.web.app",
  "http://localhost:1588",
  "http://127.0.0.1:1588",
  ...(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin));
  },
}));
app.use(express.json({ limit: "100kb" }));

const PORT = process.env.PORT || 11000;
const JCTSL_DIAGNOSTIC_MODE = process.env.JCTSL_DIAGNOSTIC_MODE === "true";

const rawBaseUrl = (process.env.JCTSL_BASE_URL || "https://www.omnificent.co.in/OMB/").trim();
const JCTSL_BASE_URL = rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`;
const parsedBaseUrl = new URL(JCTSL_BASE_URL);
if (parsedBaseUrl.protocol !== "https:") {
  throw new Error("JCTSL_BASE_URL must use HTTPS");
}
const JCTSL_HOST = parsedBaseUrl.hostname;
const IS_VERCEL_RUNTIME = process.env.VERCEL === "1";

/*
|--------------------------------------------------------------------------
| JCTSL SESSION MANAGEMENT
| Local backends use an atomic file store; Vercel instances share Upstash Redis.
|--------------------------------------------------------------------------
*/
const sessionStore = createSessionStoreForRuntime({
  env: process.env,
  localFilePath:
    process.env.JCTSL_SESSION_FILE || path.join(__dirname, ".session.json"),
});
const sessionManager = createSessionManager({
  store: sessionStore,
  verifySession: verifyRestoredJctslSession,
  requireStoredSession: IS_VERCEL_RUNTIME,
});
const pendingAuthMap = new Map(); // mobile -> { authToken, userId, expectedOtp, respData, timestamp }
const otpRequestLimits = new Map();
const OTP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const OTP_RATE_LIMIT_MAX = 3;

if (sessionManager.hasRestoredSession()) {
  console.log("Loaded a JCTSL session candidate; provider verification is required before use.");
} else if (sessionManager.getLastValidationErrorCode() === "INVALID_STORED_SESSION") {
  console.warn("[JCTSL Auth] Invalid stored session was cleared.");
}

if (
  !IS_VERCEL_RUNTIME &&
  !sessionManager.hasRestoredSession() &&
  process.env.JCTSL_AUTH_TOKEN &&
  process.env.JCTSL_USER_ID
) {
  sessionManager.setConfiguredSession({
    authToken: process.env.JCTSL_AUTH_TOKEN,
    userId: process.env.JCTSL_USER_ID,
    mobile: process.env.JCTSL_MOBILE || "",
    user: {
      mobile: process.env.JCTSL_MOBILE || "",
      firstName: process.env.JCTSL_FIRST_NAME || "",
      lastName: process.env.JCTSL_LAST_NAME || "",
      email: process.env.JCTSL_EMAIL || "",
    },
  });
  console.log("Loaded configured JCTSL credentials from environment.");
}

async function saveSession(session) {
  if (session) {
    await sessionManager.saveVerifiedSession(session);
  } else {
    await sessionManager.logout();
  }
}

function prunePendingAuth(now = Date.now()) {
  for (const [mobile, data] of pendingAuthMap.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) pendingAuthMap.delete(mobile);
  }
}

function allowOtpRequest(ip, mobile, now = Date.now()) {
  for (const [key, limit] of otpRequestLimits.entries()) {
    if (limit.expiresAt <= now) otpRequestLimits.delete(key);
  }
  const keys = [`ip:${ip || "unknown"}`, `mobile:${mobile}`];
  if (otpRequestLimits.size + keys.filter((key) => !otpRequestLimits.has(key)).length > 5000) {
    return false;
  }
  if (keys.some((key) => (otpRequestLimits.get(key)?.count || 0) >= OTP_RATE_LIMIT_MAX)) {
    return false;
  }
  for (const key of keys) {
    const current = otpRequestLimits.get(key);
    otpRequestLimits.set(key, {
      count: (current?.count || 0) + 1,
      expiresAt: current?.expiresAt || now + OTP_RATE_LIMIT_WINDOW_MS,
    });
  }
  return true;
}
/*
|--------------------------------------------------------------------------
| BASE & HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    app: "Jaipur Bus Live",
    status: "running",
  });
});

/*
 * Upstream connectivity state â€” updated by pollJctslTelemetry and handleLiveBuses.
 * Never exposes auth tokens, user IDs, or session secrets.
 */
const upstreamState = {
  reachable: null,       // null = unknown (never tested), true/false after first poll
  lastSuccessAt: null,   // ISO timestamp of last successful upstream response
  lastFailureAt: null,   // ISO timestamp of last failed upstream attempt
  lastErrorCode: null,   // sanitized error code from last failure
  consecutiveFailures: 0,
};

function updateUpstreamSuccess() {
  upstreamState.reachable = true;
  upstreamState.lastSuccessAt = new Date().toISOString();
  upstreamState.consecutiveFailures = 0;
  upstreamState.lastErrorCode = null;
}

function updateUpstreamFailure(errorCode) {
  const safe = /^[A-Z0-9_:-]{1,64}$/i.test(errorCode || "") ? errorCode : "UNKNOWN";
  upstreamState.reachable = false;
  upstreamState.lastFailureAt = new Date().toISOString();
  upstreamState.lastErrorCode = safe;
  upstreamState.consecutiveFailures++;
}

function getSafeErrorCode(error, fallback = "UPSTREAM_ERROR") {
  const code = error?.code || error?.cause?.code ||
    (error?.name === "AbortError" ? "ETIMEDOUT" : fallback);
  return /^[A-Z0-9_:-]{1,64}$/i.test(String(code)) ? String(code) : fallback;
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "JBL backend is working",
    hasActiveSession: sessionManager.hasActiveSession(),
    upstream: {
      reachable: upstreamState.reachable,
      lastSuccessAt: upstreamState.lastSuccessAt,
      lastFailureAt: upstreamState.lastFailureAt,
      lastErrorCode: upstreamState.lastErrorCode,
      consecutiveFailures: upstreamState.consecutiveFailures,
    },
    telemetryCacheSize: telemetryEngine.vehicleStore.size,
  });
});

app.get("/api/status", (req, res) => {
  const summary = telemetryEngine.getSummary();
  res.json({
    status: "ok",
    app: "Jaipur Bus Live",
    environment: process.env.NODE_ENV || "production",
    hasActiveSession: sessionManager.hasActiveSession(),
    upstream: {
      reachable: upstreamState.reachable,
      lastSuccessAt: upstreamState.lastSuccessAt,
      lastFailureAt: upstreamState.lastFailureAt,
      lastErrorCode: upstreamState.lastErrorCode,
      consecutiveFailures: upstreamState.consecutiveFailures,
    },
    telemetry: {
      liveVehicles: telemetryEngine.getLiveVehicles().length,
      lastUpdated: summary.lastUpdated,
      moving: summary.liveMoving,
      slow: summary.liveSlow,
      idle: summary.liveIdle,
      stopped: summary.liveStopped,
    },
    catalogs: {
      stopsCached: Boolean(busStopsCache?.respData?.length),
      routesCached: Boolean(availableRoutesCache?.respData?.length),
      canonicalStopsCount: routeSearchEngine.canonicalBusStops?.length || 0,
      canonicalRoutesCount: routeSearchEngine.canonicalRoutes?.length || 0,
    },
  });
});

/*
|--------------------------------------------------------------------------
| SAFE NETWORK & CONNECTIVITY DIAGNOSTIC ENDPOINT
| Used to diagnose cloud host (Render) outbound HTTPS connectivity to JCTSL.
| Strictly reports network metrics, DNS records, TLS details, and error codes.
| NEVER exposes Auth-token, User-ID, session secrets, cookies, or credentials.
|--------------------------------------------------------------------------
*/
app.get("/api/jctsl-network-diagnostic", async (req, res) => {
  if (!JCTSL_DIAGNOSTIC_MODE) {
    return res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  }
  try {
    const result = await runJctslNetworkDiagnostic({
      baseUrl: JCTSL_BASE_URL,
      dnsPromises: dns.promises,
      defaultResultOrder:
        typeof dns.getDefaultResultOrder === "function"
          ? dns.getDefaultResultOrder()
          : "unknown",
      logger: console,
    });
    return res.json(result);
  } catch (error) {
    const code = /^[A-Z0-9_:-]{1,64}$/i.test(error?.code || "")
      ? error.code
      : "DIAGNOSTIC_ERROR";
    console.error(`[JCTSL Diagnostic] stage=handler event=complete code=${code}`);
    return res.status(500).json({
      status: "error",
      error: { code },
    });
  }
});

/*
|--------------------------------------------------------------------------
| HELPER: AUTH CHECK
| Prefers a complete backend session pair; request headers are a fallback only.
| Never exposes credentials to client or logs.
|--------------------------------------------------------------------------
*/
function getAuthHeaders(req) {
  const activeSession = sessionManager.getActiveSession();
  const sessionToken = activeSession?.authToken;
  const sessionUserId = activeSession?.userId;
  const hasActiveSession = Boolean(sessionToken && sessionUserId);
  const headerToken =
    !IS_VERCEL_RUNTIME && req?.headers ? req.headers["auth-token"] : null;
  const headerUserId =
    !IS_VERCEL_RUNTIME && req?.headers ? req.headers["user-id"] : null;
  const authToken = hasActiveSession ? sessionToken : headerToken;
  const userId = hasActiveSession ? sessionUserId : headerUserId;

  if (!authToken || !userId) {
    return null;
  }

  return {
    "User-Agent": "okhttp/4.9.0",
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Auth-token": authToken,
    "User-ID": String(userId),
  };
}

async function ensureAuthHeaders(req) {
  const result = await sessionManager.ensureRestoredSession();
  if (!result.success) {
    if (IS_VERCEL_RUNTIME) return null;
    if (
      result.errorCode !== "AUTH_REQUIRED" &&
      result.errorCode !== "INVALID_STORED_SESSION"
    ) return null;
  }
  return getAuthHeaders(req);
}

function getSessionFailure(errorCode = sessionManager.getLastValidationErrorCode()) {
  if (
    errorCode === "AUTH_REQUIRED" ||
    errorCode === "INVALID_STORED_SESSION" ||
    !errorCode
  ) {
    return {
      status: 401,
      code: "AUTH_REQUIRED",
      message: "No valid server-side JCTSL session is available.",
    };
  }
  if (String(errorCode).startsWith("SESSION_STORE_")) {
    return {
      status: 503,
      code: "SESSION_STORE_UNAVAILABLE",
      message: "The server-side JCTSL session store is temporarily unavailable.",
    };
  }
  return {
    status: 503,
    code: errorCode,
    message: "The saved JCTSL session could not be verified with the provider.",
  };
}

function respondWithSessionFailure(res, errorCode) {
  const failure = getSessionFailure(errorCode);
  return res.status(failure.status).json({
    success: false,
    authenticated: false,
    user: null,
    requiresAuth: failure.status === 401,
    error: {
      code: failure.code,
      message: failure.message,
    },
  });
}

function requestJctslOverIpv4({ url, method, headers, body, timeoutMs }) {
  const parsedUrl = new URL(url);

  return new Promise((resolve, reject) => {
    let request = null;
    let settled = false;

    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    };

    const timer = setTimeout(() => {
      const timeoutError = new Error(
        `Upstream request to ${url} timed out after ${timeoutMs}ms`
      );
      timeoutError.name = "AbortError";
      timeoutError.code = "ETIMEDOUT";
      if (request) request.destroy(timeoutError);
      finish(timeoutError);
    }, timeoutMs);

    dns.promises
      .resolve4(JCTSL_HOST)
      .then((addresses) => {
        if (settled) return;
        if (addresses.length === 0) {
          const dnsError = new Error(`No IPv4 addresses found for ${JCTSL_HOST}`);
          dnsError.code = "ENODATA";
          throw dnsError;
        }

        request = https.request(
          {
            hostname: addresses[0],
            port: parsedUrl.port || 443,
            path: `${parsedUrl.pathname}${parsedUrl.search}`,
            method,
            servername: JCTSL_HOST,
            headers: {
              ...headers,
              ...(body !== undefined && body !== null ? { "Content-Length": Buffer.byteLength(body) } : {}),
              Host: JCTSL_HOST,
            },
          },
          (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("error", (error) => finish(error));
            response.on("end", () => {
              const responseHeaders = new Headers();
              for (const [name, value] of Object.entries(response.headers)) {
                if (Array.isArray(value)) {
                  for (const item of value) responseHeaders.append(name, item);
                } else if (value !== undefined) {
                  responseHeaders.append(name, value);
                }
              }

              const status = response.statusCode || 0;
              finish(null, {
                ok: status >= 200 && status < 300,
                status,
                headers: responseHeaders,
                text: async () => Buffer.concat(chunks).toString("utf8"),
              });
            });
          }
        );

        request.on("error", (error) => finish(error));
        request.end(body);
      })
      .catch((error) => finish(error));
  });
}

/*
|--------------------------------------------------------------------------
| RESILIENT UPSTREAM JCTSL FETCH CLIENT
| - Safe diagnostic logging (URL, method, status, size, error code â€” ZERO credentials)
| - Explicit 12-second AbortController timeout to prevent stuck cloud requests
| - Mobile client headers (User-Agent: okhttp/4.9.0, Accept: application/json)
| - Safe non-JSON response handling (never throws SyntaxError on HTML/PHP notices)
| - Error cause/code preservation for immediate diagnostic insight
| - Single controlled retry for transient network errors (ETIMEDOUT, ECONNRESET)
| - Never retries on auth (401/403) or client errors
|--------------------------------------------------------------------------
*/

// Transient network error codes eligible for a single retry
const TRANSIENT_ERROR_CODES = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ECONNABORTED",
  "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT", "FETCH_ERROR",
]);

let requestCounter = 0;

async function jctslFetchOnce(url, { method, mergedHeaders, requestBody, timeoutMs, context, requestId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Upstream request to ${url} timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const parsedUrl = new URL(url);
    const response =
      parsedUrl.protocol === "https:" &&
      parsedUrl.hostname.toLowerCase() === JCTSL_HOST
        ? await requestJctslOverIpv4({
            url,
            method,
            headers: mergedHeaders,
            body: requestBody,
            timeoutMs,
          })
        : await fetch(url, {
            method,
            headers: mergedHeaders,
            body: requestBody,
            signal: controller.signal,
          });

    const rawText = await response.text();
    const contentType = response.headers.get("content-type") || "unknown";

    // Safe response logging (Zero credentials logged)
    console.log(
      `[JCTSL Upstream Response] requestId=${requestId} | context=${context} | status=${response.status} | contentType=${contentType} | bodyLength=${rawText.length}`
    );

    let jsonData = null;
    let isJson = false;
    try {
      jsonData = JSON.parse(rawText);
      isJson = true;
    } catch (parseErr) {
      console.warn(
        `[JCTSL Upstream Non-JSON] requestId=${requestId} | context=${context} | status=${response.status} | contentType=${contentType}`
      );
    }

    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      contentType,
      rawText,
      isJson,
      data: jsonData,
    };
  } finally {
    clearTimeout(timer);
  }
}

function refreshJctslSession() {
  return Promise.resolve(false);
}

async function jctslFetch(endpoint, {
  method = "POST",
  headers = {},
  body = null,
  timeoutMs = 12000,
  context = "general",
  retry = true,
} = {}) {
  const upstreamUrl = new URL(endpoint, JCTSL_BASE_URL);
  if (upstreamUrl.protocol !== "https:" || upstreamUrl.origin !== parsedBaseUrl.origin) {
    const invalidUrlError = new Error("JCTSL endpoint must use the configured HTTPS origin");
    invalidUrlError.code = "INVALID_UPSTREAM_URL";
    throw invalidUrlError;
  }
  const url = upstreamUrl.toString();

  const requestId = `jbl-${++requestCounter}-${Date.now().toString(36)}`;
  const isVercelRuntime = process.env.VERCEL === "1";
  const effectiveTimeoutMs = isVercelRuntime
    ? Math.min(timeoutMs, 8000)
    : timeoutMs;
  const hasAuthToken = Boolean(headers?.["Auth-token"]);
  const hasUserId = Boolean(headers?.["User-ID"]);

  let orgId = null;
  if (body) {
    try {
      const parsed = typeof body === "string" ? JSON.parse(body) : body;
      orgId = parsed.org_id || parsed.city_id || parsed.route_id || parsed.route_no || null;
    } catch (_) {}
  }

  const requestBody = body
    ? typeof body === "string"
      ? body
      : JSON.stringify(body)
    : undefined;

  const mergedHeaders = {
    "User-Agent": "okhttp/4.9.0",
    "Accept": "application/json",
    ...headers,
  };

  // Safe outbound logging (NEVER print token, user ID, or sensitive body fields)
  console.log(
    `[JCTSL Upstream Request] requestId=${requestId} | context=${context} | method=${method} | url=${url} | org_id=${orgId ?? "N/A"} | hasAuthToken=${hasAuthToken} | hasUserId=${hasUserId}`
  );

  const fetchArgs = {
    method,
    mergedHeaders,
    requestBody,
    timeoutMs: effectiveTimeoutMs,
    context,
    requestId,
  };

  try {
    const result = await jctslFetchOnce(url, fetchArgs);

    return result;
  } catch (firstErr) {
    const cause = firstErr.cause || {};
    const errorCode = getSafeErrorCode(firstErr, "FETCH_ERROR");

    // Only retry once for transient network errors, never for auth/logic errors
    if (!isVercelRuntime && retry && TRANSIENT_ERROR_CODES.has(errorCode)) {
      console.warn(
        `[JCTSL Retry] requestId=${requestId} | context=${context} | code=${errorCode} | retrying once after 1500ms`
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));

      try {
        return await jctslFetchOnce(url, { ...fetchArgs, requestId: `${requestId}-r1` });
      } catch (retryErr) {
        const retryCode = getSafeErrorCode(retryErr, "FETCH_ERROR");
        console.error(
          `[JCTSL Retry Failed] requestId=${requestId}-r1 | context=${context} | code=${retryCode}`
        );
        // Fall through to throw the retry error
        const wrappedError = new Error(retryErr.message || "Fetch failed after retry");
        wrappedError.name = retryErr.name;
        wrappedError.code = retryCode;
        wrappedError.cause = retryErr.cause || {};
        wrappedError.url = url;
        wrappedError.context = context;
        wrappedError.requestId = `${requestId}-r1`;
        throw wrappedError;
      }
    }

    console.error(
      `[JCTSL Fetch Error] requestId=${requestId} | context=${context} | url=${url} | name=${firstErr.name} | code=${errorCode}`
    );

    const wrappedError = new Error(firstErr.message || "Fetch failed");
    wrappedError.name = firstErr.name;
    wrappedError.code = errorCode;
    wrappedError.cause = cause;
    wrappedError.url = url;
    wrappedError.context = context;
    wrappedError.requestId = requestId;
    throw wrappedError;
  }
}

/*
|--------------------------------------------------------------------------
| AUTH: 1. SEND OTP
| Discovered from LoginActivity.java, a0.java (case 2), c.java:
| Step 1: POST https://www.omnificent.co.in/OMB/log/usr with LoginRequest
| Step 2: If dev_mis_flag == "1", confirm device switch with req_type = "1"
| Step 3: Trigger dynamic OTP POST to (respData.sst + country_code + mobile + respData.sen)
|--------------------------------------------------------------------------
*/
app.post("/api/auth/send-otp", async (req, res) => {
  try {
    const { mobile } = req.body || {};
    const cleanMobile = String(mobile || "").replace(/\D/g, "").slice(-10);

    if (cleanMobile.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10-digit mobile number",
      });
    }
    if (!allowOtpRequest(req.ip, cleanMobile)) {
      return res.status(429).json({
        success: false,
        message: "Too many OTP requests. Please try again later.",
        error: { code: "OTP_RATE_LIMITED" },
      });
    }

    const countryCode = "+91";

    // 1. Send LoginRequest to JCTSL /log/usr
    const loginPayload = {
      req_type: "0",
      country_code: countryCode,
      mobile: cleanMobile,
    };
    const deviceFields = [
      "ph_brand", "ph_mdl", "os_ver", "dev_id", "ver_nm", "ver_cd", "fcm_token",
    ];
    for (const field of deviceFields) {
      const value = req.body?.[field] ?? process.env[`JCTSL_${field.toUpperCase()}`];
      if (typeof value === "string" && value.trim() && value.length <= 256) {
        loginPayload[field] = value.trim();
      }
    }

    let logUsrRes = await jctslFetch("log/usr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: loginPayload,
      context: "sendOtp-login",
      timeoutMs: 12000,
    });

    let logUsrData = logUsrRes.isJson ? logUsrRes.data : null;

    if (logUsrData?.respData?.dev_mis_flag === "1") {
      return res.status(409).json({
        success: false,
        message: "JCTSL requires explicit confirmation to switch the registered device",
        error: { code: "DEVICE_SWITCH_REQUIRES_CONFIRMATION" },
      });
    }

    const respData = logUsrData?.respData;
    if (!logUsrRes.ok || !logUsrRes.isJson || !respData?.authToken || !respData?.userId) {
      return res.status(400).json({
        success: false,
        message: "JCTSL could not start the OTP verification flow",
      });
    }

    let expectedOtp = null;

    if (respData.sst && respData.sen) {
      // Dynamic OTP URL from JCTSL server
      const otpUrl = new URL(`${respData.sst}${countryCode}${cleanMobile}${respData.sen}`);
      if (otpUrl.protocol !== "https:" || otpUrl.username || otpUrl.password) {
        return res.status(502).json({
          success: false,
          message: "JCTSL returned an unsupported OTP verification URL",
        });
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let otpFetchRes;
        try {
          otpFetchRes = await fetch(otpUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            redirect: "error",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        const otpJson = otpFetchRes.ok ? await otpFetchRes.json() : null;
        if (typeof otpJson?.OTP === "string" || typeof otpJson?.OTP === "number") {
          expectedOtp = String(otpJson.OTP).trim();
        }
      } catch (otpErr) {
        console.warn("[JCTSL OTP] Provider challenge request failed");
      }
    }

    prunePendingAuth();
    if (pendingAuthMap.size >= 1000 && !pendingAuthMap.has(cleanMobile)) {
      return res.status(503).json({
        success: false,
        message: "OTP verification is temporarily unavailable",
      });
    }

    // Store pending auth state
    pendingAuthMap.set(cleanMobile, {
      authToken: respData.authToken,
      userId: respData.userId,
      expectedOtp,
      respData,
      timestamp: Date.now(),
      failedAttempts: 0,
    });

    return res.json({
      success: true,
      message: "OTP challenge requested",
      verificationAvailable: expectedOtp !== null,
    });
  } catch (error) {
    console.error(`[JCTSL OTP] Request failed (code: ${error.code || "OTP_ERROR"})`);
    return res.status(500).json({
      success: false,
      message: "Error sending OTP through JCTSL",
      error: { code: error.code || "OTP_ERROR" },
    });
  }
});

/*
|--------------------------------------------------------------------------
| AUTH: 2. VERIFY OTP
| Discovered from LoginActivity.java, a0.java (case 3), c.java (case 2), n2.java:
| Step 1: Validate OTP (match expectedOtp or server validation)
| Step 2: POST https://www.omnificent.co.in/OMB/verifyuser with VerifyUserRequest
| Step 3: On respCode == "200" & respMessage == "Success", activate session
|--------------------------------------------------------------------------
*/
app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const { mobile, otp } = req.body || {};
    const cleanMobile = String(mobile || "").replace(/\D/g, "").slice(-10);
    const cleanOtp = String(otp || "").trim();

    if (!cleanMobile || !cleanOtp) {
      return res.status(400).json({
        success: false,
        message: "Mobile and OTP are required",
      });
    }

    const pending = pendingAuthMap.get(cleanMobile);
    if (!pending) {
      return res.status(400).json({
        success: false,
        message: "No pending OTP request found. Please request an OTP first.",
      });
    }

    if (Date.now() - pending.timestamp > 10 * 60 * 1000) {
      pendingAuthMap.delete(cleanMobile);
      return res.status(400).json({
        success: false,
        message: "OTP challenge expired. Please request a new OTP.",
      });
    }
    if (!pending.expectedOtp) {
      return res.status(503).json({
        success: false,
        message: "JCTSL did not provide a verifiable OTP challenge",
        error: { code: "OTP_VERIFICATION_UNAVAILABLE" },
      });
    }
    if (pending.expectedOtp !== cleanOtp) {
      pending.failedAttempts++;
      if (pending.failedAttempts >= 5) pendingAuthMap.delete(cleanMobile);
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please check and try again.",
      });
    }

    // Call official JCTSL verifyuser endpoint
    const verifyPayload = {
      country_code: "+91",
      mobile: cleanMobile,
    };

    const verifyUpstream = await jctslFetch("verifyuser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: verifyPayload,
      context: "verifyOtp",
      timeoutMs: 12000,
    });

    const verifyData = verifyUpstream.isJson ? verifyUpstream.data : null;

    if (
      verifyData?.respCode !== "200" ||
      verifyData?.respMessage !== "Success"
    ) {
      return res.status(400).json({
        success: false,
        message: verifyData?.respMessage || "OTP verification failed",
      });
    }

    // Keep the verified session in memory only; serverless replicas are independent.
    const newSession = {
      authToken: pending.authToken,
      userId: pending.userId,
      mobile: cleanMobile,
      user: {
        mobile: cleanMobile,
        firstName: pending.respData?.first_name || "",
        lastName: pending.respData?.last_name || "",
        email: pending.respData?.user_email || "",
      },
    };

    await saveSession(newSession);
    pendingAuthMap.delete(cleanMobile);

    return res.json({
      success: true,
      message: "Login successful",
      user: sessionManager.getActiveSession().user,
    });
  } catch (error) {
    const errorCode = getSafeErrorCode(error, "OTP_ERROR");
    console.error(`[JCTSL OTP] Verification failed (code: ${errorCode})`);
    if (IS_VERCEL_RUNTIME && errorCode.startsWith("SESSION_STORE_")) {
      return res.status(503).json({
        success: false,
        message: "The server-side JCTSL session store is temporarily unavailable.",
        error: { code: "SESSION_STORE_UNAVAILABLE" },
      });
    }
    return res.status(500).json({
      success: false,
      message: "Error verifying OTP",
      error: { code: errorCode },
    });
  }
});

/*
|--------------------------------------------------------------------------
| AUTH: 3. CURRENT SESSION & LOGOUT
|--------------------------------------------------------------------------
*/
app.get("/api/auth/session", async (req, res) => {
  const validation = await sessionManager.ensureRestoredSession();
  if (!validation.success) {
    if (validation.persistenceErrorCode) {
      console.error(
        `[JCTSL Auth] Rejected session could not be removed (code: ${validation.persistenceErrorCode})`
      );
    }
    if (IS_VERCEL_RUNTIME) {
      return respondWithSessionFailure(res, validation.errorCode);
    }
    const needsAuth = validation.errorCode === "AUTH_REQUIRED" ||
      validation.errorCode === "INVALID_STORED_SESSION";
    const storageUnavailable = validation.errorCode.startsWith("SESSION_STORE_");
    return res.json({
      authenticated: false,
      user: null,
      error: {
        code: needsAuth ? "AUTH_REQUIRED" : validation.errorCode,
        message: storageUnavailable
          ? "The server-side JCTSL session store is temporarily unavailable."
          : needsAuth
            ? "No valid server-side JCTSL session is available."
            : "The saved JCTSL session could not be verified with the provider.",
      },
    });
  }

  return res.json({
    authenticated: true,
    user: null,
  });
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    await saveSession(null);
    return res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    const errorCode = getSafeErrorCode(error, "SESSION_STORE_CLEAR_FAILED");
    const storeFailure = IS_VERCEL_RUNTIME && errorCode.startsWith("SESSION_STORE_");
    return res.status(storeFailure ? 503 : 500).json({
      success: false,
      error: {
        code: storeFailure ? "SESSION_STORE_UNAVAILABLE" : errorCode,
      },
    });
  }
});

/*
|--------------------------------------------------------------------------
| 1. CITIES LIST (POST SUser/citiList)
|--------------------------------------------------------------------------
*/
app.post("/api/cities", async (req, res) => {
  try {
    const headers = await ensureAuthHeaders(req);
    if (!headers) {
      if (IS_VERCEL_RUNTIME) {
        return respondWithSessionFailure(res);
      }
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data",
        requiresAuth: true,
      });
    }

    const upstream = await jctslFetch("SUser/citiList", {
      method: "POST",
      headers,
      body: {},
      context: "handleCities",
      timeoutMs: 12000,
    });

    if (!upstream.isJson || !upstream.data) {
      return res.status(upstream.ok ? 200 : 502).json({
        respCode: "0",
        respMessage: "Upstream JCTSL service returned non-JSON response",
        upstreamStatus: upstream.status,
      });
    }

    return res.status(upstream.status).json(upstream.data);
  } catch (error) {
    const cause = error.cause || {};
    const errorCode = getSafeErrorCode(error, "FETCH_ERROR");
    console.error(`[Cities Error] ${errorCode}`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch cities",
      error: { code: errorCode },
      errorCode,
    });
  }
});

/*
|--------------------------------------------------------------------------
| 2. SHARED IN-MEMORY CACHES & VALIDATION HELPERS
|--------------------------------------------------------------------------
*/
let busStopsCache = null;
let availableRoutesCache = null;
const routeMapCache = new Map();
const routeSearchEngine = require("./routeSearchEngine");

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  return routeSearchEngine.calculateDistanceKm(lat1, lon1, lat2, lon2);
}

const cleanRouteCode = (str) => routeSearchEngine.cleanRouteCode(str);
const cleanText = (str) => routeSearchEngine.cleanText(str);

function resolveStop(input, allStops) {
  return routeSearchEngine.resolveStop(input, allStops || busStopsCache?.respData);
}

function findStopIndexInRoute(orderedStops, targetStop, minIndex = 0) {
  return routeSearchEngine.findStopIndexInRoute(orderedStops, targetStop, minIndex);
}
/*
|--------------------------------------------------------------------------
| REUSABLE STRICT ROUTE VALIDATION ENGINE: findValidRoutesBetweenStops
| Validates that:
| 1. FROM stop exists in that route's actual stop list.
| 2. TO stop exists in the SAME route's actual stop list.
| 3. FROM comes BEFORE TO in that route's actual stop order (fromIndex < toIndex).
| 4. Never matches by route/destination name only.
| 5. If filterRoute is specified, matches exact route first (1 vs 11, E-3 vs E-32).
| 6. Attaches genuine live buses operating on this route/direction.
|--------------------------------------------------------------------------
*/
async function findValidRoutesBetweenStops(
  fromQuery,
  toQuery,
  filterRoute = null,
  headers = null
) {
  // Use real live vehicles from telemetryEngine
  let cityBuses = telemetryEngine.getLiveVehicles();
  if (cityBuses.length === 0) {
    if (!headers) headers = await ensureAuthHeaders();
    if (headers) {
      try {
        const cbRes = await jctslFetch("allvehloc", {
          method: "POST",
          headers,
          body: { org_id: "1" },
          context: "findValidRoutes-allvehloc",
          timeoutMs: 12000,
        });
        if (cbRes.isJson && Array.isArray(cbRes.data?.respData)) {
          cityBuses = cbRes.data.respData;
        }
      } catch (_) {}
    }
  }

  // Ensure stops cache if available
  if (!busStopsCache && headers) {
    try {
      const res = await jctslFetch("usr/citibuslist", {
        method: "POST",
        headers,
        body: { city_id: "1" },
        context: "findValidRoutes-stops",
        timeoutMs: 12000,
      });
      if (res.isJson && res.data?.respCode === "200") busStopsCache = res.data;
    } catch (_) {}
  }

  return routeSearchEngine.searchRoutesBetweenStops({
    from: fromQuery,
    to: toQuery,
    filterRoute,
    liveBuses: cityBuses,
    allStops: busStopsCache?.respData || routeSearchEngine.canonicalBusStops,
    allRoutes: routeSearchEngine.canonicalRoutes,
  });
}
/*
|--------------------------------------------------------------------------
| 2. REAL JCTSL BUS STOPS DATASET (POST/GET usr/citibuslist)
|--------------------------------------------------------------------------
*/
const handleBusStops = async (req, res) => {
  try {
    const cityUrl = req.query?.city_url || req.body?.city_url || JCTSL_BASE_URL;
    if (typeof cityUrl !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid city_url",
      });
    }
    let targetBase;
    try {
      targetBase = new URL(cityUrl, JCTSL_BASE_URL);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Invalid city_url",
      });
    }
    if (targetBase.protocol !== "https:" ||
        targetBase.origin !== parsedBaseUrl.origin ||
        targetBase.username || targetBase.password) {
      return res.status(400).json({
        success: false,
        message: "city_url must use the configured JCTSL HTTPS origin",
      });
    }
    if (!targetBase.pathname.endsWith("/")) {
      targetBase.pathname += "/";
    }

    if (busStopsCache && Array.isArray(busStopsCache.respData) && busStopsCache.respData.length > 0) {
      return res.json({
        ...busStopsCache,
        success: true,
        dataAvailable: true,
        isCached: true,
      });
    }

    const headers = await ensureAuthHeaders(req);
    if (!headers && IS_VERCEL_RUNTIME) {
      return respondWithSessionFailure(res);
    }
    if (headers) {
      const city_id = req.query?.city_id || req.body?.city_id || "1";
      const targetUrl = new URL("usr/citibuslist", targetBase).toString();

      const upstream = await jctslFetch(targetUrl, {
        method: "POST",
        headers,
        body: { city_id: String(city_id) },
        context: "handleBusStops",
        timeoutMs: 12000,
      });

      if (upstream.ok && upstream.isJson && upstream.data?.respCode === "200" && Array.isArray(upstream.data?.respData)) {
        updateUpstreamSuccess();
        busStopsCache = {
          ...upstream.data,
          success: true,
          dataAvailable: true,
          isFallback: false,
          isCached: false,
          upstreamReachable: true,
          timestamp: new Date().toISOString(),
        };
        return res.json(busStopsCache);
      }
      updateUpstreamFailure(upstream.isJson ? "UPSTREAM_RESPONSE_INVALID" : "NON_JSON_RESPONSE");
    }

    // Graceful fallback: Canonical bus stops dataset from backend/data/busStops.json
    console.warn("[Bus Stops] Serving canonical bus stops catalog");
    const fallbackData = {
      success: true,
      dataAvailable: routeSearchEngine.canonicalBusStops.length > 0,
      respCode: "200",
      respMessage: "Success",
      isFallback: true,
      isCached: false,
      upstreamReachable: upstreamState.reachable,
      timestamp: new Date().toISOString(),
      respData: routeSearchEngine.canonicalBusStops,
    };
    return res.json(fallbackData);
  } catch (error) {
    console.error(`[Bus Stops Error] ${error.code || "UPSTREAM_ERROR"}`);
    updateUpstreamFailure(error.code || "UPSTREAM_ERROR");
    return res.json({
      success: true,
      dataAvailable: routeSearchEngine.canonicalBusStops.length > 0,
      respCode: "200",
      respMessage: "Success",
      isFallback: true,
      isCached: false,
      upstreamReachable: false,
      timestamp: new Date().toISOString(),
      respData: routeSearchEngine.canonicalBusStops,
    });
  }
};

app.get("/api/bus-stops", handleBusStops);
app.post("/api/bus-stops", handleBusStops);

/*
|--------------------------------------------------------------------------
| 3. REAL LIVE BUSES FOR NEARBY BUS STOP (POST/GET log/vehnearstop)
|--------------------------------------------------------------------------
*/
const handleBusesNearStop = async (req, res) => {
  try {
    const stopCode =
      req.params?.stopCode ||
      req.query?.stop_code ||
      req.query?.bus_stop_cd ||
      req.body?.bus_stop_cd ||
      req.body?.busStopCode;

    if (!stopCode) {
      return res.status(400).json({
        success: false,
        message: "bus_stop_cd is required",
      });
    }

    const headers = await ensureAuthHeaders(req);
    if (!headers && IS_VERCEL_RUNTIME) {
      return respondWithSessionFailure(res);
    }
    if (headers) {
      const upstream = await jctslFetch("log/vehnearstop", {
        method: "POST",
        headers,
        body: {
          bus_stop_cd: String(stopCode),
          ver_nm: "1.5.1",
          ver_cd: "30",
        },
        context: "handleBusesNearStop",
        timeoutMs: 12000,
      });

      if (upstream.ok && upstream.isJson && upstream.data) {
        updateUpstreamSuccess();
        return res.status(upstream.status).json({
          ...upstream.data,
          success: true,
          dataAvailable: true,
          isFallback: false,
          isCached: false,
          upstreamReachable: true,
          timestamp: new Date().toISOString(),
        });
      }
      updateUpstreamFailure(upstream.isJson ? "UPSTREAM_HTTP_ERROR" : "NON_JSON_RESPONSE");
    }

    return res.status(503).json({
      success: false,
      dataAvailable: false,
      respCode: "0",
      respMessage: "Live JCTSL data for this stop is unavailable",
      isFallback: false,
      isCached: false,
      upstreamReachable: false,
      timestamp: new Date().toISOString(),
      error: { code: headers ? "UPSTREAM_UNAVAILABLE" : "AUTH_REQUIRED" },
      respData: { buses: [] },
    });
  } catch (error) {
    const errorCode = getSafeErrorCode(error);
    console.error(`[Buses Near Stop Error] ${errorCode}`);
    updateUpstreamFailure(errorCode);
    return res.status(502).json({
      success: false,
      dataAvailable: false,
      respCode: "0",
      respMessage: "Unable to fetch live buses for this stop",
      isFallback: false,
      isCached: false,
      upstreamReachable: false,
      timestamp: new Date().toISOString(),
      error: { code: errorCode },
      respData: { buses: [] },
    });
  }
};

app.get("/api/buses-near-stop/:stopCode", handleBusesNearStop);
app.get("/api/buses-near-stop", handleBusesNearStop);
app.post("/api/buses-near-stop", handleBusesNearStop);

/*
|--------------------------------------------------------------------------
| 4. LIVE ALL BUSES (POST/GET allvehloc)
|--------------------------------------------------------------------------
*/
const liveBusFetchPromises = new Map();
let lastLiveBusFetchTimestamp = 0;
let pollerAuthWarningLogged = false;

function parseLiveBusResponse(upstream) {
  const responseCode = String(upstream?.data?.respCode || "");
  const responseMessage = String(upstream?.data?.respMessage || "");
  const authRejected = upstream?.status === 401 ||
    responseCode === "401" ||
    /session.*expired|unauthor/i.test(responseMessage);
  if (authRejected) {
    return { success: false, errorCode: "AUTH_SESSION_EXPIRED" };
  }

  if (!upstream?.ok) {
    return {
      success: false,
      errorCode: upstream?.isJson ? "UPSTREAM_HTTP_ERROR" : "NON_JSON_RESPONSE",
    };
  }
  if (!upstream.isJson || !upstream.data) {
    return { success: false, errorCode: "NON_JSON_RESPONSE" };
  }

  const data = upstream.data;
  const vehicles = Array.isArray(data.respData)
    ? data.respData
    : Array.isArray(data)
      ? data
      : null;
  if (!vehicles || (data.respCode != null && String(data.respCode) !== "200")) {
    return {
      success: false,
      errorCode: String(data.respCode || "") === "401"
        ? "AUTH_SESSION_EXPIRED"
        : "INVALID_UPSTREAM_RESPONSE",
    };
  }
  return { success: true, data, vehicles };
}

async function fetchLiveBusesFromUpstream(headers, orgId = "1", context = "handleLiveBuses") {
  return jctslFetch("allvehloc", {
    method: "POST",
    headers,
    body: { org_id: String(orgId) },
    context,
    timeoutMs: 12000,
  });
}

async function verifyRestoredJctslSession(candidate) {
  const headers = {
    "User-Agent": "okhttp/4.9.0",
    Accept: "application/json",
    "Content-Type": "application/json",
    "Auth-token": candidate.authToken,
    "User-ID": candidate.userId,
  };
  const upstream = await fetchLiveBusesFromUpstream(
    headers,
    "1",
    "restoreSessionValidation"
  );
  const parsed = parseLiveBusResponse(upstream);
  if (!parsed.success) {
    updateUpstreamFailure(parsed.errorCode);
    return {
      success: false,
      rejected: parsed.errorCode === "AUTH_SESSION_EXPIRED",
      errorCode: parsed.errorCode,
    };
  }

  telemetryEngine.processTelemetry(parsed.vehicles);
  lastLiveBusFetchTimestamp = Date.now();
  updateUpstreamSuccess();
  return { success: true };
}

async function invalidateSessionAfterAuthRejection(errorCode, headers) {
  if (errorCode === "AUTH_SESSION_EXPIRED" && headers) {
    try {
      await sessionManager.invalidateIfCurrent({
        authToken: headers["Auth-token"],
        userId: headers["User-ID"],
      });
    } catch (error) {
      const code = getSafeErrorCode(error, "SESSION_STORE_CLEAR_FAILED");
      console.error(`[JCTSL Auth] Rejected session invalidation failed (code: ${code})`);
    }
  }
}

function fetchLiveBusesWithDeduplication(
  headers,
  orgId = "1",
  context = "handleLiveBuses"
) {
  const authFingerprint = createHash("sha256")
    .update(String(headers["Auth-token"]))
    .update("\0")
    .update(String(headers["User-ID"]))
    .digest("hex");
  const key = `${String(orgId)}:${authFingerprint}`;
  const existingRequest = liveBusFetchPromises.get(key);
  if (existingRequest) return existingRequest;

  const request = fetchLiveBusesFromUpstream(headers, orgId, context).finally(() => {
    if (liveBusFetchPromises.get(key) === request) {
      liveBusFetchPromises.delete(key);
    }
  });
  liveBusFetchPromises.set(key, request);
  return request;
}

function respondWithLiveBusFailure(res, {
  errorCode = "UPSTREAM_UNAVAILABLE",
  upstreamStatus = null,
  requestId = null,
} = {}) {
  const cachedVehicles = telemetryEngine.getLiveVehicles();
  const summary = telemetryEngine.getSummary();
  const hasRealCache = cachedVehicles.length > 0 && summary.lastUpdated !== null;
  const timestamp = new Date().toISOString();

  if (hasRealCache) {
    return res.status(200).json({
      success: true,
      dataAvailable: true,
      respCode: "200",
      respMessage: "JCTSL is unavailable; serving cached real telemetry",
      upstreamReachable: false,
      isFallback: false,
      isCached: true,
      timestamp,
      cacheTimestamp: summary.lastUpdated,
      upstreamStatus,
      errorCode,
      requestId,
      summary,
      respData: cachedVehicles,
    });
  }

  return res.status(503).json({
    success: false,
    dataAvailable: false,
    respCode: "0",
    respMessage: errorCode === "AUTH_REQUIRED"
      ? "No active server-side JCTSL session is available; complete authorized authentication."
      : errorCode === "AUTH_SESSION_EXPIRED"
        ? "JCTSL did not accept the active session; complete authorized authentication."
        : "Live JCTSL telemetry is unavailable",
    upstreamReachable: false,
    isFallback: false,
    isCached: false,
    timestamp,
    cacheTimestamp: null,
    upstreamStatus,
    error: { code: errorCode },
    errorCode,
    requestId,
    summary,
    respData: [],
  });
}

const handleLiveBuses = async (req, res) => {
  try {
    const org_id = req.query?.org_id || req.body?.org_id || "1";
    let headers = null;
    if (IS_VERCEL_RUNTIME) {
      headers = await ensureAuthHeaders(req);
      if (!headers) {
        return respondWithSessionFailure(res);
      }
    }
    const now = Date.now();
    const cacheAge = now - lastLiveBusFetchTimestamp;

    // Serverless optimization: If polled within last 15s and have vehicles, serve immediately
    const existingVehicles = telemetryEngine.getLiveVehicles();
    const existingSummary = telemetryEngine.getSummary();
    if (cacheAge < 15000 && existingVehicles.length > 0) {
      return res.json({
        success: true,
        dataAvailable: true,
        respCode: "200",
        respMessage: "Success",
        upstreamReachable: upstreamState.reachable === true,
        isFallback: false,
        isCached: true,
        timestamp: new Date().toISOString(),
        cacheTimestamp: existingSummary.lastUpdated,
        summary: existingSummary,
        respData: existingVehicles,
      });
    }

    if (!headers) headers = await ensureAuthHeaders(req);
    if (!headers) {
      const errorCode =
        sessionManager.getLastValidationErrorCode() || "AUTH_REQUIRED";
      if (IS_VERCEL_RUNTIME) {
        return respondWithSessionFailure(res, errorCode);
      }
      return respondWithLiveBusFailure(res, { errorCode });
    }

    const upstream = await fetchLiveBusesWithDeduplication(headers, org_id);

    const parsedResponse = parseLiveBusResponse(upstream);
    if (!parsedResponse.success) {
      const { errorCode } = parsedResponse;
      await invalidateSessionAfterAuthRejection(errorCode, headers);
      updateUpstreamFailure(errorCode);
      return respondWithLiveBusFailure(res, {
        errorCode: errorCode === "AUTH_SESSION_EXPIRED" ? "AUTH_REQUIRED" : errorCode,
        upstreamStatus: upstream.status,
      });
    }

    const { data, vehicles: rawVehicles } = parsedResponse;

    const { summary, vehicles } = telemetryEngine.processTelemetry(rawVehicles);
    updateUpstreamSuccess();
    lastLiveBusFetchTimestamp = Date.now();

    return res.json({
      success: true,
      dataAvailable: true,
      respCode: data?.respCode || "200",
      respMessage: data?.respMessage || "Success",
      upstreamReachable: true,
      isFallback: false,
      isCached: false,
      timestamp: new Date().toISOString(),
      summary,
      respData: vehicles,
    });
  } catch (error) {
    const cause = error.cause || {};
    const errorCode = getSafeErrorCode(error, "FETCH_ERROR");
    const requestId = error.requestId || null;
    updateUpstreamFailure(errorCode);

    console.error(`[Live Buses Error] ${error.name}: ${error.message} (code: ${errorCode})`);

    return respondWithLiveBusFailure(res, { errorCode, requestId });
  }
};

app.get("/api/live-buses", handleLiveBuses);
app.post("/api/live-buses", handleLiveBuses);

app.get("/api/live-buses/summary", (req, res) => {
  res.json({
    success: true,
    summary: telemetryEngine.getSummary(),
  });
});

// Local persistent-server poller only; Vercel uses request-driven fetches.
async function pollJctslTelemetry() {
  try {
    let headers = await ensureAuthHeaders();
    if (!headers) {
      if (!pollerAuthWarningLogged) {
        const errorCode = sessionManager.getLastValidationErrorCode() || "AUTH_REQUIRED";
        console.warn(
          `[Background Poller] Skipped: JCTSL session is unavailable (${errorCode})`
        );
        pollerAuthWarningLogged = true;
      }
      return;
    }
    pollerAuthWarningLogged = false;

    const upstream = await fetchLiveBusesWithDeduplication(
      headers,
      "1",
      "backgroundPoll"
    );

    const parsedResponse = parseLiveBusResponse(upstream);
    if (!parsedResponse.success) {
      await invalidateSessionAfterAuthRejection(parsedResponse.errorCode, headers);
      updateUpstreamFailure(parsedResponse.errorCode);
      return;
    }

    const { vehicles: rawVehicles } = parsedResponse;
    telemetryEngine.processTelemetry(rawVehicles);
    lastLiveBusFetchTimestamp = Date.now();
    updateUpstreamSuccess();
  } catch (err) {
    const errorCode = err.code || (err.name === "AbortError" ? "ETIMEDOUT" : "POLL_ERROR");
    updateUpstreamFailure(errorCode);
    console.warn(`[Background Poller] poll failed (code: ${errorCode}, requestId: ${err.requestId || "N/A"})`);
  }
}

if (require.main === module && !JCTSL_DIAGNOSTIC_MODE) {
  const pollTimer = setInterval(pollJctslTelemetry, 25000);
  if (pollTimer?.unref) pollTimer.unref();
  setTimeout(pollJctslTelemetry, 1500);
} else if (JCTSL_DIAGNOSTIC_MODE) {
  console.log("[JCTSL Diagnostic] Background polling and route warming disabled");
}

/*
|--------------------------------------------------------------------------
| 5. ROUTES BETWEEN TWO STOPS (POST/GET log/vehfromtostop & log/getRtefromto)
|--------------------------------------------------------------------------
*/
const handleRoutesBetweenStops = async (req, res) => {
  try {
    const headers = await ensureAuthHeaders(req);
    const fromQuery = String(
      req.query?.from ||
        req.query?.from_stop ||
        req.query?.from_bus_stop_id ||
        req.body?.from_bus_stop_id ||
        req.body?.from_stop_code ||
        req.body?.from ||
        ""
    ).trim();
    const toQuery = String(
      req.query?.to ||
        req.query?.to_stop ||
        req.query?.to_bus_stop_id ||
        req.body?.to_bus_stop_id ||
        req.body?.to_stop_code ||
        req.body?.to ||
        ""
    ).trim();
    const filterRoute =
      String(
        req.query?.route ||
          req.query?.route_no ||
          req.body?.route ||
          req.body?.route_no ||
          ""
      ).trim() || null;

    if (!fromQuery || !toQuery) {
      return res.status(400).json({
        success: false,
        message: "Both from and to stops are required",
      });
    }

    const result = await findValidRoutesBetweenStops(
      fromQuery,
      toQuery,
      filterRoute,
      headers
    );
    return res.json(result);
  } catch (error) {
    console.error(`[Routes Between Stops Error] ${error.code || "ROUTE_SEARCH_ERROR"}`);
    return res.status(500).json({
      success: false,
      message: "Unable to search routes between stops",
      error: { code: error.code || "ROUTE_SEARCH_ERROR" },
    });
  }
};

app.get("/api/routes-between-stops", handleRoutesBetweenStops);
app.post("/api/routes-between-stops", handleRoutesBetweenStops);

/*
|--------------------------------------------------------------------------
| 6. AVAILABLE CITY ROUTES (POST/GET Log/getAvailableroutes)
|--------------------------------------------------------------------------
*/

const handleAvailableRoutes = async (req, res) => {
  try {
    if (availableRoutesCache && Array.isArray(availableRoutesCache.respData) && availableRoutesCache.respData.length > 0) {
      return res.json({
        ...availableRoutesCache,
        success: true,
        dataAvailable: true,
        isCached: true,
      });
    }

    const headers = await ensureAuthHeaders(req);
    if (!headers && IS_VERCEL_RUNTIME) {
      return respondWithSessionFailure(res);
    }
    if (headers) {
      const city_id = req.query?.city_id || req.body?.city_id || "1";
      const upstream = await jctslFetch("Log/getAvailableroutes", {
        method: "POST",
        headers,
        body: { city_id: String(city_id) },
        context: "handleAvailableRoutes",
        timeoutMs: 12000,
      });

      if (upstream.ok && upstream.isJson && upstream.data?.respCode === "200" && Array.isArray(upstream.data?.respData)) {
        updateUpstreamSuccess();
        availableRoutesCache = {
          ...upstream.data,
          success: true,
          dataAvailable: true,
          isFallback: false,
          isCached: false,
          upstreamReachable: true,
          timestamp: new Date().toISOString(),
        };
        return res.json(availableRoutesCache);
      }
      updateUpstreamFailure(upstream.isJson ? "UPSTREAM_RESPONSE_INVALID" : "NON_JSON_RESPONSE");
    }

    // Graceful fallback: Canonical routes catalog from backend/data/routesWithStops.json
    console.warn("[Available Routes] Serving canonical routes catalog");
    const canonicalRoutesList = (routeSearchEngine.canonicalRoutes || []).map((r) => ({
      route_id: String(r.route_id),
      route_orgno: String(r.route_orgno || ""),
      route_name: String(r.route_name || ""),
      routetype: String(r.routetype || "City"),
      rkm: String(r.rkm || "0.00"),
    }));

    const fallbackData = {
      success: true,
      dataAvailable: canonicalRoutesList.length > 0,
      respCode: "200",
      respMessage: "Success",
      isFallback: true,
      isCached: false,
      upstreamReachable: upstreamState.reachable,
      timestamp: new Date().toISOString(),
      respData: canonicalRoutesList,
    };
    return res.json(fallbackData);
  } catch (error) {
    console.error(`[Available Routes Error] ${error.code || "UPSTREAM_ERROR"}`);
    updateUpstreamFailure(error.code || "UPSTREAM_ERROR");
    const canonicalRoutesList = (routeSearchEngine.canonicalRoutes || []).map((r) => ({
      route_id: String(r.route_id),
      route_orgno: String(r.route_orgno || ""),
      route_name: String(r.route_name || ""),
      routetype: String(r.routetype || "City"),
      rkm: String(r.rkm || "0.00"),
    }));
    return res.json({
      success: true,
      dataAvailable: canonicalRoutesList.length > 0,
      respCode: "200",
      respMessage: "Success",
      isFallback: true,
      isCached: false,
      upstreamReachable: false,
      timestamp: new Date().toISOString(),
      respData: canonicalRoutesList,
    });
  }
};

app.get("/api/routes", handleAvailableRoutes);
app.get("/api/available-routes", handleAvailableRoutes);
app.post("/api/available-routes", handleAvailableRoutes);

/*
|--------------------------------------------------------------------------
| 6B. ROUTE SEARCH (GET /api/routes/search?q=...)
| Supports normalized, case-insensitive, hyphen/spacing-tolerant queries.
| E.g.: "6a", "6 a", "ac7", "e3" (matches E-3, never E-32)
|--------------------------------------------------------------------------
*/
app.get("/api/routes/search", async (req, res) => {
  try {
    const headers = await ensureAuthHeaders(req);
    if (!headers) {
      if (IS_VERCEL_RUNTIME) {
        return respondWithSessionFailure(res);
      }
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data",
        requiresAuth: true,
      });
    }

    if (!availableRoutesCache) {
      try {
        const upstream = await jctslFetch("Log/getAvailableroutes", {
          method: "POST",
          headers,
          body: { city_id: "1" },
          context: "routeSearch-warmRoutes",
          timeoutMs: 12000,
        });
        if (upstream.isJson && upstream.ok && upstream.data?.respCode === "200") {
          availableRoutesCache = upstream.data;
        }
      } catch (_) {}
    }

    const routes = availableRoutesCache?.respData || [];
    const query = String(req.query?.q || "").trim();
    if (!query) {
      return res.json({ success: true, count: routes.length, routes });
    }

    const cleanRouteCode = (str) =>
      String(str || "")
        .toLowerCase()
        .trim()
        .replace(/[-\s]/g, "");

    const cleanText = (str) =>
      String(str || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]/g, "");

    const qRoute = cleanRouteCode(query);
    const qClean = cleanText(query);
    const qNorm = query.toLowerCase();

    // 1. Exact Route Number Match (Distinguishes complete route numbers: e.g. e3 matches E-3, never E-32)
    const exactMatches = routes.filter((r) => {
      const rCode = cleanRouteCode(r.route_orgno);
      const rId = cleanRouteCode(r.route_id);
      return rCode === qRoute || rId === qRoute;
    });

    if (exactMatches.length > 0) {
      return res.json({
        success: true,
        type: "exact_route_number",
        count: exactMatches.length,
        routes: exactMatches,
      });
    }

    // 2. Route Name / Keyword Match
    const keywordMatches = routes.filter((r) => {
      const nameNorm = String(r.route_name || "").toLowerCase();
      const nameClean = cleanText(r.route_name);
      return nameNorm.includes(qNorm) || nameClean.includes(qClean);
    });

    return res.json({
      success: true,
      type: "keyword_match",
      count: keywordMatches.length,
      routes: keywordMatches,
    });
  } catch (error) {
    console.error(`[Route Search Error] ${error.code || "ROUTE_SEARCH_ERROR"}`);
    return res.status(500).json({
      success: false,
      message: "Unable to search routes",
      error: { code: error.code || "ROUTE_SEARCH_ERROR" },
    });
  }
});

/*
|--------------------------------------------------------------------------
| 7. LIVE ROUTE BUSES & STOPS (POST/GET rt/rvsearching)
|--------------------------------------------------------------------------
*/
const handleLiveRoute = async (req, res) => {
  try {
    const route_id =
      req.params?.routeId || req.query?.route_id || req.body?.route_id;
    if (!route_id) {
      return res.status(400).json({
        success: false,
        message: "route_id is required",
      });
    }

    const headers = await ensureAuthHeaders(req);
    if (!headers && IS_VERCEL_RUNTIME) {
      return respondWithSessionFailure(res);
    }
    if (headers) {
      const upstream = await jctslFetch("rt/rvsearching", {
        method: "POST",
        headers,
        body: { route_id: String(route_id) },
        context: "handleLiveRoute",
        timeoutMs: 12000,
      });

      if (upstream.ok && upstream.isJson && upstream.data) {
        updateUpstreamSuccess();
        return res.status(upstream.status).json({
          ...upstream.data,
          success: true,
          dataAvailable: true,
          isFallback: false,
          isCached: false,
          upstreamReachable: true,
          timestamp: new Date().toISOString(),
        });
      }
      updateUpstreamFailure(upstream.isJson ? "UPSTREAM_HTTP_ERROR" : "NON_JSON_RESPONSE");
    }

    // Fallback: check canonicalRoutes
    const canonicalRoute = (routeSearchEngine.canonicalRoutes || []).find(
      (r) =>
        cleanRouteCode(r.route_id) === cleanRouteCode(route_id) ||
        cleanRouteCode(r.route_orgno) === cleanRouteCode(route_id)
    );
    if (canonicalRoute) {
      return res.json({
        success: true,
        dataAvailable: true,
        respCode: "200",
        respMessage: "Success",
        isFallback: true,
        isCached: false,
        upstreamReachable: upstreamState.reachable,
        timestamp: new Date().toISOString(),
        respData: {
          route_id: String(canonicalRoute.route_id),
          route_no: String(canonicalRoute.route_orgno || ""),
          route_name: canonicalRoute.route_name || "",
          stops: canonicalRoute.stops || [],
          buses: [],
        },
      });
    }

    return res.status(404).json({
      success: false,
      dataAvailable: false,
      respCode: "0",
      respMessage: "Route not found",
      isFallback: false,
      isCached: false,
      upstreamReachable: upstreamState.reachable,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[Live Route Error] ${error.code || "UPSTREAM_ERROR"}`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch live route data",
      error: { code: error.code || "UPSTREAM_ERROR" },
    });
  }
};

app.get("/api/live-route/:routeId", handleLiveRoute);
app.get("/api/live-route", handleLiveRoute);
app.post("/api/live-route", handleLiveRoute);

/*
|--------------------------------------------------------------------------
| 8. ROUTE BUS STOP MAP & POLYLINE (POST/GET rt/bspdtl)
|--------------------------------------------------------------------------
*/
const handleRouteMap = async (req, res) => {
  try {
    const route_no =
      req.params?.routeNo || req.query?.route_no || req.body?.route_no;
    const vehicle_number =
      req.query?.vehicle_number || req.body?.vehicle_number || "";

    if (!route_no) {
      return res.status(400).json({
        success: false,
        message: "route_no is required",
      });
    }

    const routeKey = String(route_no).trim();
    if (!vehicle_number && routeMapCache.has(routeKey)) {
      return res.json({
        ...routeMapCache.get(routeKey),
        success: true,
        dataAvailable: true,
        isCached: true,
        timestamp: new Date().toISOString(),
      });
    }

    const headers = await ensureAuthHeaders(req);
    if (!headers && IS_VERCEL_RUNTIME) {
      return respondWithSessionFailure(res);
    }
    if (headers) {
      const upstream = await jctslFetch("rt/bspdtl", {
        method: "POST",
        headers,
        body: {
          route_no: routeKey,
          vehicle_number: String(vehicle_number || ""),
        },
        context: "handleRouteMap",
        timeoutMs: 12000,
      });

      if (upstream.ok && upstream.isJson && upstream.data?.respCode === "200") {
        updateUpstreamSuccess();
        const mapData = {
          ...upstream.data,
          success: true,
          dataAvailable: true,
          isFallback: false,
          isCached: false,
          upstreamReachable: true,
          timestamp: new Date().toISOString(),
        };
        if (!vehicle_number) {
          routeMapCache.set(routeKey, mapData);
        }
        return res.json(mapData);
      }
      updateUpstreamFailure(upstream.isJson ? "UPSTREAM_RESPONSE_INVALID" : "NON_JSON_RESPONSE");
    }

    // Fallback: check canonicalRoutes
    const canonicalRoute = (routeSearchEngine.canonicalRoutes || []).find(
      (r) =>
        cleanRouteCode(r.route_id) === cleanRouteCode(routeKey) ||
        cleanRouteCode(r.route_orgno) === cleanRouteCode(routeKey)
    );

    if (canonicalRoute && Array.isArray(canonicalRoute.stops)) {
      const fallbackMap = {
        success: true,
        dataAvailable: true,
        respCode: "200",
        respMessage: "Success",
        isFallback: true,
        isCached: false,
        upstreamReachable: upstreamState.reachable,
        timestamp: new Date().toISOString(),
        respData: canonicalRoute.stops.map((s, idx) => ({
          bus_stop_id: String(s.order || idx + 1),
          bus_stop_name: s.name,
          bus_stop_order: String(s.order || idx + 1),
          latitude: String(s.latitude),
          longitude: String(s.longitude),
        })),
      };
      if (!vehicle_number) {
        routeMapCache.set(routeKey, fallbackMap);
      }
      return res.json(fallbackMap);
    }

    return res.status(404).json({
      success: false,
      dataAvailable: false,
      respCode: "0",
      respMessage: "Route map not found for requested route",
      isFallback: false,
      isCached: false,
      upstreamReachable: upstreamState.reachable,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[Route Map Error] ${error.code || "UPSTREAM_ERROR"}`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch route map data",
      error: { code: error.code || "UPSTREAM_ERROR" },
    });
  }
};

app.get("/api/route-map/:routeNo", handleRouteMap);
app.get("/api/route-map", handleRouteMap);
app.post("/api/route-map", handleRouteMap);

/*
|--------------------------------------------------------------------------
| 9. BUS TRACKING (POST rt/bstrack)
| Source: BusTrackDataRequest.java (route_number, vehicle_number, order_id)
|--------------------------------------------------------------------------
*/
const handleBusTrack = async (req, res) => {
  try {
    const headers = await ensureAuthHeaders(req);
    if (!headers) {
      if (IS_VERCEL_RUNTIME) {
        return respondWithSessionFailure(res);
      }
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data",
        requiresAuth: true,
      });
    }

    const route_number =
      req.body?.route_number ||
      req.query?.route_number ||
      req.body?.route_no ||
      req.query?.route_no ||
      req.query?.route;
    const vehicle_number =
      req.body?.vehicle_number ||
      req.query?.vehicle_number ||
      req.body?.vehno ||
      req.query?.vehno;
    const order_id = req.body?.order_id || req.query?.order_id || "";

    if (!route_number || !vehicle_number) {
      return res.status(400).json({
        success: false,
        message: "route_number and vehicle_number are required",
      });
    }

    const upstream = await jctslFetch("rt/bstrack", {
      method: "POST",
      headers,
      body: {
        route_number: String(route_number),
        vehicle_number: String(vehicle_number),
        order_id: String(order_id || ""),
      },
      context: "handleBusTrack",
      timeoutMs: 12000,
    });

    if (!upstream.isJson || !upstream.data) {
      return res.json({
        success: false,
        respCode: "0",
        message: "Live bus telemetry not transmitting or vehicle off-duty",
      });
    }

    return res.status(upstream.status).json(upstream.data);
  } catch (error) {
    const cause = error.cause || {};
    const errorCode = getSafeErrorCode(error, "FETCH_ERROR");
    console.error(`[Bus Track Error] ${errorCode}`);
    return res.status(500).json({
      success: false,
      message: "Unable to track bus",
      error: { code: errorCode },
      errorCode,
    });
  }
};

app.get("/api/bus-track", handleBusTrack);
app.post("/api/bus-track", handleBusTrack);
app.get("/api/bus-tracking", handleBusTrack);
app.post("/api/bus-tracking", handleBusTrack);

/*
|--------------------------------------------------------------------------
| 10. TICKET FARE (POST/GET rt/gptkt)
| Source: TicketPricesRequest.java (from_stop, to_stop, route_id, bus_type)
|--------------------------------------------------------------------------
*/
const handleFare = async (req, res) => {
  try {
    const headers = await ensureAuthHeaders(req);
    if (!headers) {
      if (IS_VERCEL_RUNTIME) {
        return respondWithSessionFailure(res);
      }
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data",
        requiresAuth: true,
      });
    }

    const from_stop =
      req.query?.from_stop || req.query?.from || req.body?.from_stop;
    const to_stop = req.query?.to_stop || req.query?.to || req.body?.to_stop;
    const route_id = req.query?.route_id || req.body?.route_id;

    if (!from_stop || !to_stop || !route_id) {
      return res.status(400).json({
        success: false,
        message: "from_stop, to_stop, and route_id are required",
      });
    }

    const bus_type = req.query?.bus_type || req.body?.bus_type || "";

    const upstream = await jctslFetch("rt/gptkt", {
      method: "POST",
      headers,
      body: {
        from_stop: String(from_stop),
        to_stop: String(to_stop),
        route_id: String(route_id),
        bus_type: String(bus_type),
      },
      context: "handleFare",
      timeoutMs: 12000,
    });

    if (!upstream.isJson || !upstream.data) {
      return res.status(upstream.ok ? 200 : 502).json({
        respCode: "0",
        respMessage: "Upstream JCTSL service returned non-JSON response",
        upstreamStatus: upstream.status,
      });
    }

    return res.status(upstream.status).json(upstream.data);
  } catch (error) {
    const cause = error.cause || {};
    const errorCode = getSafeErrorCode(error, "FETCH_ERROR");
    console.error(`[Fare Error] ${errorCode}`);
    return res.status(500).json({
      success: false,
      message: "Unable to calculate fare",
      error: { code: errorCode },
      errorCode,
    });
  }
};

app.get("/api/fare", handleFare);
app.post("/api/fare", handleFare);

/*
|--------------------------------------------------------------------------
| 11. BUS TIMINGS (POST/GET log/gettrps)
| Source: BusTimingRequest.java (route_id)
|--------------------------------------------------------------------------
*/
const handleBusTimings = async (req, res) => {
  try {
    const headers = await ensureAuthHeaders(req);
    if (!headers) {
      if (IS_VERCEL_RUNTIME) {
        return respondWithSessionFailure(res);
      }
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data",
        requiresAuth: true,
      });
    }

    const route_id =
      req.params?.routeId || req.query?.route_id || req.body?.route_id;
    if (!route_id) {
      return res.status(400).json({
        success: false,
        message: "route_id is required",
      });
    }

    const upstream = await jctslFetch("log/gettrps", {
      method: "POST",
      headers,
      body: {
        route_id: String(route_id),
      },
      context: "handleBusTimings",
      timeoutMs: 12000,
    });

    if (!upstream.isJson || !upstream.data) {
      return res.status(upstream.ok ? 200 : 502).json({
        respCode: "0",
        respMessage: "Upstream JCTSL service returned non-JSON response",
        upstreamStatus: upstream.status,
      });
    }

    return res.status(upstream.status).json(upstream.data);
  } catch (error) {
    const cause = error.cause || {};
    const errorCode = error.code || cause.code || (error.name === "AbortError" ? "ETIMEDOUT" : "FETCH_ERROR");
    console.error(`[Bus Timings Error] ${errorCode}`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch bus timings",
      error: { code: errorCode },
      errorCode,
    });
  }
};

app.get("/api/bus-timings/:routeId", handleBusTimings);
app.get("/api/bus-timings", handleBusTimings);
app.post("/api/bus-timings", handleBusTimings);

// Background cache warmer for route maps to guarantee <5ms response
async function warmRouteMaps() {
  try {
    const headers = await ensureAuthHeaders();
    if (!headers) return;

    // First ensure availableRoutes is fetched
    if (!availableRoutesCache) {
      try {
        const routesRes = await jctslFetch("Log/getAvailableroutes", {
          method: "POST",
          headers,
          body: { city_id: "1" },
          context: "warmRouteMaps-routes",
          timeoutMs: 12000,
        });
        if (routesRes.isJson && routesRes.data?.respCode === "200") {
          availableRoutesCache = routesRes.data;
        }
      } catch (_) {}
    }

    const routes = availableRoutesCache?.respData || [];
    for (const r of routes) {
      const rId = String(r.route_id).trim();
      if (rId && !routeMapCache.has(rId)) {
        try {
          const mapRes = await jctslFetch("rt/bspdtl", {
            method: "POST",
            headers,
            body: { route_no: rId, vehicle_number: "" },
            context: "warmRouteMaps-bspdtl",
            timeoutMs: 12000,
          });
          if (mapRes.isJson && mapRes.data?.respCode === "200") {
            routeMapCache.set(rId, mapRes.data);
          }
        } catch (_) {}
        // Sleep 150ms between warming calls to be gentle to JCTSL
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  } catch (err) {
    console.warn("Background cache warmer warning:", err.message);
  }
}

/*
|--------------------------------------------------------------------------
| JAIPUR METRO (JMRC) MODULE
| Isolated from JCTSL Bus APIs
|--------------------------------------------------------------------------
*/
const metroRouter = require("./metro/metroRoutes");
app.use("/api/metro", metroRouter);



if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`JBL Backend running on http://localhost:${PORT}`);
    if (!sessionManager.hasActiveSession() && !sessionManager.hasRestoredSession()) {
      console.warn(
        "[JCTSL Auth] No configured session; background polling will wait for a verified OTP session."
      );
    }
    if (!JCTSL_DIAGNOSTIC_MODE) {
      setTimeout(warmRouteMaps, 1000);
    }
  });
}

module.exports = app;

Object.assign(module.exports, {
  app,
  jctslFetch,
  refreshJctslSession,
  ensureAuthHeaders,
  upstreamState,
  updateUpstreamSuccess,
  updateUpstreamFailure,
  TRANSIENT_ERROR_CODES,
  parseLiveBusResponse,
  allowOtpRequest,
  JCTSL_BASE_URL,
  JCTSL_HOST,
});
