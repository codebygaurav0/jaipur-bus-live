/**
 * Jaipur Bus Live (JBL) — Real-Time Telemetry Evaluation Engine
 * 
 * Source: Official JCTSL Telemetry Feed (POST /OMB/allvehloc)
 * 
 * Core Invariant:
 * 1. ZERO synthetic/simulated GPS or fake movement.
 * 2. Real Haversine distance & speed calculation from consecutive JCTSL GPS points.
 * 3. Applies the exact same deterministic algorithm to EVERY bus uniformly.
 * 4. Categorizes status:
 *    - LIVE · MOVING (fresh valid GPS + movement >= 15m & speed >= 3 km/h)
 *    - LIVE · STOPPED (fresh valid GPS + stationary / parked)
 *    - GPS STALE (no telemetry received for > 60s)
 *    - GPS INVALID (null, 0, NaN, or coordinates outside Rajasthan/Jaipur bounds)
 */

function haversineMeters(lat1, lon1, lat2, lon2) {
  if (
    lat1 === null || lon1 === null || lat2 === null || lon2 === null ||
    isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)
  ) {
    return 0;
  }
  const R = 6371000; // Earth radius in meters
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

function isValidJaipurGps(lat, lng) {
  if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 || lng === 0) return false;
  // Bounding box for Rajasthan / Greater Jaipur Metropolitan Region
  // Approx: 25.0°N to 29.0°N, 74.0°E to 78.0°E
  if (lat < 25.0 || lat > 29.0 || lng < 74.0 || lng > 78.0) return false;
  return true;
}

class TelemetryEngine {
  constructor() {
    this.vehicleStore = new Map();
    this.latestSummary = {
      totalReceived: 0,
      validGps: 0,
      liveMoving: 0,
      liveStopped: 0,
      gpsStale: 0,
      gpsInvalid: 0,
      rejected: 0,
      lastUpdated: null,
    };
  }

