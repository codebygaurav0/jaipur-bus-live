const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const path = require("node:path");

process.env.JCTSL_AUTH_TOKEN = "test-configured-auth-token";
process.env.JCTSL_USER_ID = "test-configured-user-id";
process.env.JCTSL_SESSION_FILE = path.join(
  os.tmpdir(),
  `jbl-auth-header-precedence-${process.pid}.json`
);

const { ensureAuthHeaders } = require("../server");

test("active server session credentials take precedence over request headers", async () => {
  const headers = await ensureAuthHeaders({
    headers: {
      "auth-token": "untrusted-request-token",
      "user-id": "untrusted-request-user",
    },
  });

  assert.equal(headers["Auth-token"], "test-configured-auth-token");
  assert.equal(headers["User-ID"], "test-configured-user-id");
});

test("server session credentials are selected as a pair", async () => {
  const headers = await ensureAuthHeaders({
    headers: {
      "auth-token": "untrusted-request-token",
    },
  });

  assert.equal(headers["Auth-token"], "test-configured-auth-token");
  assert.equal(headers["User-ID"], "test-configured-user-id");
});
