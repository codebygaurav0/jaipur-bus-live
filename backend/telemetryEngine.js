// Stale after 60s; stopped needs two repeated samples spanning 30s; reject >120 km/h and gaps over 120s.
const TELEMETRY_THRESHOLDS = Object.freeze({
  staleAfterMs: 60_000,
  stationaryConfirmationMs: 30_000,
  stationaryConfirmationReadings: 2,
  stationaryDistanceMeters: 5,
  slowDistanceMeters: 5,
  movingDistanceMeters: 15,
  movingSpeedKmh: 3,
  maxSpeedKmh: 120,
  maxObservationGapMs: 120_000,
  expireAfterMs: 900_000,
});

function haversineMeters(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (!values.every(Number.isFinite)) return null;

  const [latitude1, longitude1, latitude2, longitude2] = values;
  const radiusMeters = 6_371_000;
  const latitudeDelta = ((latitude2 - latitude1) * Math.PI) / 180;
  const longitudeDelta = ((longitude2 - longitude1) * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos((latitude1 * Math.PI) / 180) *
      Math.cos((latitude2 * Math.PI) / 180) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 *
    radiusMeters *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function parseCoordinate(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function firstCoordinate(raw, names) {
  for (const name of names) {
    if (raw[name] !== undefined && raw[name] !== null && raw[name] !== "") {
      return parseCoordinate(raw[name]);
    }
  }
  return null;
}

function isValidJaipurGps(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude === 0 || longitude === 0) return false;
  return (
    latitude >= 25 &&
    latitude <= 29 &&
    longitude >= 74 &&
    longitude <= 78
  );
}

function stateForStatus(status) {
  if (status === "LIVE · MOVING") return "MOVING";
  if (status === "LIVE · SLOW") return "SLOW";
  if (status === "LIVE · STOPPED") return "STOPPED";
  if (status === "GPS STALE") return "GPS_STALE";
  if (status === "GPS INVALID") return "GPS_INVALID";
  if (status === "GPS UNCERTAIN") return "GPS_UNCERTAIN";
  return "IDLE";
}

class TelemetryEngine {
  constructor({ now = Date.now, thresholds = {} } = {}) {
    this.now = now;
    this.thresholds = { ...TELEMETRY_THRESHOLDS, ...thresholds };
    this.vehicleStore = new Map();
    this.observationStore = new Map();
    this.latestSummary = {
      totalReceived: 0,
      validGps: 0,
      liveMoving: 0,
      liveSlow: 0,
      liveIdle: 0,
      liveStopped: 0,
      gpsStale: 0,
      gpsInvalid: 0,
      rejected: 0,
      lastUpdated: null,
    };
  }

  processTelemetry(rawVehicles) {
    if (!Array.isArray(rawVehicles)) {
      return {
        summary: this.latestSummary,
        vehicles: this.getLiveVehicles(),
      };
    }

    const observedAt = this.now();
    if (!Number.isFinite(observedAt)) {
      throw new Error("Telemetry observation clock returned an invalid timestamp");
    }

    const seenVehicleNumbers = new Set();
    let validGpsCount = 0;
    let liveMovingCount = 0;
    let liveSlowCount = 0;
    let liveIdleCount = 0;
    let liveStoppedCount = 0;
    let gpsInvalidCount = 0;
    let rejectedCount = 0;

    for (const raw of rawVehicles) {
      if (!raw || typeof raw !== "object") {
        rejectedCount++;
        continue;
      }

      const vehicleNumber = String(
        raw.vehno || raw.vehicle_number || raw.vehicel_no || ""
      )
        .trim()
        .toUpperCase();
      if (!vehicleNumber || seenVehicleNumbers.has(vehicleNumber)) {
        rejectedCount++;
        continue;
      }
      seenVehicleNumbers.add(vehicleNumber);

      const deviceId = String(raw.devid || raw.device_id || "").trim();
      const routeNumber = String(
        raw.rno || raw.route_no || raw.route_number || ""
      ).trim();
      const latitude = firstCoordinate(raw, [
        "curlat",
        "currentLatitude",
        "latitude",
      ]);
      const longitude = firstCoordinate(raw, [
        "curlong",
        "currentLongitude",
        "longitude",
      ]);

      if (!isValidJaipurGps(latitude, longitude)) {
        gpsInvalidCount++;
        this.vehicleStore.set(vehicleNumber, {
          vehicleNumber,
          vehicle_number: vehicleNumber,
          vehno: vehicleNumber,
          deviceId,
          device_id: deviceId,
          devid: deviceId,
          routeNumber,
          route_number: routeNumber,
          route: routeNumber,
          rno: routeNumber,
          latitude,
          longitude,
          currentLatitude: latitude,
          currentLongitude: longitude,
          curlat: raw.curlat ?? null,
          curlong: raw.curlong ?? null,
          previousLatitude: null,
          previousLongitude: null,
          prelat: null,
          prelong: null,
          previousTimestamp: null,
          previousTimestampIso: null,
          currentTimestamp: observedAt,
          telemetryTimestamp: new Date(observedAt).toISOString(),
          telemetryAge: 0,
          distanceMoved: null,
          calculatedSpeed: null,
          speed: null,
          movementState: "GPS_INVALID",
          movement_state: "GPS_INVALID",
          telemetryStatus: "GPS INVALID",
          status: "GPS INVALID",
          lastSeen: observedAt,
        });
        continue;
      }

      validGpsCount++;
      const previous = this.observationStore.get(vehicleNumber);
      const elapsedMs = previous ? observedAt - previous.observedAt : null;
      const usablePrevious =
        previous &&
        elapsedMs > 0 &&
        elapsedMs <= this.thresholds.maxObservationGapMs;
      const previousLatitude = usablePrevious ? previous.latitude : null;
      const previousLongitude = usablePrevious ? previous.longitude : null;
      const previousTimestamp = usablePrevious ? previous.observedAt : null;

      let distanceMoved = null;
      let speedKmh = null;
      let status = "LIVE · IDLE";
      let stationarySince = null;
      let stationaryReadings = 0;

      if (usablePrevious) {
        distanceMoved = haversineMeters(
          previousLatitude,
          previousLongitude,
          latitude,
          longitude
        );
        speedKmh = (distanceMoved / (elapsedMs / 1000)) * 3.6;

        if (speedKmh > this.thresholds.maxSpeedKmh) {
          distanceMoved = null;
          speedKmh = null;
          status = "GPS UNCERTAIN";
        } else if (
          distanceMoved <= this.thresholds.stationaryDistanceMeters
        ) {
          stationarySince = previous.stationarySince ?? previous.observedAt;
          stationaryReadings = previous.stationaryReadings + 1;
          if (
            stationaryReadings >=
              this.thresholds.stationaryConfirmationReadings &&
            observedAt - stationarySince >=
              this.thresholds.stationaryConfirmationMs
          ) {
            status = "LIVE · STOPPED";
            speedKmh = 0;
          } else {
            status = "LIVE · IDLE";
            speedKmh = null;
          }
        } else if (
          distanceMoved >= this.thresholds.movingDistanceMeters &&
          speedKmh >= this.thresholds.movingSpeedKmh
        ) {
          status = "LIVE · MOVING";
        } else if (distanceMoved >= this.thresholds.slowDistanceMeters) {
          status = "LIVE · SLOW";
        } else {
          status = "LIVE · IDLE";
          speedKmh = null;
        }
      } else {
        distanceMoved = null;
        speedKmh = null;
      }

      if (status === "LIVE · MOVING" || status === "LIVE · SLOW") {
        stationarySince = null;
        stationaryReadings = 0;
      } else if (status === "GPS UNCERTAIN") {
        stationarySince = null;
        stationaryReadings = 0;
      } else if (!usablePrevious) {
        stationarySince = null;
        stationaryReadings = 0;
      }

      this.observationStore.set(vehicleNumber, {
        latitude,
        longitude,
        observedAt,
        stationarySince,
        stationaryReadings,
      });

      const state = stateForStatus(status);
      const record = {
        vehicleNumber,
        vehicle_number: vehicleNumber,
        vehno: vehicleNumber,
        deviceId,
        device_id: deviceId,
        devid: deviceId,
        routeNumber,
        route_number: routeNumber,
        route: routeNumber,
        rno: routeNumber,
        latitude,
        longitude,
        currentLatitude: latitude,
        currentLongitude: longitude,
        curlat: String(latitude),
        curlong: String(longitude),
        previousLatitude,
        previousLongitude,
        prelat:
          previousLatitude === null ? null : String(previousLatitude),
        prelong:
          previousLongitude === null ? null : String(previousLongitude),
        previousTimestamp,
        previousTimestampIso:
          previousTimestamp === null
            ? null
            : new Date(previousTimestamp).toISOString(),
        currentTimestamp: observedAt,
        telemetryTimestamp: new Date(observedAt).toISOString(),
        telemetryAge: 0,
        distanceMoved:
          distanceMoved === null ? null : Math.round(distanceMoved * 10) / 10,
        calculatedSpeed:
          speedKmh === null ? null : Math.round(speedKmh * 10) / 10,
        speed: speedKmh === null ? null : Math.round(speedKmh * 10) / 10,
        movementState: state,
        movement_state: state,
        telemetryStatus: status,
        status,
        lastSeen: observedAt,
      };
      this.vehicleStore.set(vehicleNumber, record);

      if (status === "LIVE · MOVING") liveMovingCount++;
      else if (status === "LIVE · SLOW") liveSlowCount++;
      else if (status === "LIVE · STOPPED") liveStoppedCount++;
      else if (status === "LIVE · IDLE") liveIdleCount++;
    }

    let gpsStaleCount = 0;
    for (const [vehicleNumber, record] of this.vehicleStore.entries()) {
      if (seenVehicleNumbers.has(vehicleNumber)) continue;

      const ageMs = observedAt - record.currentTimestamp;
      record.telemetryAge = Math.max(0, Math.floor(ageMs / 1000));
      if (ageMs > this.thresholds.staleAfterMs) {
        record.status =
          record.status === "GPS INVALID" ? "GPS INVALID" : "GPS STALE";
        record.telemetryStatus = record.status;
        record.movementState = stateForStatus(record.status);
        record.movement_state = record.movementState;
        record.calculatedSpeed = null;
        record.speed = null;
        if (record.status === "GPS STALE") gpsStaleCount++;
      }
      if (ageMs > this.thresholds.expireAfterMs) {
        this.vehicleStore.delete(vehicleNumber);
        this.observationStore.delete(vehicleNumber);
      }
    }

    this.latestSummary = {
      totalReceived: rawVehicles.length,
      validGps: validGpsCount,
      liveMoving: liveMovingCount,
      liveSlow: liveSlowCount,
      liveIdle: liveIdleCount,
      liveStopped: liveStoppedCount,
      gpsStale: gpsStaleCount,
      gpsInvalid: gpsInvalidCount,
      rejected: rejectedCount,
      lastUpdated: new Date(observedAt).toISOString(),
    };

    return {
      summary: this.latestSummary,
      vehicles: this.getLiveVehicles(),
    };
  }

  getLiveVehicles() {
    const now = this.now();
    if (!Number.isFinite(now)) {
      throw new Error("Telemetry observation clock returned an invalid timestamp");
    }
    const vehicles = [];

    for (const record of this.vehicleStore.values()) {
      const ageMs = Math.max(0, now - record.currentTimestamp);
      const telemetryAge = Math.floor(ageMs / 1000);
      const isStale =
        record.status !== "GPS INVALID" &&
        ageMs > this.thresholds.staleAfterMs;
      const status = isStale ? "GPS STALE" : record.status;
      const movementState = stateForStatus(status);

      vehicles.push({
        ...record,
        telemetryAge,
        status,
        telemetryStatus: status,
        movementState,
        movement_state: movementState,
        ...(isStale ? { calculatedSpeed: null, speed: null } : {}),
      });
    }
    return vehicles;
  }

  getSummary() {
    return this.latestSummary;
  }
}

const engineInstance = new TelemetryEngine();

module.exports = {
  TelemetryEngine,
  telemetryEngine: engineInstance,
  TELEMETRY_THRESHOLDS,
  haversineMeters,
  isValidJaipurGps,
};
