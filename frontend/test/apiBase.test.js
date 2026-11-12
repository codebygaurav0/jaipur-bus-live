import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiBaseUrl } from "../src/apiBase.js";

test("local development uses same-origin API paths for the Vite proxy", () => {
  assert.equal(resolveApiBaseUrl("", true), "");
});

test("configured API base URLs are trimmed and normalized", () => {
  assert.equal(
    resolveApiBaseUrl(" https://api.example.test/// ", false),
    "https://api.example.test"
  );
});

test("production defaults to the deployed backend origin", () => {
  assert.equal(
    resolveApiBaseUrl("", false),
    "https://jaipur-bus-live-5nvg.vercel.app"
  );
});
