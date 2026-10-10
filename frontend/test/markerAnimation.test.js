import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBearingDegrees,
  createMarkerAnimator,
  getBusSpeedLabel,
  getBusStatus,
  getBusStatusClasses,
  smoothBearingDegrees,
} from "../src/markerAnimation.js";

function createFrameScheduler() {
  let nextId = 0;
  const frames = new Map();

  return {
    requestFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    advance(timestamp) {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(timestamp));
    },
    get pendingCount() {
      return frames.size;
    },
  };
}

function createMarker(latitude, longitude) {
  return {
    position: { lat: latitude, lng: longitude },
    getLatLng() {
      return this.position;
    },
    setLatLng([lat, lng]) {
      this.position = { lat, lng };
    },
  };
}

test("a new reading cancels and supersedes the previous marker animation", () => {
  const scheduler = createFrameScheduler();
  const animator = createMarkerAnimator({
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    durationMs: 1000,
  });
  const marker = createMarker(0, 0);

  animator.move("RJ14TEST01", marker, [10, 10]);
  scheduler.advance(0);
  scheduler.advance(500);
  assert.deepEqual(marker.getLatLng(), { lat: 5, lng: 5 });

  animator.move("RJ14TEST01", marker, [20, 20]);
  assert.equal(scheduler.pendingCount, 1);
  scheduler.advance(1000);
  scheduler.advance(1500);

  assert.deepEqual(marker.getLatLng(), { lat: 12.5, lng: 12.5 });
  scheduler.advance(2000);
  assert.deepEqual(marker.getLatLng(), { lat: 20, lng: 20 });
  assert.equal(animator.isAnimating("RJ14TEST01"), false);
});

test("separate vehicles keep independent animation state", () => {
  const scheduler = createFrameScheduler();
  const animator = createMarkerAnimator({
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    durationMs: 1000,
  });
  const first = createMarker(0, 0);
  const second = createMarker(10, 10);

  animator.move("RJ14TEST01", first, [2, 2]);
  animator.move("RJ14TEST02", second, [12, 12]);
  scheduler.advance(0);
  scheduler.advance(500);

  assert.deepEqual(first.getLatLng(), { lat: 1, lng: 1 });
  assert.deepEqual(second.getLatLng(), { lat: 11, lng: 11 });
  assert.equal(animator.isAnimating("RJ14TEST01"), true);
  assert.equal(animator.isAnimating("RJ14TEST02"), true);

  animator.cancelAll();
  assert.equal(scheduler.pendingCount, 0);
  assert.equal(animator.isAnimating("RJ14TEST01"), false);
  assert.equal(animator.isAnimating("RJ14TEST02"), false);
});

test("bearing and status presentation reflect supported GPS readings", () => {
  assert.equal(calculateBearingDegrees(0, 0, 0, 1), 90);
  assert.equal(smoothBearingDegrees(350, 10), 0);
  assert.equal(smoothBearingDegrees(null, 90), 90);
  assert.equal(getBusStatus({ status: "LIVE · MOVING" }), "LIVE · MOVING");
  assert.equal(
    getBusStatus({ status: "unrecognized" }),
    "GPS UPDATE UNAVAILABLE"
  );
  assert.equal(
    getBusStatusClasses("LIVE · STOPPED"),
    "bg-red-100 text-red-800"
  );
  assert.equal(getBusSpeedLabel({ status: "LIVE · SLOW" }), "Slow");
  assert.equal(getBusSpeedLabel({ status: "LIVE · IDLE" }), "Idle");
  assert.equal(getBusSpeedLabel({ status: "GPS STALE" }), "Speed unavailable");
  assert.equal(
    getBusSpeedLabel({ status: "LIVE · MOVING", speed: 0 }),
    "0 km/h"
  );
});

test("marker animation rejects invalid coordinates without moving the marker", () => {
  const scheduler = createFrameScheduler();
  const animator = createMarkerAnimator({
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
  });
  const marker = createMarker(26.9, 75.8);

  assert.throws(() => animator.move("RJ14TEST03", marker, [NaN, 75.9]), {
    name: "TypeError",
  });
  assert.deepEqual(marker.getLatLng(), { lat: 26.9, lng: 75.8 });
  assert.equal(scheduler.pendingCount, 0);
});