  /**
   * Evaluates fresh array of raw vehicles from POST /OMB/allvehloc
   * @param {Array} rawVehicles
   * @returns {Object} { summary, vehicles }
   */
  processTelemetry(rawVehicles) {
    if (!Array.isArray(rawVehicles)) {
      return {
        summary: this.latestSummary,
        vehicles: this.getLiveVehicles(),
      };
    }

    const now = Date.now();
    const seenVehicleNumbers = new Set();

    let validGpsCount = 0;
    let liveMovingCount = 0;
    let liveStoppedCount = 0;
    let gpsInvalidCount = 0;
    let rejectedCount = 0;

    for (const raw of rawVehicles) {
      const vNo = String(
        raw.vehno || raw.vehicle_number || raw.vehicel_no || ""
      ).trim().toUpperCase();

      if (!vNo) {
        rejectedCount++;
        continue;
      }

      seenVehicleNumbers.add(vNo);

      const devId = String(raw.devid || raw.device_id || "").trim();
      const routeNo = String(
        raw.rno || raw.route_no || raw.route_number || ""
      ).trim();

      const curLat = parseFloat(raw.curlat || raw.latitude);
      const curLong = parseFloat(raw.curlong || raw.longitude);
      const prevLatRaw = parseFloat(raw.prevlat || raw.prelat);
      const prevLongRaw = parseFloat(raw.prevlong || raw.prelong);

      const hasValidCurrentGps = isValidJaipurGps(curLat, curLong);

      if (!hasValidCurrentGps) {
        gpsInvalidCount++;
        const record = {
          vehicleNumber: vNo,
          vehicle_number: vNo,
          vehno: vNo,
          deviceId: devId,
          device_id: devId,
          devid: devId,
          routeNumber: routeNo,
          route_number: routeNo,
          route: routeNo,
          rno: routeNo,
          latitude: isNaN(curLat) ? null : curLat,
          longitude: isNaN(curLong) ? null : curLong,
          previousLatitude: null,
          previousLongitude: null,
          previousTimestamp: null,
          currentLatitude: isNaN(curLat) ? null : curLat,
          currentLongitude: isNaN(curLong) ? null : curLong,
          curlat: raw.curlat || null,
          curlong: raw.curlong || null,
          prelat: raw.prevlat || raw.prelat || null,
          prelong: raw.prevlong || raw.prelong || null,
          previousTimestampIso: null,
          currentTimestamp: now,
          telemetryTimestamp: new Date(now).toISOString(),
          telemetryAge: 0,
          distanceMoved: 0,
          calculatedSpeed: 0,
          speed: 0,
          movementState: "STOPPED",
          movement_state: "STOPPED",
          telemetryStatus: "GPS INVALID",
          status: "GPS INVALID",
          lastSeen: now,
        };
        this.vehicleStore.set(vNo, record);
        continue;
      }

      validGpsCount++;

      const existing = this.vehicleStore.get(vNo);

      let prevLat = null;
      let prevLong = null;
      let prevTime = null;
      let distMeters = 0;
      let speedKmh = 0;
      let status = "LIVE · STOPPED";

      if (existing && existing.currentLatitude !== null && existing.currentLongitude !== null) {
        // Consecutive reading from previous server poll
        if (
          existing.currentLatitude === curLat &&
          existing.currentLongitude === curLong
        ) {
          // Stationary vehicle
          prevLat = existing.previousLatitude ?? curLat;
          prevLong = existing.previousLongitude ?? curLong;
          prevTime = existing.previousTimestamp ?? existing.currentTimestamp;
          distMeters = 0;
          speedKmh = 0;
          status = "LIVE · STOPPED";
          liveStoppedCount++;
        } else {
          // Coordinates shifted between consecutive polls
          prevLat = existing.currentLatitude;
          prevLong = existing.currentLongitude;
          prevTime = existing.currentTimestamp;

          const elapsedSec = Math.max(1, (now - prevTime) / 1000);
          distMeters = Math.round(haversineMeters(prevLat, prevLong, curLat, curLong) * 10) / 10;
          speedKmh = Math.round(((distMeters / elapsedSec) * 3.6) * 10) / 10;

          // Reject unreasonable teleports/GPS anomalies (> 120 km/h city bus)
          if (speedKmh > 120) {
            speedKmh = 0;
            distMeters = 0;
            status = "LIVE · STOPPED";
            liveStoppedCount++;
          } else if (distMeters >= 15 && speedKmh >= 3.0) {
            status = "LIVE · MOVING";
            liveMovingCount++;
          } else {
            status = "LIVE · STOPPED";
            liveStoppedCount++;
          }
        }
      } else {
        // First observation in this server process
        // Check if upstream payload provided prevlat/prevlong
        if (
          isValidJaipurGps(prevLatRaw, prevLongRaw) &&
          (prevLatRaw !== curLat || prevLongRaw !== curLong)
        ) {
          prevLat = prevLatRaw;
          prevLong = prevLongRaw;
          prevTime = now - 25000; // Standard 25s transmission delta
          const elapsedSec = 25;
          distMeters = Math.round(haversineMeters(prevLat, prevLong, curLat, curLong) * 10) / 10;
          speedKmh = Math.round(((distMeters / elapsedSec) * 3.6) * 10) / 10;

          if (speedKmh <= 120 && distMeters >= 15 && speedKmh >= 3.0) {
            status = "LIVE · MOVING";
            liveMovingCount++;
          } else {
            status = "LIVE · STOPPED";
            liveStoppedCount++;
          }
        } else {
          prevLat = curLat;
          prevLong = curLong;
          prevTime = now;
          distMeters = 0;
          speedKmh = 0;
          status = "LIVE · STOPPED";
          liveStoppedCount++;
        }
      }

      const movementState = status.includes("MOVING") ? "MOVING" : "STOPPED";

      const record = {
        vehicleNumber: vNo,
        vehicle_number: vNo,
        vehno: vNo,
        deviceId: devId,
        device_id: devId,
        devid: devId,
        routeNumber: routeNo,
        route_number: routeNo,
        route: routeNo,
        rno: routeNo,
        latitude: curLat,
        longitude: curLong,
        currentLatitude: curLat,
        currentLongitude: curLong,
        curlat: String(curLat),
        curlong: String(curLong),
        previousLatitude: prevLat,
        previousLongitude: prevLong,
        prelat: prevLat !== null ? String(prevLat) : String(curLat),
        prelong: prevLong !== null ? String(prevLong) : String(curLong),
        previousTimestamp: prevTime,
        previousTimestampIso: prevTime ? new Date(prevTime).toISOString() : null,
        currentTimestamp: now,
        telemetryTimestamp: new Date(now).toISOString(),
        telemetryAge: 0,
        distanceMoved: distMeters,
        calculatedSpeed: speedKmh,
        speed: speedKmh,
        movementState,
        movement_state: movementState,
        telemetryStatus: status,
        status,
        lastSeen: now,
      };

      this.vehicleStore.set(vNo, record);
    }

    // Check for stale vehicles (vehicles previously in store but absent from current response)
    let gpsStaleCount = 0;
    for (const [vNo, record] of this.vehicleStore.entries()) {
      if (!seenVehicleNumbers.has(vNo)) {
        const ageSec = Math.round((now - record.currentTimestamp) / 1000);
        record.telemetryAge = ageSec;

        if (ageSec > 60) {
          record.status = "GPS STALE";
          record.calculatedSpeed = 0;
          record.speed = 0;
          gpsStaleCount++;
        }

        // Expire vehicles completely missing for > 15 minutes
        if (ageSec > 900) {
          this.vehicleStore.delete(vNo);
        }
      }
    }

    this.latestSummary = {
      totalReceived: rawVehicles.length,
      validGps: validGpsCount,
      liveMoving: liveMovingCount,
      liveStopped: liveStoppedCount,
      gpsStale: gpsStaleCount,
      gpsInvalid: gpsInvalidCount,
      rejected: rejectedCount,
      lastUpdated: new Date(now).toISOString(),
    };

    return {
      summary: this.latestSummary,
      vehicles: this.getLiveVehicles(),
    };
  }

  /**
   * Returns list of vehicles from the store with updated telemetry ages
   */
  getLiveVehicles() {
    const now = Date.now();
    const result = [];
    for (const record of this.vehicleStore.values()) {
      const ageSec = Math.round((now - record.currentTimestamp) / 1000);
      result.push({
        ...record,
        telemetryAge: ageSec,
        status:
          record.status === "GPS INVALID"
            ? "GPS INVALID"
            : ageSec > 60
            ? "GPS STALE"
            : record.status,
      });
    }
    return result;
  }

  getSummary() {
    return this.latestSummary;
  }
}

const engineInstance = new TelemetryEngine();

module.exports = {
  TelemetryEngine,
  telemetryEngine: engineInstance,
  haversineMeters,
  isValidJaipurGps,
};

