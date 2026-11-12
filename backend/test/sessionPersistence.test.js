const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSessionManager, createSessionStore } = require("../sessionStore");

function createTemporaryStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-session-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return createSessionStore(path.join(directory, ".session.json"));
}

const testSession = {
  authToken: "unit-test-session-token",
  userId: "unit-test-user",
  user: { displayName: "must not be persisted" },
  response: { profile: "must not be persisted" },
};

test("session save writes only required fields with restrictive permissions", (t) => {
  const store = createTemporaryStore(t);
  store.save(testSession);

  const persisted = JSON.parse(fs.readFileSync(store.filePath, "utf8"));
  assert.deepEqual(persisted, {
    authToken: testSession.authToken,
    userId: testSession.userId,
  });
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(store.filePath).mode & 0o777, 0o600);
  }
});

test("session store restores a valid saved session", (t) => {
  const store = createTemporaryStore(t);
  store.save(testSession);

  assert.deepEqual(store.load(), {
    session: {
      authToken: testSession.authToken,
      userId: testSession.userId,
    },
    invalid: false,
  });
});

test("malformed or incomplete stored sessions are cleared", (t) => {
  const store = createTemporaryStore(t);
  fs.writeFileSync(store.filePath, JSON.stringify({ authToken: "incomplete" }));

  assert.deepEqual(store.load(), { session: null, invalid: true });
  assert.equal(fs.existsSync(store.filePath), false);
});

test("a JCTSL-rejected restored session returns AUTH_REQUIRED and is cleared", async (t) => {
  const store = createTemporaryStore(t);
  store.save(testSession);
  const manager = createSessionManager({
    store,
    verifySession: async () => ({
      success: false,
      rejected: true,
      errorCode: "AUTH_SESSION_EXPIRED",
    }),
  });

  assert.deepEqual(await manager.ensureRestoredSession(), {
    success: false,
    errorCode: "AUTH_REQUIRED",
  });
  assert.equal(manager.hasActiveSession(), false);
  assert.equal(store.load().session, null);
});

test("logout clears both active session state and the persisted session", (t) => {
  const store = createTemporaryStore(t);
  const manager = createSessionManager({
    store,
    verifySession: async () => ({ success: true }),
  });
  manager.saveVerifiedSession(testSession);

  manager.logout();

  assert.equal(manager.hasActiveSession(), false);
  assert.equal(store.load().session, null);
});

test("a fresh Node process restores and validates a previously saved session", (t) => {
  const store = createTemporaryStore(t);
  store.save(testSession);
  const script = [
    'const { createSessionManager, createSessionStore } = require("./sessionStore");',
    'const store = createSessionStore(process.env.JCTSL_SESSION_FILE);',
    'const manager = createSessionManager({ store, verifySession: async () => ({ success: true }) });',
    'manager.ensureRestoredSession().then(result => {',
    '  if (!result.success || !manager.hasActiveSession()) process.exitCode = 1;',
    '  else process.stdout.write("restored-and-verified");',
    '}).catch(() => { process.exitCode = 1; });',
  ].join("\n");
  const child = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, JCTSL_SESSION_FILE: store.filePath },
  });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "restored-and-verified");
});

test("a temporary provider validation failure retains the session without authenticating it", async (t) => {
  const store = createTemporaryStore(t);
  store.save(testSession);
  const manager = createSessionManager({
    store,
    verifySession: async () => ({
      success: false,
      errorCode: "NON_JSON_RESPONSE",
    }),
  });

  assert.deepEqual(await manager.ensureRestoredSession(), {
    success: false,
    errorCode: "NON_JSON_RESPONSE",
  });
  assert.equal(manager.hasActiveSession(), false);
  assert.ok(store.load().session);
});
