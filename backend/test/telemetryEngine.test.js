const assert = require("node:assert/strict");
const test = require("node:test");
const { TelemetryEngine, haversineMeters } = require("../telemetryEngine");

function createClock(start = 1_800_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (milliseconds) => {
      current += milliseconds;
    },
  };
}

function reading(vehicleNumber, latitude, longitude, extra = {}) {
  return {
    vehno: vehicleNumber,
    curlat: String(latitude),
    curlong: String(longitude),
    ...extra,
  };
}

function oneVehicle(result, vehicleNumber) {
  return result.vehicles.find((vehicle) => vehicle.vehicleNumber === vehicleNumber);
}

test("valid consecutive GPS observations produce distance and speed from elapsed time", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });
  engine.processTelemetry([reading("RJ14TEST01", 26.9, 75.81)]);
  clock.advance(60_000);

  const result = engine.processTelemetry([reading("RJ14TEST01", 26.901, 75.81)]);
  const bus = oneVehicle(result, "RJ14TEST01");

  assert.ok(bus.distanceMoved > 100);
  assert.ok(bus.speed > 3);
  assert.equal(bus.status, "LIVE · MOVING");
  assert.equal(bus.previousTimestamp, 1_800_000_000_000);
  assert.equal(
    Math.round(bus.distanceMoved),
    Math.round(haversineMeters(26.9, 75.81, 26.901, 75.81))
  );
});

test("identical coordinates do not create movement and need repeated observations to confirm stopped", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });
  const sample = reading("RJ14TEST02", 26.9, 75.81);

  const first = engine.processTelemetry([sample]);
  assert.equal(oneVehicle(first, "RJ14TEST02").status, "LIVE · IDLE");
  assert.equal(oneVehicle(first, "RJ14TEST02").speed, null);

  clock.advance(25_000);
  const second = engine.processTelemetry([sample]);
  assert.equal(oneVehicle(second, "RJ14TEST02").status, "LIVE · IDLE");
  assert.equal(oneVehicle(second, "RJ14TEST02").speed, null);

  clock.advance(25_000);
  const third = engine.processTelemetry([sample]);
  assert.equal(oneVehicle(third, "RJ14TEST02").status, "LIVE · STOPPED");
  assert.equal(oneVehicle(third, "RJ14TEST02").speed, 0);
});

test("a moving bus transitions to slow when a later real displacement is slow", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });
  engine.processTelemetry([reading("RJ14TEST03", 26.9, 75.81)]);

  clock.advance(60_000);
  const moving = engine.processTelemetry([
    reading("RJ14TEST03", 26.901, 75.81),
  ]);
  assert.equal(oneVehicle(moving, "RJ14TEST03").status, "LIVE · MOVING");

  clock.advance(25_000);
  const slow = engine.processTelemetry([
    reading("RJ14TEST03", 26.90108, 75.81),
  ]);
  assert.equal(oneVehicle(slow, "RJ14TEST03").status, "LIVE · SLOW");
  assert.ok(oneVehicle(slow, "RJ14TEST03").speed > 0);
});

test("repeated fresh stationary readings transition to stopped after confirmation interval", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });
  const sample = reading("RJ14TEST04", 26.9, 75.81);

  engine.processTelemetry([sample]);
  clock.advance(25_000);
  assert.equal(
    oneVehicle(engine.processTelemetry([sample]), "RJ14TEST04").status,
    "LIVE · IDLE"
  );
  clock.advance(25_000);
  assert.equal(
    oneVehicle(engine.processTelemetry([sample]), "RJ14TEST04").status,
    "LIVE · STOPPED"
  );
});

test("stale telemetry is never represented as a fresh stopped bus", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });
  engine.processTelemetry([reading("RJ14TEST05", 26.9, 75.81)]);

  clock.advance(60_001);
  const bus = oneVehicle({ vehicles: engine.getLiveVehicles() }, "RJ14TEST05");

  assert.equal(bus.status, "GPS STALE");
  assert.equal(bus.movementState, "GPS_STALE");
  assert.equal(bus.speed, null);
});

test("invalid GPS coordinates are marked invalid and never receive speed", () => {
  const engine = new TelemetryEngine();
  const result = engine.processTelemetry([
    reading("RJ14TEST06", 91, 75.81),
  ]);
  const bus = oneVehicle(result, "RJ14TEST06");

  assert.equal(bus.status, "GPS INVALID");
  assert.equal(bus.speed, null);
  assert.equal(result.summary.gpsInvalid, 1);
});

test("implausible GPS jumps are uncertain and do not produce speed", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });
  engine.processTelemetry([reading("RJ14TEST07", 26.9, 75.81)]);
  clock.advance(25_000);

  const result = engine.processTelemetry([
    reading("RJ14TEST07", 26.95, 75.81),
  ]);
  const bus = oneVehicle(result, "RJ14TEST07");

  assert.equal(bus.status, "GPS UNCERTAIN");
  assert.equal(bus.speed, null);
  assert.equal(bus.distanceMoved, null);
});

test("missing or invalid upstream timestamps never fabricate a 25-second speed", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });
  const first = reading("RJ14TEST08", 26.9, 75.81, {
    prelat: "26.899",
    prelong: "75.81",
    timestamp: "not-a-timestamp",
  });

  const initial = engine.processTelemetry([first]);
  assert.equal(oneVehicle(initial, "RJ14TEST08").speed, null);
  assert.equal(oneVehicle(initial, "RJ14TEST08").status, "LIVE · IDLE");

  clock.advance(60_000);
  const next = engine.processTelemetry([
    reading("RJ14TEST08", 26.901, 75.81, { timestamp: "invalid" }),
  ]);
  assert.equal(oneVehicle(next, "RJ14TEST08").speed, 6.7);
});

test("first observation without trustworthy history is not presented as confirmed movement or stop", () => {
  const engine = new TelemetryEngine();
  const result = engine.processTelemetry([
    reading("RJ14TEST09", 26.9004, 75.813, {
      prelat: "26.9000",
      prelong: "75.8130",
    }),
  ]);
  const bus = oneVehicle(result, "RJ14TEST09");

  assert.equal(bus.status, "LIVE · IDLE");
  assert.equal(bus.speed, null);
  assert.equal(bus.previousLatitude, null);
  assert.equal(bus.previousTimestamp, null);
});
