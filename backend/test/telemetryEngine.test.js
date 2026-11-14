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

test("a successful empty vehicle response clears old markers and reports a genuine zero", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });
  engine.processTelemetry([reading("RJ14TEST10", 26.9, 75.81)]);
  clock.advance(25_000);

  const empty = engine.processTelemetry([]);
  assert.deepEqual(empty.vehicles, []);
  assert.equal(empty.summary.totalReceived, 0);
  assert.equal(empty.summary.lastUpdated, new Date(clock.now()).toISOString());
  assert.deepEqual(engine.getLiveVehicles(), []);
});

test("snapshot stores telemetry vehicles and observations with schema version", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });

  engine.processTelemetry([reading("RJ14REDIS01", 26.9, 75.81)]);
  const snapshot = engine.createSnapshot();

  assert.equal(snapshot.schemaVersion, 1);
  assert.ok(Array.isArray(snapshot.vehicles));
  assert.ok(Array.isArray(snapshot.observations));
  assert.equal(snapshot.vehicles.length, 1);
  assert.equal(snapshot.observations.length, 1);
  assert.equal(snapshot.savedAt, clock.now());
});

test("restoring snapshot preserves original GPS timestamps", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });

  engine.processTelemetry([reading("RJ14REDIS02", 26.9, 75.81)]);
  clock.advance(60_000);
  engine.processTelemetry([reading("RJ14REDIS02", 26.901, 75.81)]);

  const snapshot = engine.createSnapshot();
  const restoredEngine = new TelemetryEngine({ now: clock.now });

  assert.equal(restoredEngine.restoreSnapshot(snapshot), true);

  const restoredBus = oneVehicle(
    { vehicles: restoredEngine.getLiveVehicles() },
    "RJ14REDIS02"
  );

  assert.ok(restoredBus);
  assert.equal(restoredBus.currentTimestamp, 1_800_000_060_000);
  assert.equal(restoredBus.previousTimestamp, 1_800_000_000_000);
});

test("restored old GPS observation does not create fake speed after maximum observation gap", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });

  engine.processTelemetry([reading("RJ14REDIS03", 26.9, 75.81)]);
  const snapshot = engine.createSnapshot();

  clock.advance(130_000);

  const restoredEngine = new TelemetryEngine({ now: clock.now });
  assert.equal(restoredEngine.restoreSnapshot(snapshot), true);

  clock.advance(25_000);
  const result = restoredEngine.processTelemetry([
    reading("RJ14REDIS03", 26.901, 75.81),
  ]);

  const bus = oneVehicle(result, "RJ14REDIS03");
  assert.ok(bus);
  assert.equal(bus.speed, null);
  assert.equal(bus.previousTimestamp, null);
  assert.equal(bus.status, "LIVE · IDLE");
});

test("restore rejects snapshots with a future savedAt timestamp", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });

  engine.processTelemetry([reading("RJ14REDIS05", 26.9, 75.81)]);
  const snapshot = engine.createSnapshot();
  snapshot.savedAt += 1;

  const restoredEngine = new TelemetryEngine({ now: clock.now });
  assert.equal(restoredEngine.restoreSnapshot(snapshot), false);
});

test("restore rejects observations newer than their vehicle timestamp", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });

  engine.processTelemetry([reading("RJ14REDIS06", 26.9, 75.81)]);
  const snapshot = engine.createSnapshot();
  snapshot.observations[0][1].observedAt += 1;

  const restoredEngine = new TelemetryEngine({ now: clock.now });
  assert.equal(restoredEngine.restoreSnapshot(snapshot), true);
  assert.equal(restoredEngine.observationStore.has("RJ14REDIS06"), false);
});

test("restore rejects stationarySince later than observedAt", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });

  engine.processTelemetry([reading("RJ14REDIS07", 26.9, 75.81)]);
  const snapshot = engine.createSnapshot();
  snapshot.observations[0][1].stationarySince =
    snapshot.observations[0][1].observedAt + 1;

  const restoredEngine = new TelemetryEngine({ now: clock.now });
  assert.equal(restoredEngine.restoreSnapshot(snapshot), true);
  assert.equal(restoredEngine.observationStore.has("RJ14REDIS07"), false);
});

test("restore discards telemetry records older than fifteen minutes", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });

  engine.processTelemetry([reading("RJ14REDIS04", 26.9, 75.81)]);
  const snapshot = engine.createSnapshot();

  clock.advance(900_001);

  const restoredEngine = new TelemetryEngine({ now: clock.now });
  assert.equal(restoredEngine.restoreSnapshot(snapshot), true);
  assert.deepEqual(restoredEngine.getLiveVehicles(), []);
});


test("restore does not overwrite fresher in-memory telemetry", () => {
  const clock = createClock();
  const engine = new TelemetryEngine({ now: clock.now });

  engine.processTelemetry([reading("RJ14REDIS05", 26.9, 75.81)]);
  const snapshot = engine.createSnapshot();

  clock.advance(30_000);
  const activeEngine = new TelemetryEngine({ now: clock.now });
  activeEngine.processTelemetry([reading("RJ14REDIS05", 26.905, 75.815)]);

  // The active engine has fresher in-memory telemetry than snapshot.savedAt
  assert.equal(activeEngine.restoreSnapshot(snapshot), false);
});
