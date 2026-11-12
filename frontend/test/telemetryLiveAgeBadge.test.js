import assert from "node:assert/strict";
import test from "node:test";
import { formatTelemetryAge } from "../src/telemetryAge.js";

test("telemetry age uses the actual timestamp instead of resetting to now", () => {
  const now = Date.parse("2026-11-11T12:00:00.000Z");
  assert.equal(
    formatTelemetryAge("2026-11-11T11:30:00.000Z", now),
    "30m ago"
  );
});

test("telemetry age reports unknown when there is no valid timestamp", () => {
  assert.equal(formatTelemetryAge("", Date.now()), "Update time unknown");
  assert.equal(formatTelemetryAge("not-a-time", Date.now()), "Update time unknown");
});

test("telemetry age clamps future timestamps and summarizes older data", () => {
  const now = Date.parse("2026-11-11T12:00:00.000Z");
  assert.equal(
    formatTelemetryAge("2026-11-11T12:01:00.000Z", now),
    "Just now"
  );
  assert.equal(
    formatTelemetryAge("2026-11-10T12:00:00.000Z", now),
    "1d ago"
  );
});
