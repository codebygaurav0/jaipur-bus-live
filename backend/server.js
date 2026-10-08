const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { telemetryEngine } = require("./telemetryEngine");

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
| HELPER: AUTH CHECK
| Supports incoming headers, or automatically attaches backend activeSession.
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
    "Content-Type": "application/json",
    "Auth-token": authToken,
    "User-ID": String(userId),
  };
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

    let logUsrResponse = await fetch(`${JCTSL_BASE_URL}log/usr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(loginPayload),
    });

    let logUsrData = await logUsrResponse.json();

    // If device mismatch ("1"), APK calls K("1") to confirm device switch
    if (logUsrData?.respData?.dev_mis_flag === "1") {
      const switchPayload = {
        ...loginPayload,
        req_type: "1",
      };

      logUsrResponse = await fetch(`${JCTSL_BASE_URL}log/usr`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(switchPayload),
      });

      logUsrData = await logUsrResponse.json();
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

    const verifyResponse = await fetch(`${JCTSL_BASE_URL}verifyuser`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(verifyPayload),
    });

    const verifyData = await verifyResponse.json();

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

    const response = await fetch(`${JCTSL_BASE_URL}SUser/citiList`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Cities fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch cities",
      error: error.message,
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
      const res = await fetch(`${JCTSL_BASE_URL}usr/citibuslist`, {
        method: "POST",
        headers,
        body: JSON.stringify({ city_id: "1" }),
      });
      const d = await res.json();
      if (d?.respCode === "200") busStopsCache = d;
    } catch (_) {}
  }

  // Ensure routes cache
  if (!availableRoutesCache) {
    try {
      const res = await fetch(`${JCTSL_BASE_URL}Log/getAvailableroutes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ city_id: "1" }),
      });
      const d = await res.json();
      if (d?.respCode === "200") availableRoutesCache = d;
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
    const cbRes = await fetch(`${JCTSL_BASE_URL}allvehloc`, {
      method: "POST",
      headers,
      body: JSON.stringify({ org_id: "1" }),
    });
    const cbData = await cbRes.json();
    if (Array.isArray(cbData?.respData)) cityBuses = cbData.respData;
  } catch (_) {}

  const validRoutes = [];

  for (const r of candidateRoutes) {
    const routeId = String(r.route_id).trim();
    let mapData = routeMapCache.get(routeId);

    if (!mapData) {
      try {
        const mRes = await fetch(`${JCTSL_BASE_URL}rt/bspdtl`, {
          method: "POST",
          headers,
          body: JSON.stringify({ route_no: routeId, vehicle_number: "" }),
        });
        mapData = await mRes.json();
        if (mapData?.respCode === "200") {
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
      const liveRes = await fetch(`${JCTSL_BASE_URL}rt/rvsearching`, {
        method: "POST",
        headers,
        body: JSON.stringify({ route_id: routeId }),
      });
      const liveData = await liveRes.json();

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

    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        city_id: String(city_id),
      }),
    });

    const data = await response.json();
    if (response.ok && data?.respCode === "200") {
      busStopsCache = data;
    }
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Bus stops fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch bus stops",
      error: error.message,
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

    const response = await fetch(`${JCTSL_BASE_URL}log/vehnearstop`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        bus_stop_cd: String(stopCode),
        ver_nm: "1.5.1",
        ver_cd: "30",
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Buses near stop fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch buses for selected stop",
      error: error.message,
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
      return res.status(401).json({
        success: false,
        message: "Login required for live JCTSL data",
        requiresAuth: true,
      });
    }

    const org_id = req.query?.org_id || req.body?.org_id || "1";

    const response = await fetch(`${JCTSL_BASE_URL}allvehloc`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        org_id: String(org_id),
      }),
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return res.json({
        respCode: "0",
        respMessage: "Invalid response from JCTSL telemetry service",
        summary: telemetryEngine.getSummary(),
        respData: telemetryEngine.getLiveVehicles(),
      });
    }

    const rawVehicles = Array.isArray(data?.respData)
      ? data.respData
      : Array.isArray(data)
      ? data
      : [];

    const { summary, vehicles } = telemetryEngine.processTelemetry(rawVehicles);

    return res.status(response.status).json({
      respCode: data?.respCode || "200",
      respMessage: data?.respMessage || "Success",
      summary,
      respData: vehicles,
    });
  } catch (error) {
    console.error("Live buses error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch live buses",
      error: error.message,
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
    const response = await fetch(`${JCTSL_BASE_URL}allvehloc`, {
      method: "POST",
      headers,
      body: JSON.stringify({ org_id: "1" }),
    });
    if (!response.ok) return;
    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return;
    }
    const rawVehicles = Array.isArray(data?.respData)
      ? data.respData
      : Array.isArray(data)
      ? data
      : [];
    if (rawVehicles.length > 0) {
      telemetryEngine.processTelemetry(rawVehicles);
    }
  } catch (err) {
    // Suppress background poll errors to keep logs clean
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
    const response = await fetch(`${JCTSL_BASE_URL}Log/getAvailableroutes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        city_id: String(city_id),
      }),
    });

    const data = await response.json();
    if (response.ok && data?.respCode === "200") {
      availableRoutesCache = data;
    }
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Available routes error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch available routes",
      error: error.message,
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
      const response = await fetch(`${JCTSL_BASE_URL}Log/getAvailableroutes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ city_id: "1" }),
      });
      const data = await response.json();
      if (response.ok && data?.respCode === "200") {
        availableRoutesCache = data;
      }
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

    const response = await fetch(`${JCTSL_BASE_URL}rt/rvsearching`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        route_id: String(route_id),
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Live route error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch live route data",
      error: error.message,
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

    const response = await fetch(`${JCTSL_BASE_URL}rt/bspdtl`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        route_no: routeKey,
        vehicle_number: String(vehicle_number || ""),
      }),
    });

    const data = await response.json();
    if (response.ok && data?.respCode === "200" && !vehicle_number) {
      routeMapCache.set(routeKey, data);
    }
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Route map error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch route map data",
      error: error.message,
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

    const response = await fetch(`${JCTSL_BASE_URL}rt/bstrack`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        route_number: String(route_number),
        vehicle_number: String(vehicle_number),
        order_id: String(order_id || ""),
      }),
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return res.json({
        success: false,
        respCode: "0",
        message: "Live bus telemetry not transmitting or vehicle off-duty",
      });
    }

    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Bus track error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to track bus",
      error: error.message,
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

    const response = await fetch(`${JCTSL_BASE_URL}rt/gptkt`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from_stop: String(from_stop),
        to_stop: String(to_stop),
        route_id: String(route_id),
        bus_type: String(bus_type),
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Fare calculate error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to calculate fare",
      error: error.message,
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

    const response = await fetch(`${JCTSL_BASE_URL}log/gettrps`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        route_id: String(route_id),
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Bus timings error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch bus timings",
      error: error.message,
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
      const routesRes = await fetch(`${JCTSL_BASE_URL}Log/getAvailableroutes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ city_id: "1" }),
      });
      const rData = await routesRes.json();
      if (rData?.respCode === "200") {
        availableRoutesCache = rData;
      }
    }

    const routes = availableRoutesCache?.respData || [];
    for (const r of routes) {
      const rId = String(r.route_id).trim();
      if (rId && !routeMapCache.has(rId)) {
        try {
          const mapRes = await fetch(`${JCTSL_BASE_URL}rt/bspdtl`, {
            method: "POST",
            headers,
            body: JSON.stringify({ route_no: rId, vehicle_number: "" }),
          });
          const mData = await mapRes.json();
          if (mData?.respCode === "200") {
            routeMapCache.set(rId, mData);
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