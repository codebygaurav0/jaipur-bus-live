const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const dns = require("dns");
const https = require("https");
require("dotenv").config();
const { telemetryEngine } = require("./telemetryEngine");

// Force IPv4 DNS resolution first to avoid IPv6 NAT64 prefix (64:ff9b::) timeouts on cloud hosts (Render/Docker/Linux)
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 11000;

const JCTSL_BASE_URL =
  process.env.JCTSL_BASE_URL ||
  "https://www.omnificent.co.in/OMB/";

const SESSION_FILE = path.join(__dirname, ".session.json");

/*
|--------------------------------------------------------------------------
| IN-MEMORY & PERSISTED JCTSL SESSION MANAGEMENT
| Keeps sensitive Auth-token and User-ID securely on the backend.
|--------------------------------------------------------------------------
*/
let activeSession = null;
const pendingAuthMap = new Map(); // mobile -> { authToken, userId, expectedOtp, respData, timestamp }

// Load persisted session on boot if available
try {
  if (fs.existsSync(SESSION_FILE)) {
    const raw = fs.readFileSync(SESSION_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.authToken && parsed.userId) {
      activeSession = parsed;
      console.log(`Loaded persisted JCTSL session for user ${activeSession.mobile || activeSession.userId}`);
    }
  }
} catch (err) {
  console.warn("Could not load persisted session:", err.message);
}

// Fallback to environment variables if session file not present (ideal for Render/Docker)
if (!activeSession && process.env.JCTSL_AUTH_TOKEN && process.env.JCTSL_USER_ID) {
  activeSession = {
    authToken: process.env.JCTSL_AUTH_TOKEN,
    userId: process.env.JCTSL_USER_ID,
    mobile: process.env.JCTSL_MOBILE || "9000090000",
    user: {
      mobile: process.env.JCTSL_MOBILE || "9000090000",
      firstName: process.env.JCTSL_FIRST_NAME || "JBL",
      lastName: process.env.JCTSL_LAST_NAME || "User",
      email: process.env.JCTSL_EMAIL || "",
    },
  };
  console.log("Loaded JCTSL session from environment variables.");
}

function saveSession(session) {
  activeSession = session;
  try {
    if (session) {
      fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), "utf-8");
    } else if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch (err) {
    console.warn("Could not save session file:", err.message);
  }
}

