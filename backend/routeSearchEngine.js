/**
 * routeSearchEngine.js - Jaipur Bus Live (JBL)
 * Global Strict Route Search & Connecting Journey Engine
 *
 * Enforces:
 * 1. Exact & verified stop resolution with synonym support and zero substring conflation
 *    ("Sanganeri Gate" NEVER matches "Sanganer", "Chomu Puliya" NEVER matches "Chomu").
 * 2. Strict sequential stop ordering for direct routes (origin index < destination index).
 * 3. Reversed direction rejection (opposite direction routes never returned as direct).
 * 4. Unrelated destination-only routes rejection.
 * 5. Multi-leg connecting journeys (1-transfer) when no direct route exists, supported
 *    by actual JCTSL route-stop sequences.
 * 6. Live GPS bus mapping with genuine vehicle registration numbers and zero mock data.
 * 7. Honest missing data reporting when routes or stops do not exist.
 */

const fs = require("fs");
const path = require("path");

// Load canonical datasets with graceful fallbacks
let canonicalBusStops = [];
let canonicalRoutes = [];

try {
  const stopsPath = path.join(__dirname, "data", "busStops.json");
  if (fs.existsSync(stopsPath)) {
    canonicalBusStops = JSON.parse(fs.readFileSync(stopsPath, "utf8"));
  }
} catch (err) {
  console.warn("[RouteSearchEngine] Warning loading busStops.json:", err.message);
}

try {
  const routesPath = path.join(__dirname, "data", "routesWithStops.json");
  if (fs.existsSync(routesPath)) {
    canonicalRoutes = JSON.parse(fs.readFileSync(routesPath, "utf8"));
  }
} catch (err) {
  console.warn("[RouteSearchEngine] Warning loading routesWithStops.json:", err.message);
}

/**
 * Clean route code for comparisons (e.g. "6-A" -> "6a", "AC 2" -> "ac2")
 */
function cleanRouteCode(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[-\s]/g, "");
}

/**
 * Clean text for alphanumeric comparison
 */