// Cleanup expired pending auth entries older than 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [mobile, data] of pendingAuthMap.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) {
      pendingAuthMap.delete(mobile);
    }
  }
}, 60 * 1000);

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

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "JBL backend is working",
    hasActiveSession: !!activeSession,
    sessionUser: activeSession?.user || null,
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
function safeHttpsProbe({ host, ip = null, servername = null, path = "/OMB/", timeoutMs = 6000 }) {
  const start = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const connectHost = ip || host;

    const req = https.request({
      host: connectHost,
      port: 443,
      path: path,
      method: "GET",
      servername: servername || host,
      headers: {
        "Host": host,
        "User-Agent": "okhttp/4.9.0",
        "Accept": "*/*",
      },
      timeout: timeoutMs,
    }, (res) => {
      if (settled) return;
      settled = true;
      const elapsed = Date.now() - start;
      const socket = res.socket;
      const cert = socket?.getPeerCertificate ? socket.getPeerCertificate() : null;

      resolve({
        success: true,
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        serverHeader: res.headers["server"] || null,
        contentType: res.headers["content-type"] || null,
        remoteAddress: socket?.remoteAddress || null,
        remoteFamily: socket?.remoteFamily || null,
        tlsAuthorized: socket?.authorized ?? null,
        tlsProtocol: socket?.getProtocol ? socket.getProtocol() : null,
        tlsCipher: socket?.getCipher ? socket.getCipher()?.name : null,
        certSubject: cert?.subject?.CN || null,
        elapsedMs: elapsed,
        error: null,
      });
      res.resume();
    });

    req.on("timeout", () => {
      if (settled) return;
      settled = true;
      req.destroy(new Error(`CONNECT_TIMEOUT: Connection timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      const elapsed = Date.now() - start;
      resolve({
        success: false,
        statusCode: null,
        statusMessage: null,
        serverHeader: null,
        contentType: null,
        remoteAddress: null,
        remoteFamily: null,
        tlsAuthorized: null,
        tlsProtocol: null,
        tlsCipher: null,
        certSubject: null,
        elapsedMs: elapsed,
        error: {
          name: err.name,
          code: err.code || "UNKNOWN",
          message: err.message,
        },
      });
    });

    req.end();
  });
}

app.get("/api/jctsl-network-diagnostic", async (req, res) => {
  const diagnosticStart = Date.now();
  const parsedUrl = new URL(JCTSL_BASE_URL);
  const targetHost = parsedUrl.hostname; // e.g. "www.omnificent.co.in"
  const targetPath = parsedUrl.pathname.endsWith("/") ? parsedUrl.pathname : `${parsedUrl.pathname}/`; // "/OMB/"
  const targetHttpsUrl = `${parsedUrl.origin}${targetPath}`;
  const timeoutMs = 6000;

  // 1. dns.lookup(host, { all: true })
  let lookupResults = [];
  let lookupError = null;
  try {
    lookupResults = await dns.promises.lookup(targetHost, { all: true });
  } catch (err) {
    lookupError = { name: err.name, code: err.code, message: err.message };
  }

  // 2. dns.promises.resolve4(host)
  let resolve4Results = [];
  let resolve4Error = null;
  try {
    resolve4Results = await dns.promises.resolve4(targetHost);
  } catch (err) {
    resolve4Error = { name: err.name, code: err.code, message: err.message };
  }

  // 3. dns.promises.resolve6(host)
  let resolve6Results = [];
  let resolve6Error = null;
  try {
    resolve6Results = await dns.promises.resolve6(targetHost);
  } catch (err) {
    resolve6Error = { name: err.name, code: err.code, message: err.message };
  }

  // 4 & 5. Availability of IPv4 and IPv6
  const hasIpv4 =
    (Array.isArray(resolve4Results) && resolve4Results.length > 0) ||
    (Array.isArray(lookupResults) &&
      lookupResults.some((r) => r.family === 4 || r.family === "IPv4"));

  const hasIpv6 =
    (Array.isArray(resolve6Results) && resolve6Results.length > 0) ||
    (Array.isArray(lookupResults) &&
      lookupResults.some((r) => r.family === 6 || r.family === "IPv6"));

  // 6, 7, 8, 9. Standard HTTPS connection test to https://www.omnificent.co.in/OMB/
  const httpsConnectionTest = await safeHttpsProbe({
    host: targetHost,
    path: targetPath,
    timeoutMs,
  });

  // Separate safe test using Node's https.request with resolved IPv4 address while preserving TLS SNI
  // - connect address = resolved IPv4
  // - servername = www.omnificent.co.in
  // - Host header = www.omnificent.co.in
  // - path = /OMB/
  let directIpv4SniTest = null;
  const resolvedIpv4Candidate =
    (Array.isArray(resolve4Results) && resolve4Results.length > 0
      ? resolve4Results[0]
      : null) ||
    (Array.isArray(lookupResults)
      ? lookupResults.find((r) => r.family === 4 || r.family === "IPv4")?.address
      : null);

  if (resolvedIpv4Candidate) {
    const directProbe = await safeHttpsProbe({
      host: targetHost,
      ip: resolvedIpv4Candidate,
      servername: targetHost,
      path: targetPath,
      timeoutMs,
    });
    directIpv4SniTest = {
      tested: true,
      resolvedIpv4: resolvedIpv4Candidate,
      servername: targetHost,
      hostHeader: targetHost,
      path: targetPath,
      ...directProbe,
    };
  } else {
    directIpv4SniTest = {
      tested: false,
      reason: "No IPv4 address resolved via resolve4 or lookup",
    };
  }

  // Undici / Native fetch connection test (6s timeout) for comparison
  let undiciFetchTest = null;
  const fetchStart = Date.now();
  const fetchController = new AbortController();
  const fetchTimer = setTimeout(() => fetchController.abort(), timeoutMs);
  try {
    const fetchRes = await fetch(targetHttpsUrl, {
      method: "GET",
      headers: {
        "User-Agent": "okhttp/4.9.0",
        "Accept": "*/*",
      },
      signal: fetchController.signal,
    });
    undiciFetchTest = {
      success: true,
      statusCode: fetchRes.status,
      statusText: fetchRes.statusText,
      serverHeader: fetchRes.headers.get("server") || null,
      elapsedMs: Date.now() - fetchStart,
      error: null,
    };
  } catch (fetchErr) {
    const cause = fetchErr.cause || {};
    undiciFetchTest = {
      success: false,
      statusCode: null,
      statusText: null,
      serverHeader: null,
      elapsedMs: Date.now() - fetchStart,
      error: {
        name: fetchErr.name,
        code: cause.code || fetchErr.code || (fetchErr.name === "AbortError" ? "ETIMEDOUT" : "FETCH_ERROR"),
        message: fetchErr.message,
        causeCode: cause.code || null,
        causeMessage: cause.message || null,
      },
    };
  } finally {
    clearTimeout(fetchTimer);
  }

  const totalElapsedMs = Date.now() - diagnosticStart;

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    totalElapsedMs,
    target: {
      host: targetHost,
      path: targetPath,
      url: targetHttpsUrl,
      port: 443,
    },
    dns: {
      defaultResultOrder: typeof dns.getDefaultResultOrder === "function" ? dns.getDefaultResultOrder() : "unknown",
      lookup: lookupResults,
      lookupError,
      resolve4: resolve4Results,
      resolve4Error,
      resolve6: resolve6Results,
      resolve6Error,
      hasIpv4,
      hasIpv6,
    },
    httpsConnectionTest,
    directIpv4SniTest,
    undiciFetchTest,
  });
});

/*
|--------------------------------------------------------------------------
| HELPER: AUTH CHECK
| Supports incoming headers, or automatically attaches backend activeSession.
| Never exposes credentials to client or logs.
|--------------------------------------------------------------------------
*/
function getAuthHeaders(req) {
  const headerToken = req?.headers ? req.headers["auth-token"] : null;
  const headerUserId = req?.headers ? req.headers["user-id"] : null;

  const authToken = headerToken || activeSession?.authToken;
  const userId = headerUserId || activeSession?.userId;

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

/*
|--------------------------------------------------------------------------
| RESILIENT UPSTREAM JCTSL FETCH CLIENT
| - Safe diagnostic logging (URL, method, status, size, error code — ZERO credentials)
| - Explicit 12-second AbortController timeout to prevent stuck cloud requests
| - Mobile client headers (User-Agent: okhttp/4.9.0, Accept: application/json)
| - Safe non-JSON response handling (never throws SyntaxError on HTML/PHP notices)
| - Error cause/code preservation for immediate diagnostic insight
|--------------------------------------------------------------------------
*/
async function jctslFetch(endpoint, {
  method = "POST",
  headers = {},
  body = null,
  timeoutMs = 12000,
  context = "general",
} = {}) {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${JCTSL_BASE_URL}${endpoint.replace(/^\//, "")}`;

  const hasAuthToken = Boolean(headers?.["Auth-token"]);
  const hasUserId = Boolean(headers?.["User-ID"]);

  let orgId = null;
  if (body) {
    try {
      const parsed = typeof body === "string" ? JSON.parse(body) : body;
      orgId = parsed.org_id || parsed.city_id || parsed.route_id || parsed.route_no || null;
    } catch (_) {}
  }

  // Safe outbound logging (NEVER print token, user ID, or sensitive body fields)
  console.log(
    `[JCTSL Upstream Request] context=${context} | method=${method} | url=${url} | org_id=${orgId ?? "N/A"} | hasAuthToken=${hasAuthToken} | hasUserId=${hasUserId}`
  );

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Upstream request to ${url} timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const mergedHeaders = {
    "User-Agent": "okhttp/4.9.0",
    "Accept": "application/json",
    ...headers,
  };

  try {
    const response = await fetch(url, {
      method,
      headers: mergedHeaders,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });

    const rawText = await response.text();
    const contentType = response.headers.get("content-type") || "unknown";

    // Safe response logging (Zero credentials logged)
    console.log(
      `[JCTSL Upstream Response] context=${context} | status=${response.status} | contentType=${contentType} | bodyLength=${rawText.length} | url=${url}`
    );

    let jsonData = null;
    let isJson = false;
    try {
      jsonData = JSON.parse(rawText);
      isJson = true;
    } catch (parseErr) {
      console.warn(
        `[JCTSL Upstream Non-JSON] context=${context} | status=${response.status} | contentType=${contentType} | preview=${rawText.slice(0, 160).replace(/\s+/g, " ")}`
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
  } catch (err) {
    const cause = err.cause || {};
    const errorCode = cause.code || err.code || (err.name === "AbortError" ? "ETIMEDOUT" : "FETCH_ERROR");
    const causeMsg = cause.message || err.message || "Unknown fetch error";

    console.error(
      `[JCTSL Fetch Error] context=${context} | url=${url} | name=${err.name} | message=${err.message} | code=${errorCode} | causeName=${cause.name || "N/A"} | causeMessage=${causeMsg}`
    );

    const wrappedError = new Error(err.message || "Fetch failed");
    wrappedError.name = err.name;
    wrappedError.code = errorCode;
    wrappedError.cause = cause;
    wrappedError.url = url;
    wrappedError.context = context;
    throw wrappedError;
  } finally {
    clearTimeout(timer);
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
    const { mobile } = req.body;
    const cleanMobile = String(mobile || "").replace(/\D/g, "").slice(-10);

    if (cleanMobile.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10-digit mobile number",
      });
    }

    const countryCode = "+91";

    // 1. Send LoginRequest to JCTSL /log/usr
    const loginPayload = {
      req_type: "0",
      country_code: countryCode,
      mobile: cleanMobile,
      ph_brand: "Google",
      ph_mdl: "Pixel",
      os_ver: "14",
      dev_id: "c8b9d0e1f2a34567",
      ver_nm: "1.5.1",
      ver_cd: "30",
      fcm_token: "",
    };

    let logUsrRes = await jctslFetch("log/usr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: loginPayload,
      context: "sendOtp-login",
      timeoutMs: 12000,
    });

    let logUsrData = logUsrRes.isJson ? logUsrRes.data : null;

    // If device mismatch ("1"), APK calls K("1") to confirm device switch
    if (logUsrData?.respData?.dev_mis_flag === "1") {
      const switchPayload = {
        ...loginPayload,
        req_type: "1",
      };

      logUsrRes = await jctslFetch("log/usr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: switchPayload,
        context: "sendOtp-switch",
        timeoutMs: 12000,
      });

      logUsrData = logUsrRes.isJson ? logUsrRes.data : null;
    }

    const respData = logUsrData?.respData;
    if (!respData) {
      return res.status(400).json({
        success: false,
        message: logUsrData?.respMessage || "Failed to initiate login with JCTSL",
      });
    }

    let expectedOtp = null;

    // Special test number hardcoded in JCTSL APK (login/c.java line 125)
    if (cleanMobile === "9000090000") {
      expectedOtp = "654321";
    } else if (respData.sst && respData.sen) {
      // Dynamic OTP URL from JCTSL server
      const otpUrl = `${respData.sst}${countryCode}${cleanMobile}${respData.sen}`;

      try {
        const otpFetchRes = await fetch(otpUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });
        const otpJson = await otpFetchRes.json();

        // If gateway returned an explicit OTP in dev/test mode
        if (otpJson?.OTP) {
          expectedOtp = String(otpJson.OTP).trim();
        }
      } catch (otpErr) {
        console.warn("OTP gateway request notice:", otpErr.message);
      }
    }

    // Store pending auth state
    pendingAuthMap.set(cleanMobile, {
      authToken: respData.authToken,
      userId: respData.userId,
      expectedOtp,
      respData,
      timestamp: Date.now(),
    });

    return res.json({
      success: true,
      message: `OTP requested for ${cleanMobile}`,
      mobile: cleanMobile,
      isTestNumber: cleanMobile === "9000090000",
    });
  } catch (error) {
    console.error("send-otp error:", error);
    return res.status(500).json({
      success: false,
      message: "Error sending OTP through JCTSL",
      error: error.message,
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
    const { mobile, otp } = req.body;
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

    // If expectedOtp is known (e.g. test number 9000090000 or gateway autogen)
    if (pending.expectedOtp && pending.expectedOtp !== cleanOtp) {
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

    // Verification successful! Establish backend active session & persist
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

    saveSession(newSession);
    pendingAuthMap.delete(cleanMobile);

    return res.json({
      success: true,
      message: "Login successful",
      user: activeSession.user,
    });
  } catch (error) {
    console.error("verify-otp error:", error);
    return res.status(500).json({
      success: false,
      message: "Error verifying OTP",
      error: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| AUTH: 3. CURRENT SESSION & LOGOUT
|--------------------------------------------------------------------------
*/
app.get("/api/auth/session", (req, res) => {
  if (!activeSession) {
    return res.json({
      authenticated: false,
      user: null,
    });
  }

  return res.json({
    authenticated: true,
    user: activeSession.user,
  });
});

app.post("/api/auth/logout", (req, res) => {
  saveSession(null);
  return res.json({
    success: true,
    message: "Logged out successfully",
  });
});

/*
|--------------------------------------------------------------------------
| 1. CITIES LIST (POST SUser/citiList)
|--------------------------------------------------------------------------
*/
app.post("/api/cities", async (req, res) => {
  try {
    const headers = getAuthHeaders(req);
    if (!headers) {
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
    const errorCode = error.code || cause.code || (error.name === "AbortError" ? "ETIMEDOUT" : "FETCH_ERROR");
    console.error(`[Cities Error] ${error.name}: ${error.message} (code: ${errorCode}, cause: ${cause.message || "N/A"})`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch cities",
      error: error.message,
      errorCode,
      errorDetails: {
        name: error.name,
        code: errorCode,
        causeMessage: cause.message || null,
      },
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

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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

function resolveStop(input, allStops) {
  if (!input || !Array.isArray(allStops)) return null;
  const raw = String(input).trim();
  const rawLower = raw.toLowerCase();
  const cleanIn = cleanText(raw);

  // 1. Exact match on bus_stop_code (e.g. "KEMOD", "AJG")
  let match = allStops.find(
    (s) => String(s.bus_stop_code || "").trim().toLowerCase() === rawLower
  );
  if (match) return match;

  // 2. Exact match on bus_stop_id
  match = allStops.find((s) => String(s.bus_stop_id) === raw);
  if (match) return match;

  // 3. Exact clean text match on bus_stop_name
  match = allStops.find((s) => cleanText(s.bus_stop_name) === cleanIn);
  if (match) return match;

  // 4. Substring / contains match
  match = allStops.find((s) => {
    const sClean = cleanText(s.bus_stop_name);
    return sClean.includes(cleanIn) || cleanIn.includes(sClean);
  });
  return match || null;
}

function findStopIndexInRoute(orderedStops, targetStop, minIndex = 0) {
  if (!targetStop || !Array.isArray(orderedStops)) return -1;
  const tName = cleanText(targetStop.bus_stop_name || targetStop.bus_stop || "");
  const tCode = cleanText(targetStop.bus_stop_code || "");
  const tLat = parseFloat(targetStop.latitude);
  const tLng = parseFloat(targetStop.longitude);

  // 1. Exact name match (highest priority)
  for (let i = minIndex; i < orderedStops.length; i++) {
    const sName = cleanText(orderedStops[i].bus_stop || orderedStops[i].bus_stop_name || "");
    if (sName && tName && sName === tName) return i;
  }

  // 2. Exact code match
  if (tCode) {
    for (let i = minIndex; i < orderedStops.length; i++) {
      const sName = cleanText(orderedStops[i].bus_stop || orderedStops[i].bus_stop_name || "");
      if (sName === tCode || sName.startsWith(tCode) || sName.endsWith(tCode)) return i;
    }
  }

  // 3. Substring match (name contains name)
  if (tName.length >= 4) {
    for (let i = minIndex; i < orderedStops.length; i++) {
      const sName = cleanText(orderedStops[i].bus_stop || orderedStops[i].bus_stop_name || "");
      if (sName.length >= 4 && (sName.includes(tName) || tName.includes(sName))) return i;
    }
  }

  // 4. Tight proximity fallback (< 150m) only if no name match
  if (!isNaN(tLat) && !isNaN(tLng) && tLat !== 0 && tLng !== 0) {
    let closestIdx = -1;
    let closestDist = 0.15; // 150m max
    for (let i = minIndex; i < orderedStops.length; i++) {
      const sLat = parseFloat(orderedStops[i].latitude);
      const sLng = parseFloat(orderedStops[i].longitude);
      if (!isNaN(sLat) && !isNaN(sLng) && sLat !== 0) {
        const d = calculateDistanceKm(sLat, sLng, tLat, tLng);
        if (d < closestDist) {
          closestDist = d;
          closestIdx = i;
        }
      }
    }
    if (closestIdx !== -1) return closestIdx;
  }

  return -1;
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
  if (!headers) headers = getAuthHeaders();
  if (!headers) {
    return {
      success: false,
      count: 0,
      routes: [],
      message: "Login required for live JCTSL data",
      requiresAuth: true,
    };
  }

  // Ensure stops cache
  if (!busStopsCache) {
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

  // Ensure routes cache
  if (!availableRoutesCache) {
    try {
      const res = await jctslFetch("Log/getAvailableroutes", {
        method: "POST",
        headers,
        body: { city_id: "1" },
        context: "findValidRoutes-routes",
        timeoutMs: 12000,
      });
      if (res.isJson && res.data?.respCode === "200") availableRoutesCache = res.data;
    } catch (_) {}
  }

  const allStops = busStopsCache?.respData || [];
  const allRoutes = availableRoutesCache?.respData || [];

  const fromStop = resolveStop(fromQuery, allStops);
  const toStop = resolveStop(toQuery, allStops);

  if (!fromStop || !toStop) {
    return {
      success: false,
      count: 0,
      from_stop: fromStop,
      to_stop: toStop,
      routes: [],
      message: "Could not resolve From/To bus stops in JCTSL database",
    };
  }

  // 1. Candidate routes: If filterRoute is specified, filter by EXACT route number first!
  const candidateRoutes = allRoutes.filter((r) => {
    if (!filterRoute) return true;
    const qCode = cleanRouteCode(filterRoute);
    const rCode = cleanRouteCode(r.route_orgno);
    const idCode = cleanRouteCode(r.route_id);
    return rCode === qCode || idCode === qCode;
  });

  // Fetch live city buses once
  let cityBuses = [];
  try {
    const cbRes = await jctslFetch("allvehloc", {
      method: "POST",
      headers,
      body: { org_id: "1" },
      context: "findValidRoutes-allvehloc",
      timeoutMs: 12000,
    });
    if (cbRes.isJson && Array.isArray(cbRes.data?.respData)) cityBuses = cbRes.data.respData;
  } catch (_) {}

  const validRoutes = [];

  for (const r of candidateRoutes) {
    const routeId = String(r.route_id).trim();
    let mapData = routeMapCache.get(routeId);

    if (!mapData) {
      try {
        const mRes = await jctslFetch("rt/bspdtl", {
          method: "POST",
          headers,
          body: { route_no: routeId, vehicle_number: "" },
          context: "findValidRoutes-bspdtl",
          timeoutMs: 12000,
        });
        if (mRes.isJson && mRes.data?.respCode === "200") {
          mapData = mRes.data;
          routeMapCache.set(routeId, mapData);
        }
      } catch (_) {
        continue;
      }
    }

    const orderedStops = mapData?.respData?.bus_stop_list || [];
    if (orderedStops.length === 0) continue;

    const fromIndex = findStopIndexInRoute(orderedStops, fromStop, 0);
    if (fromIndex === -1) continue;

    const toIndex = findStopIndexInRoute(orderedStops, toStop, fromIndex + 1);
    if (toIndex === -1 || fromIndex >= toIndex) continue;

    // Strict validation passed!
    // Fetch live upcoming buses assigned by JCTSL specifically to this route & direction
    const routeBusesMap = new Map();

    try {
      const liveRes = await jctslFetch("rt/rvsearching", {
        method: "POST",
        headers,
        body: { route_id: routeId },
        context: "findValidRoutes-rvsearching",
        timeoutMs: 12000,
      });
      const liveData = liveRes.isJson ? liveRes.data : null;

      if (Array.isArray(liveData?.respData?.route)) {
        liveData.respData.route.forEach((st) => {
          if (Array.isArray(st.upcomingbuses)) {
            st.upcomingbuses.forEach((b) => {
              const vNo = String(
                b.vehicel_no || b.vehicle_no || b.vehNo || ""
              ).trim();
              if (vNo && !routeBusesMap.has(vNo)) {
                const bLat = parseFloat(b.latitude);
                const bLng = parseFloat(b.longitude);

                let nearestIdx = -1;
                let minDist = Infinity;
                for (let k = 0; k < orderedStops.length; k++) {
                  const sLat = parseFloat(orderedStops[k].latitude);
                  const sLng = parseFloat(orderedStops[k].longitude);
                  if (!isNaN(sLat) && !isNaN(sLng)) {
                    const d = calculateDistanceKm(bLat, bLng, sLat, sLng);
                    if (d < minDist) {
                      minDist = d;
                      nearestIdx = k;
                    }
                  }
                }

                routeBusesMap.set(vNo, {
                  vehicle_number: vNo,
                  latitude: bLat,
                  longitude: bLng,
                  speed: b.speed || null,
                  eta: b.eta && b.eta !== vNo ? b.eta : null,
                  current_stop:
                    nearestIdx >= 0 ? orderedStops[nearestIdx].bus_stop : null,
                  next_stop:
                    nearestIdx >= 0 && nearestIdx < orderedStops.length - 1
                      ? orderedStops[nearestIdx + 1].bus_stop
                      : null,
                  nearest_index: nearestIdx,
                  is_approaching_from_stop: nearestIdx <= fromIndex,
                  status: "Live",
                });
              }
            });
          }
        });
      }
    } catch (_) {}

    // Also match live city buses broadcasting this route's exact org number (e.g. b.rno === "6A")
    const cleanOrg = cleanRouteCode(r.route_orgno);
    cityBuses.forEach((cb) => {
      const cbRno = cleanRouteCode(cb.rno);
      const vNo = String(cb.vehno || "").trim();
      if (vNo && cbRno === cleanOrg && !routeBusesMap.has(vNo)) {
        const bLat = parseFloat(cb.curlat);
        const bLng = parseFloat(cb.curlong);

        let nearestIdx = -1;
        let minDist = Infinity;
        for (let k = 0; k < orderedStops.length; k++) {
          const sLat = parseFloat(orderedStops[k].latitude);
          const sLng = parseFloat(orderedStops[k].longitude);
          if (!isNaN(sLat) && !isNaN(sLng)) {
            const d = calculateDistanceKm(bLat, bLng, sLat, sLng);
            if (d < minDist) {
              minDist = d;
              nearestIdx = k;
            }
          }
        }

        routeBusesMap.set(vNo, {
          vehicle_number: vNo,
          latitude: bLat,
          longitude: bLng,
          speed: null,
          eta: null,
          current_stop:
            nearestIdx >= 0 ? orderedStops[nearestIdx].bus_stop : null,
          next_stop:
            nearestIdx >= 0 && nearestIdx < orderedStops.length - 1
              ? orderedStops[nearestIdx + 1].bus_stop
              : null,
          nearest_index: nearestIdx,
          is_approaching_from_stop: nearestIdx <= fromIndex,
          status: "Live",
        });
      }
    });

    const liveBuses = Array.from(routeBusesMap.values());

    validRoutes.push({
      route_id: r.route_id,
      route_orgno: r.route_orgno,
      route_name: r.route_name,
      route_type: r.route_type || "Regular",
      from_stop_matched: orderedStops[fromIndex].bus_stop,
      from_stop_code: fromStop.bus_stop_code,
      from_stop_index: fromIndex,
      to_stop_matched: orderedStops[toIndex].bus_stop,
      to_stop_code: toStop.bus_stop_code,
      to_stop_index: toIndex,
      intermediate_stops_count: toIndex - fromIndex + 1,
      total_route_stops: orderedStops.length,
      traversal_stops: orderedStops.slice(fromIndex, toIndex + 1),
      all_stops: orderedStops,
      live_buses: liveBuses,
      live_buses_count: liveBuses.length,
    });
  }

  return {
    success: true,
    from_stop: fromStop,
    to_stop: toStop,
    count: validRoutes.length,
    routes: validRoutes,
    message:
      validRoutes.length > 0
        ? `${validRoutes.length} direct JCTSL route(s) found`
        : "No direct JCTSL route found",
  };
}

/*
|--------------------------------------------------------------------------
| 2. REAL JCTSL BUS STOPS DATASET (POST/GET usr/citibuslist)
|--------------------------------------------------------------------------
*/
const handleBusStops = async (req, res) => {
  try {
    const headers = getAuthHeaders(req);
    if (!headers) {
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data",
        requiresAuth: true,
      });
    }

    if (busStopsCache) {
      return res.json(busStopsCache);
    }

    const city_id = req.query?.city_id || req.body?.city_id || "1";
    const city_url = req.query?.city_url || req.body?.city_url;
    const targetBase = city_url
      ? (city_url.endsWith("/") ? city_url : `${city_url}/`)
      : JCTSL_BASE_URL;

    const targetUrl = `${targetBase}usr/citibuslist`;

    const upstream = await jctslFetch(targetUrl, {
      method: "POST",
      headers,
      body: { city_id: String(city_id) },
      context: "handleBusStops",
      timeoutMs: 12000,
    });

    if (!upstream.isJson || !upstream.data) {
      return res.status(upstream.ok ? 200 : 502).json({
        respCode: "0",
        respMessage: "Upstream JCTSL service returned non-JSON response",
        upstreamStatus: upstream.status,
      });
    }

    const data = upstream.data;
    if (upstream.ok && data?.respCode === "200") {
      busStopsCache = data;
    }
    return res.status(upstream.status).json(data);
  } catch (error) {
    const cause = error.cause || {};
    const errorCode = error.code || cause.code || (error.name === "AbortError" ? "ETIMEDOUT" : "FETCH_ERROR");
    console.error(`[Bus Stops Error] ${error.name}: ${error.message} (code: ${errorCode}, cause: ${cause.message || "N/A"})`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch bus stops",
      error: error.message,
      errorCode,
      errorDetails: {
        name: error.name,
        code: errorCode,
        causeMessage: cause.message || null,
      },
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
    const headers = getAuthHeaders(req);
    if (!headers) {
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data",
        requiresAuth: true,
      });
    }

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
    console.error(`[Buses Near Stop Error] ${error.name}: ${error.message} (code: ${errorCode}, cause: ${cause.message || "N/A"})`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch buses for selected stop",
      error: error.message,
      errorCode,
      errorDetails: {
        name: error.name,
        code: errorCode,
        causeMessage: cause.message || null,
      },
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
const handleLiveBuses = async (req, res) => {
  try {
    const headers = getAuthHeaders(req);
    if (!headers) {
      console.warn("[Live Buses] Request rejected: No active session or auth headers available");
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data. No active session or Auth-token found.",
        requiresAuth: true,
      });
    }

    const org_id = req.query?.org_id || req.body?.org_id || "1";

    const upstream = await jctslFetch("allvehloc", {
      method: "POST",
      headers,
      body: { org_id: String(org_id) },
      context: "handleLiveBuses",
      timeoutMs: 12000,
    });

    if (!upstream.isJson || !upstream.data) {
      console.warn("[Live Buses] Upstream returned non-JSON. Serving cached telemetry.");
      return res.json({
        respCode: "0",
        respMessage: "Upstream JCTSL service returned non-JSON response",
        upstreamStatus: upstream.status,
        summary: telemetryEngine.getSummary(),
        respData: telemetryEngine.getLiveVehicles(),
      });
    }

    const data = upstream.data;
    const rawVehicles = Array.isArray(data?.respData)
      ? data.respData
      : Array.isArray(data)
      ? data
      : [];

    const { summary, vehicles } = telemetryEngine.processTelemetry(rawVehicles);

    return res.status(upstream.status).json({
      respCode: data?.respCode || "200",
      respMessage: data?.respMessage || "Success",
      summary,
      respData: vehicles,
    });
  } catch (error) {
    const cause = error.cause || {};
    const errorCode = error.code || cause.code || (error.name === "AbortError" ? "ETIMEDOUT" : "FETCH_ERROR");
    console.error(`[Live Buses Error] ${error.name}: ${error.message} (code: ${errorCode}, cause: ${cause.message || "N/A"})`);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch live buses from JCTSL upstream",
      error: error.message,
      errorCode,
      errorDetails: {
        name: error.name,
        code: errorCode,
        causeMessage: cause.message || null,
        url: error.url || "allvehloc",
      },
    });
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

// Periodic background telemetry refresher (every 25 seconds)
async function pollJctslTelemetry() {
  try {
    const headers = getAuthHeaders();
    if (!headers) return;

    const upstream = await jctslFetch("allvehloc", {
      method: "POST",
      headers,
      body: { org_id: "1" },
      context: "backgroundPoll",
      timeoutMs: 12000,
    });

    if (!upstream.isJson || !upstream.data) return;

    const data = upstream.data;
    const rawVehicles = Array.isArray(data?.respData)
      ? data.respData
      : Array.isArray(data)
      ? data
      : [];

    if (rawVehicles.length > 0) {
      telemetryEngine.processTelemetry(rawVehicles);
    }
  } catch (err) {
    // Keep background poll quiet while logging minimal failure
  }
}

setInterval(pollJctslTelemetry, 25000);
setTimeout(pollJctslTelemetry, 1500);

/*
|--------------------------------------------------------------------------
| 5. ROUTES BETWEEN TWO STOPS (POST/GET log/vehfromtostop & log/getRtefromto)
|--------------------------------------------------------------------------
*/
const handleRoutesBetweenStops = async (req, res) => {
  try {
    const headers = getAuthHeaders(req);
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
    console.error("Routes between stops error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to search routes between stops",
      error: error.message,
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
    const headers = getAuthHeaders(req);
    if (!headers) {
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data",
        requiresAuth: true,
      });
    }

    if (availableRoutesCache) {
      return res.json(availableRoutesCache);
    }

    const city_id = req.query?.city_id || req.body?.city_id || "1";
    const upstream = await jctslFetch("Log/getAvailableroutes", {
      method: "POST",
      headers,
      body: { city_id: String(city_id) },
      context: "handleAvailableRoutes",
      timeoutMs: 12000,
    });

    if (!upstream.isJson || !upstream.data) {
      return res.status(upstream.ok ? 200 : 502).json({
        respCode: "0",
        respMessage: "Upstream JCTSL service returned non-JSON response",
        upstreamStatus: upstream.status,
      });
    }

    const data = upstream.data;
    if (upstream.ok && data?.respCode === "200") {
      availableRoutesCache = data;
    }
    return res.status(upstream.status).json(data);
  } catch (error) {
    const cause = error.cause || {};
    const errorCode = error.code || cause.code || (error.name === "AbortError" ? "ETIMEDOUT" : "FETCH_ERROR");
    console.error(`[Available Routes Error] ${error.name}: ${error.message} (code: ${errorCode}, cause: ${cause.message || "N/A"})`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch available routes",
      error: error.message,
      errorCode,
      errorDetails: {
        name: error.name,
        code: errorCode,
        causeMessage: cause.message || null,
      },
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
    const headers = getAuthHeaders(req);
    if (!headers) {
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
    console.error("Route search error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to search routes",
      error: error.message,
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
    const headers = getAuthHeaders(req);
    if (!headers) {
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

    const upstream = await jctslFetch("rt/rvsearching", {
      method: "POST",
      headers,
      body: { route_id: String(route_id) },
      context: "handleLiveRoute",
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
    console.error(`[Live Route Error] ${error.name}: ${error.message} (code: ${errorCode}, cause: ${cause.message || "N/A"})`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch live route data",
      error: error.message,
      errorCode,
      errorDetails: {
        name: error.name,
        code: errorCode,
        causeMessage: cause.message || null,
      },
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
    const headers = getAuthHeaders(req);
    if (!headers) {
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data",
        requiresAuth: true,
      });
    }

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
      return res.json(routeMapCache.get(routeKey));
    }

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

    if (!upstream.isJson || !upstream.data) {
      return res.status(upstream.ok ? 200 : 502).json({
        respCode: "0",
        respMessage: "Upstream JCTSL service returned non-JSON response",
        upstreamStatus: upstream.status,
      });
    }

    const data = upstream.data;
    if (upstream.ok && data?.respCode === "200" && !vehicle_number) {
      routeMapCache.set(routeKey, data);
    }
    return res.status(upstream.status).json(data);
  } catch (error) {
    const cause = error.cause || {};
    const errorCode = error.code || cause.code || (error.name === "AbortError" ? "ETIMEDOUT" : "FETCH_ERROR");
    console.error(`[Route Map Error] ${error.name}: ${error.message} (code: ${errorCode}, cause: ${cause.message || "N/A"})`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch route map data",
      error: error.message,
      errorCode,
      errorDetails: {
        name: error.name,
        code: errorCode,
        causeMessage: cause.message || null,
      },
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
    const headers = getAuthHeaders(req);
    if (!headers) {
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
    const errorCode = error.code || cause.code || (error.name === "AbortError" ? "ETIMEDOUT" : "FETCH_ERROR");
    console.error(`[Bus Track Error] ${error.name}: ${error.message} (code: ${errorCode}, cause: ${cause.message || "N/A"})`);
    return res.status(500).json({
      success: false,
      message: "Unable to track bus",
      error: error.message,
      errorCode,
      errorDetails: {
        name: error.name,
        code: errorCode,
        causeMessage: cause.message || null,
      },
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
    const headers = getAuthHeaders(req);
    if (!headers) {
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
    const errorCode = error.code || cause.code || (error.name === "AbortError" ? "ETIMEDOUT" : "FETCH_ERROR");
    console.error(`[Fare Error] ${error.name}: ${error.message} (code: ${errorCode}, cause: ${cause.message || "N/A"})`);
    return res.status(500).json({
      success: false,
      message: "Unable to calculate fare",
      error: error.message,
      errorCode,
      errorDetails: {
        name: error.name,
        code: errorCode,
        causeMessage: cause.message || null,
      },
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
    const headers = getAuthHeaders(req);
    if (!headers) {
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
    console.error(`[Bus Timings Error] ${error.name}: ${error.message} (code: ${errorCode}, cause: ${cause.message || "N/A"})`);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch bus timings",
      error: error.message,
      errorCode,
      errorDetails: {
        name: error.name,
        code: errorCode,
        causeMessage: cause.message || null,
      },
    });
  }
};

app.get("/api/bus-timings/:routeId", handleBusTimings);
app.get("/api/bus-timings", handleBusTimings);
app.post("/api/bus-timings", handleBusTimings);

// Background cache warmer for route maps to guarantee <5ms response
async function warmRouteMaps() {
  try {
    if (!activeSession) return;
    const headers = getAuthHeaders();
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

app.listen(PORT, () => {
  console.log(`JBL Backend running on http://localhost:${PORT}`);
  setTimeout(warmRouteMaps, 1000);
});