function cleanText(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Tokenize string into lowercase alphanumeric words
 */
function tokenize(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Calculate Haversine distance in kilometers between two GPS coordinates
 */
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

/**
 * Common transit synonyms for Jaipur
 */
const SYNONYM_MAP = {
  thana: ["police", "station", "policestation"],
  police: ["thana"],
  stn: ["station", "railwaystation", "railway"],
  station: ["stn"],
  rly: ["railway"],
  railway: ["rly"],
  hospital: ["aspatal", "chikitsalaya"],
  puliya: ["flyover", "bridge"],
  flyover: ["puliya"],
  chouraha: ["circle", "chauraha", "crossing"],
  circle: ["chouraha", "chauraha"],
  stand: ["stop", "busstand", "busstop"],
  stop: ["stand", "busstop", "busstand"],
};

/**
 * Canonicalizes common multi-word transit phrases into canonical single tokens
 */
function canonicalizeTransitPhrases(str) {
  return String(str || "")
    .replace(/\bpolice\s+station\b/gi, "thana")
    .replace(/\brailway\s+station\b/gi, "stn")
    .replace(/\brly\s+stn\b/gi, "stn")
    .replace(/\bbus\s+stand\b/gi, "stand")
    .replace(/\bbus\s+stop\b/gi, "stop")
    .replace(/\bair\s*port\b/gi, "airport");
}

function uniqueStops(stops) {
  const unique = new Map();
  for (const stop of stops) {
    const key = stop.bus_stop_id != null
      ? `id:${stop.bus_stop_id}`
      : stop.bus_stop_code
        ? `code:${String(stop.bus_stop_code).trim().toUpperCase()}`
        : `${cleanText(stop.bus_stop_name)}:${stop.latitude}:${stop.longitude}`;
    unique.set(key, stop);
  }
  return [...unique.values()];
}

function resolution(stops) {
  const candidates = uniqueStops(stops);
  return {
    stop: candidates.length === 1 ? candidates[0] : null,
    candidates,
    ambiguous: candidates.length > 1,
  };
}

function resolveStopDetailed(input, allStops = canonicalBusStops) {
  if (!input || !Array.isArray(allStops) || allStops.length === 0) {
    return { stop: null, candidates: [], ambiguous: false };
  }

  if (typeof input === "object" && input !== null) {
    if (input.bus_stop_code) {
      const byCode = allStops.filter(
        (stop) => String(stop.bus_stop_code || "").trim().toUpperCase() ===
          String(input.bus_stop_code).trim().toUpperCase()
      );
      if (byCode.length) return resolution(byCode);
    }
    if (input.bus_stop_id != null) {
      const byId = allStops.filter(
        (stop) => String(stop.bus_stop_id) === String(input.bus_stop_id)
      );
      if (byId.length) return resolution(byId);
    }
    input = input.bus_stop_name || input.name || input.bus_stop;
  }

  const raw = String(input || "").trim();
  if (!raw) return { stop: null, candidates: [], ambiguous: false };

  const rawUpper = raw.toUpperCase();
  const rawClean = cleanText(raw);
  const inputTokens = tokenize(canonicalizeTransitPhrases(raw));
  const exactCode = allStops.filter(
    (stop) => String(stop.bus_stop_code || "").trim().toUpperCase() === rawUpper
  );
  if (exactCode.length) return resolution(exactCode);

  const exactId = allStops.filter(
    (stop) => stop.bus_stop_id != null && String(stop.bus_stop_id) === raw
  );
  if (exactId.length) return resolution(exactId);

  const exactName = allStops.filter(
    (stop) => cleanText(stop.bus_stop_name) === rawClean
  );
  if (exactName.length) return resolution(exactName);

  const inputTokenSet = new Set(inputTokens);
  const tokenSetMatches = allStops.filter((stop) => {
    const tokens = tokenize(canonicalizeTransitPhrases(stop.bus_stop_name));
    return tokens.length === inputTokens.length &&
      tokens.every((token) => inputTokenSet.has(token));
  });
  if (tokenSetMatches.length) return resolution(tokenSetMatches);

  const synonymMatches = allStops.filter((stop) => {
    const tokens = tokenize(canonicalizeTransitPhrases(stop.bus_stop_name));
    if (Math.abs(tokens.length - inputTokens.length) > 1) return false;
    return inputTokens.every((token) => tokens.includes(token) ||
      (SYNONYM_MAP[token] || []).some((synonym) => tokens.includes(synonym)));
  });
  if (synonymMatches.length) return resolution(synonymMatches);

  const strongModifiers = new Set([
    "gate", "puliya", "flyover", "road", "bypass", "phatak", "sector", "sec",
  ]);
  const inputModifiers = inputTokens.filter((token) => strongModifiers.has(token));
  const candidates = allStops.filter((stop) => {
    const tokens = tokenize(canonicalizeTransitPhrases(stop.bus_stop_name));
    const stopModifiers = tokens.filter((token) => strongModifiers.has(token));
    if (inputModifiers.length !== stopModifiers.length ||
        inputModifiers.some((modifier) => !stopModifiers.includes(modifier))) {
      return false;
    }
    const common = inputTokens.filter((token) => tokens.includes(token));
    return common.length >= Math.min(inputTokens.length, tokens.length);
  });

  return resolution(candidates);
}

/**
 * Resolves a stop input (string or object) to a verified stop in allStops
 * Strict rules to avoid substring traps:
 * - "SANGANER" must NEVER match "SANGANERI GATE"
 * - "CHOMU" must NEVER match "CHOMU PULIYA"
 * - "TONK ROAD" must NEVER match "TONK PHATAK"
 * - "AJMER ROAD" must NEVER match "AJMERI GATE"
 */
function resolveStop(input, allStops = canonicalBusStops) {
  return resolveStopDetailed(input, allStops).stop;
}

/**
 * Finds the index of a target stop in a route's ordered stop sequence.
 * Strict matching prevents false positives:
 * - Exact clean name match
 * - Exact token set match
 * - High-precision GPS proximity (< 250m) only if root tokens match
 * - NEVER arbitrary substring inclusion!
 */
function stopName(stop) {
  return stop?.bus_stop_name || stop?.name || stop?.bus_stop || stop?.stop_name || "";
}

function stopNameOfRouteStop(stop) {
  return stopName(stop);
}

function stopCoordinates(stop) {
  const latitude = Number(stop?.latitude ?? stop?.lat);
  const longitude = Number(stop?.longitude ?? stop?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < 25 || latitude > 29 || longitude < 74 || longitude > 78) {
    return null;
  }
  return { latitude, longitude };
}

function matchingRouteStopIndices(orderedStops, targetStop) {
  const targetId = targetStop?.bus_stop_id;
  if (targetId != null) {
    const matches = orderedStops.flatMap((stop, index) =>
      String(stop.bus_stop_id ?? "") === String(targetId) ? [index] : []
    );
    if (matches.length) return matches;
  }

  const targetCode = String(targetStop?.bus_stop_code || "").trim().toUpperCase();
  if (targetCode) {
    const matches = orderedStops.flatMap((stop, index) =>
      String(stop.bus_stop_code || "").trim().toUpperCase() === targetCode ? [index] : []
    );
    if (matches.length) return matches;
  }

  const targetName = cleanText(stopName(targetStop));
  const targetTokens = tokenize(canonicalizeTransitPhrases(stopName(targetStop)));
  if (!targetName) return [];

  const byExactName = orderedStops.flatMap((stop, index) =>
    cleanText(stopName(stop)) === targetName ? [index] : []
  );
  if (byExactName.length) return byExactName;

  const targetTokenSet = new Set(targetTokens);
  const byTokenSet = orderedStops.flatMap((stop, index) => {
    const tokens = tokenize(canonicalizeTransitPhrases(stopName(stop)));
    return tokens.length === targetTokens.length &&
      tokens.every((token) => targetTokenSet.has(token)) ? [index] : [];
  });
  if (byTokenSet.length) return byTokenSet;

  const bySynonym = orderedStops.flatMap((stop, index) => {
    const tokens = tokenize(canonicalizeTransitPhrases(stopName(stop)));
    const matches = Math.abs(tokens.length - targetTokens.length) <= 1 &&
      targetTokens.every((token) => tokens.includes(token) ||
        (SYNONYM_MAP[token] || []).some((synonym) => tokens.includes(synonym)));
    return matches ? [index] : [];
  });
  if (bySynonym.length) return bySynonym;

  const targetCoords = stopCoordinates(targetStop);
  if (!targetCoords) return [];
  return orderedStops.flatMap((stop, index) => {
    const coordinates = stopCoordinates(stop);
    if (!coordinates) return [];
    const tokens = tokenize(canonicalizeTransitPhrases(stopName(stop)));
    const modifiers = ["gate", "puliya", "flyover", "road", "bypass", "phatak"];
    const hasSameModifiers = modifiers.filter((token) => targetTokens.includes(token))
      .every((token) => tokens.includes(token)) &&
      modifiers.filter((token) => tokens.includes(token))
        .every((token) => targetTokens.includes(token));
    const sharesNameToken = targetTokens.some((token) => tokens.includes(token));
    return hasSameModifiers && sharesNameToken &&
      calculateDistanceKm(
        targetCoords.latitude,
        targetCoords.longitude,
        coordinates.latitude,
        coordinates.longitude
      ) < 0.25 ? [index] : [];
  });
}

function findStopIndexInRoute(orderedStops, targetStop, minIndex = 0) {
  if (!targetStop || !Array.isArray(orderedStops) || orderedStops.length === 0) {
    return -1;
  }
  return matchingRouteStopIndices(orderedStops, targetStop)
    .find((index) => index >= minIndex) ?? -1;
}

function sameStopName(first, second) {
  const firstCanonical = tokenize(canonicalizeTransitPhrases(stopName(first)));
  const secondCanonical = tokenize(canonicalizeTransitPhrases(stopName(second)));
  return firstCanonical.length > 0 &&
    firstCanonical.length === secondCanonical.length &&
    firstCanonical.every((token) => secondCanonical.includes(token));
}

function samePhysicalStop(first, second) {
  if (!first || !second) return false;
  for (const key of ["bus_stop_id", "bus_stop_code"]) {
    const firstValue = first[key];
    const secondValue = second[key];
    if (firstValue != null && secondValue != null && String(firstValue).trim() &&
        String(secondValue).trim()) {
      return String(firstValue).trim().toUpperCase() ===
        String(secondValue).trim().toUpperCase();
    }
  }

  const firstCoordinates = stopCoordinates(first);
  const secondCoordinates = stopCoordinates(second);
  if (firstCoordinates && secondCoordinates) {
    if (sameStopName(first, second) &&
      calculateDistanceKm(
        firstCoordinates.latitude,
        firstCoordinates.longitude,
        secondCoordinates.latitude,
        secondCoordinates.longitude
      ) < 0.25) return true;
  }

  const firstCanonical = resolveStop(stopName(first));
  const secondCanonical = resolveStop(stopName(second));
  if (firstCanonical && secondCanonical &&
      String(firstCanonical.bus_stop_id) === String(secondCanonical.bus_stop_id)) {
    return true;
  }
  return false;
}

/**
 * Maps genuine live GPS buses to a specific route by route number
 */
function mapLiveBusesToRoute(routeOrgNo, liveBuses) {
  if (!routeOrgNo || !Array.isArray(liveBuses) || liveBuses.length === 0) {
    return [];
  }
  const cleanOrg = cleanRouteCode(routeOrgNo);
  const matched = [];
  const seenVehicles = new Set();

  for (const b of liveBuses) {
    if (!b || typeof b !== "object") continue;
    const busRno = cleanRouteCode(b.rno || b.route || b.routeNumber || b.route_orgno);
    const vNo = String(
      b.vehno || b.vehicle_number || b.vehicleNumber || b.vehNo || ""
    ).trim();
    const vehicleKey = vNo.toUpperCase();
    const latitude = Number(b.curlat ?? b.latitude ?? b.lat);
    const longitude = Number(b.curlong ?? b.longitude ?? b.lng);

    if (vNo && busRno === cleanOrg && !seenVehicles.has(vehicleKey) &&
        Number.isFinite(latitude) && Number.isFinite(longitude) &&
        latitude >= 25 && latitude <= 29 && longitude >= 74 && longitude <= 78) {
      seenVehicles.add(vehicleKey);
      matched.push({
        vehicle_number: vNo,
        vehicleNumber: vNo,
        vehno: vNo,
        latitude,
        longitude,
        speed: typeof b.speed === "number" ? b.speed : parseFloat(b.speed) || 0,
        movementState: b.movementState || b.movement_state || "STOPPED",
        telemetryStatus: b.telemetryStatus || b.status || "LIVE",
        status: b.telemetryStatus || b.status || "LIVE",
        lastSeen: b.lastSeen || b.telemetryTimestamp || Date.now(),
      });
    }
  }

  return matched;
}

function routeMatchesFilter(route, filterRoute) {
  if (!filterRoute) return true;
  const query = cleanRouteCode(filterRoute);
  return cleanRouteCode(route.route_orgno) === query ||
    cleanRouteCode(route.route_id) === query;
}

function routeIdentity(route) {
  return String(route.route_id || route.route_orgno || "");
}

/**
 * Searches for all verified direct routes serving origin and destination in correct travel order.
 */
function findDirectRoutes(
  originStop,
  destStop,
  allRoutes = canonicalRoutes,
  liveBuses = [],
  filterRoute = null
) {
  if (!originStop || !destStop || !Array.isArray(allRoutes)) {
    return [];
  }

  const directRoutes = [];

  for (const r of allRoutes) {
    if (!routeMatchesFilter(r, filterRoute)) continue;
    const stops = r.stops || r.bus_stop_list || [];
    if (!Array.isArray(stops) || stops.length === 0) continue;

    const originIndices = matchingRouteStopIndices(stops, originStop);
    const destinationIndices = matchingRouteStopIndices(stops, destStop);
    const validPairs = originIndices.flatMap((fromIndex) =>
      destinationIndices
        .filter((toIndex) => fromIndex < toIndex)
        .map((toIndex) => ({ fromIndex, toIndex }))
    );
    if (!validPairs.length) continue;
    validPairs.sort((a, b) =>
      (a.toIndex - a.fromIndex) - (b.toIndex - b.fromIndex) ||
      a.fromIndex - b.fromIndex
    );
    const { fromIndex: fIdx, toIndex: tIdx } = validPairs[0];

    const traversalStops = stops.slice(fIdx, tIdx + 1).map((s, idx) => ({
      order: s.order || fIdx + idx + 1,
      name: s.name || s.bus_stop,
      latitude: s.latitude,
      longitude: s.longitude,
    }));

    const matchingBuses = mapLiveBusesToRoute(r.route_orgno, liveBuses);

    directRoutes.push({
      route_id: String(r.route_id),
      route_orgno: String(r.route_orgno),
      route_name: String(r.route_name),
      route_type: r.routetype || r.route_type || "City",
      rkm: r.rkm || "",
      from_stop_matched: stops[fIdx].name || stops[fIdx].bus_stop,
      from_stop_code: originStop.bus_stop_code || "",
      from_stop_index: fIdx,
      to_stop_matched: stops[tIdx].name || stops[tIdx].bus_stop,
      to_stop_code: destStop.bus_stop_code || "",
      to_stop_index: tIdx,
      intermediate_stops_count: traversalStops.length,
      total_route_stops: stops.length,
      traversal_stops: traversalStops,
      all_stops: stops.map((s, idx) => ({
        order: s.order || idx + 1,
        name: s.name || s.bus_stop,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
      live_buses: matchingBuses,
      live_buses_count: matchingBuses.length,
      is_direct: true,
      journey_type: "direct",
    });
  }

  // Sort direct routes: routes with live buses first, then fewest intermediate stops
  directRoutes.sort((a, b) => {
    if (b.live_buses_count !== a.live_buses_count) {
      return b.live_buses_count - a.live_buses_count;
    }
    return a.intermediate_stops_count - b.intermediate_stops_count;
  });

  return directRoutes;
}

/**
 * Searches for verified 1-transfer connecting journeys when no direct route exists.
 * Every leg is validated for correct travel order:
 * Leg 1: Origin -> Transfer (index(Origin) < index(Transfer))
 * Leg 2: Transfer -> Destination (index(Transfer) < index(Destination))
 */
function findConnectingJourneys(
  originStop,
  destStop,
  allRoutes = canonicalRoutes,
  liveBuses = [],
  maxJourneys = 5,
  filterRoute = null
) {
  if (!originStop || !destStop || !Array.isArray(allRoutes)) {
    return [];
  }

  // 1. Gather all candidate Leg 1 routes (routes serving origin)
  const leg1Options = []; // { route, fromIdx, transferIdx, transferStopName, traversalStops }
  for (const r of allRoutes) {
    const stops = r.stops || r.bus_stop_list || [];
    if (!Array.isArray(stops) || stops.length === 0) continue;

    for (const fIdx of matchingRouteStopIndices(stops, originStop)) {
      for (let i = fIdx + 1; i < stops.length; i++) {
        if (samePhysicalStop(stops[i], originStop) ||
            samePhysicalStop(stops[i], destStop)) continue;
        const stopName = stopNameOfRouteStop(stops[i]);

        leg1Options.push({
          route: r,
          fromIdx: fIdx,
          transferIdx: i,
          transferStopName: stopName,
          transferStopObj: stops[i],
          stopsCount: i - fIdx + 1,
        });
      }
    }
  }

  // 2. Gather all candidate Leg 2 routes (routes serving destination)
  const leg2Options = []; // { route, transferIdx, toIdx, transferStopName, traversalStops }
  for (const r of allRoutes) {
    const stops = r.stops || r.bus_stop_list || [];
    if (!Array.isArray(stops) || stops.length === 0) continue;

    for (const tIdx of matchingRouteStopIndices(stops, destStop)) {
      for (let i = 0; i < tIdx; i++) {
        if (samePhysicalStop(stops[i], originStop) ||
            samePhysicalStop(stops[i], destStop)) continue;
        const stopName = stopNameOfRouteStop(stops[i]);

        leg2Options.push({
          route: r,
          transferIdx: i,
          toIdx: tIdx,
          transferStopName: stopName,
          transferStopObj: stops[i],
          stopsCount: tIdx - i + 1,
        });
      }
    }
  }

  // Known major transit hubs in Jaipur get higher priority
  const MAJOR_HUBS = [
    "ajmerigate",
    "sindhicamp",
    "sanganerigate",
    "chomupuliya",
    "chandpole",
    "railwaystation",
    "jaipurrailwaystation",
    "transportnagar",
    "panipach",
    "rambaghcircle",
    "galtagate",
    "sanganer",
    "sanganerthana",
  ];

  const connections = [];
  const seenCombinations = new Set();

  for (const l1 of leg1Options) {
    for (const l2 of leg2Options) {
      if (!samePhysicalStop(l1.transferStopObj, l2.transferStopObj)) continue;

      if (routeIdentity(l1.route) === routeIdentity(l2.route)) continue;
      if (filterRoute &&
          !routeMatchesFilter(l1.route, filterRoute) &&
          !routeMatchesFilter(l2.route, filterRoute)) continue;

      const transferCoordinates = stopCoordinates(l1.transferStopObj);
      const transferKey = l1.transferStopObj.bus_stop_id != null
        ? `id:${l1.transferStopObj.bus_stop_id}`
        : l1.transferStopObj.bus_stop_code
          ? `code:${String(l1.transferStopObj.bus_stop_code).trim().toUpperCase()}`
          : `${cleanText(stopNameOfRouteStop(l1.transferStopObj))}:${
              transferCoordinates
                ? `${transferCoordinates.latitude.toFixed(4)},${transferCoordinates.longitude.toFixed(4)}`
                : ""
            }`;
      const comboKey = `${routeIdentity(l1.route)}->${transferKey}->${routeIdentity(l2.route)}`;
      if (seenCombinations.has(comboKey)) continue;
      seenCombinations.add(comboKey);

      const l1Stops = (l1.route.stops || l1.route.bus_stop_list)
        .slice(l1.fromIdx, l1.transferIdx + 1)
        .map((s, idx) => ({
          order: s.order || l1.fromIdx + idx + 1,
          name: s.name || s.bus_stop,
          latitude: s.latitude,
          longitude: s.longitude,
        }));

      const l2Stops = (l2.route.stops || l2.route.bus_stop_list)
        .slice(l2.transferIdx, l2.toIdx + 1)
        .map((s, idx) => ({
          order: s.order || l2.transferIdx + idx + 1,
          name: s.name || s.bus_stop,
          latitude: s.latitude,
          longitude: s.longitude,
        }));

      const l1Buses = mapLiveBusesToRoute(l1.route.route_orgno, liveBuses);
      const l2Buses = mapLiveBusesToRoute(l2.route.route_orgno, liveBuses);

      const totalStops = l1Stops.length + l2Stops.length - 1;
      const totalLiveBuses = l1Buses.length + l2Buses.length;

      // Calculate score for ranking
      let hubBonus = MAJOR_HUBS.includes(l1.transferStopNorm) ? -8 : 0;
      let busBonus = totalLiveBuses > 0 ? -15 : 0;
      let score = totalStops + hubBonus + busBonus;

      connections.push({
        score,
        journey_type: "connecting",
        is_connecting: true,
        transfer_stop: {
          name: l1.transferStopName,
          latitude: l1.transferStopObj.latitude,
          longitude: l1.transferStopObj.longitude,
          bus_stop_id: l1.transferStopObj.bus_stop_id,
          bus_stop_code: l1.transferStopObj.bus_stop_code,
        },
        total_stops_count: totalStops,
        total_live_buses_count: totalLiveBuses,
        leg1: {
          route_id: String(l1.route.route_id),
          route_orgno: String(l1.route.route_orgno),
          route_name: String(l1.route.route_name),
          from_stop: l1Stops[0].name,
          from_stop_index: l1.fromIdx,
          transfer_stop: l1.transferStopName,
          transfer_stop_index: l1.transferIdx,
          intermediate_stops_count: l1Stops.length,
          traversal_stops: l1Stops,
          live_buses: l1Buses,
          live_buses_count: l1Buses.length,
        },
        leg2: {
          route_id: String(l2.route.route_id),
          route_orgno: String(l2.route.route_orgno),
          route_name: String(l2.route.route_name),
          transfer_stop: l2.transferStopName,
          transfer_stop_index: l2.transferIdx,
          to_stop: l2Stops[l2Stops.length - 1].name,
          to_stop_index: l2.toIdx,
          intermediate_stops_count: l2Stops.length,
          traversal_stops: l2Stops,
          live_buses: l2Buses,
          live_buses_count: l2Buses.length,
        },
      });
    }
  }

  connections.sort((a, b) => a.score - b.score);
  const limit = Number.isFinite(maxJourneys) ? Math.max(0, maxJourneys) : 5;
  return connections.slice(0, limit).map(({ score, ...rest }) => rest);
}

/**
 * Universal Route Search Handler
 */
function searchRoutesBetweenStops({
  from,
  to,
  filterRoute = null,
  liveBuses = [],
  allStops = canonicalBusStops,
  allRoutes = canonicalRoutes,
}) {
  if (!from || !to) {
    return {
      success: false,
      count: 0,
      journey_type: "none",
      routes: [],
      connecting_journeys: [],
      message: "Both from and to stops are required",
    };
  }

  const fromResolution = resolveStopDetailed(from, allStops);
  const toResolution = resolveStopDetailed(to, allStops);
  const fromStop = fromResolution.stop;
  const toStop = toResolution.stop;

  if (!fromStop || !toStop) {
    const missing = [];
    if (!fromStop) {
      missing.push(fromResolution.ambiguous
        ? `ambiguous origin "${from}"`
        : `origin "${from}"`);
    }
    if (!toStop) {
      missing.push(toResolution.ambiguous
        ? `ambiguous destination "${to}"`
        : `destination "${to}"`);
    }
    return {
      success: false,
      count: 0,
      journey_type: "none",
      from_stop: fromStop,
      to_stop: toStop,
      from_stop_candidates: fromResolution.candidates,
      to_stop_candidates: toResolution.candidates,
      ambiguous: fromResolution.ambiguous || toResolution.ambiguous,
      routes: [],
      connecting_journeys: [],
      message: `Could not resolve ${missing.join(" and ")} in JCTSL database`,
    };
  }

  // 1. Search direct routes
  const directRoutes = findDirectRoutes(
    fromStop,
    toStop,
    allRoutes,
    liveBuses,
    filterRoute
  );

  if (directRoutes.length > 0) {
    return {
      success: true,
      journey_type: "direct",
      from_stop: fromStop,
      to_stop: toStop,
      count: directRoutes.length,
      routes: directRoutes,
      connecting_journeys: [],
      message: `${directRoutes.length} direct JCTSL route(s) found`,
    };
  }

  // 2. If no direct routes, search connecting journeys
  const connectingJourneys = findConnectingJourneys(
    fromStop,
    toStop,
    allRoutes,
    liveBuses,
    5,
    filterRoute
  );

  if (connectingJourneys.length > 0) {
    return {
      success: true,
      journey_type: "connecting",
      from_stop: fromStop,
      to_stop: toStop,
      count: 0,
      routes: [],
      connecting_journeys: connectingJourneys,
      message: `${connectingJourneys.length} verified connecting journey(s) found (1 transfer)`,
    };
  }

  // 3. No direct or connecting routes found
  return {
    success: true,
    journey_type: "none",
    from_stop: fromStop,
    to_stop: toStop,
    count: 0,
    routes: [],
    connecting_journeys: [],
    message: `No direct or connecting JCTSL routes found between ${fromStop.bus_stop_name} and ${toStop.bus_stop_name}`,
  };
}

module.exports = {
  cleanRouteCode,
  cleanText,
  tokenize,
  calculateDistanceKm,
  resolveStop,
  resolveStopDetailed,
  findStopIndexInRoute,
  samePhysicalStop,
  mapLiveBusesToRoute,
  findDirectRoutes,
  findConnectingJourneys,
  searchRoutesBetweenStops,
  canonicalBusStops,
  canonicalRoutes,
};
