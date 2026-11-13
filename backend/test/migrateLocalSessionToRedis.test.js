const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runMigration } = require("../scripts/migrate-local-session-to-redis");

const testEnv = {
  UPSTASH_REDIS_REST_URL: "https://redis.example.test",
  UPSTASH_REDIS_REST_TOKEN: "mock-redis-token",
};
const testSession = {
  authToken: "mock-auth-token",
  userId: "mock-user-id",
};

async function createSessionFile(contents) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jbl-session-migration-"));
  const sessionFile = path.join(directory, ".session.json");
  await fs.writeFile(sessionFile, contents, "utf8");
  return {
    sessionFile,
    cleanup: () => fs.rm(directory, { recursive: true, force: true }),
  };
}

function createMockRedis({ readbackOverride } = {}) {
  const records = new Map();
  const commands = [];
  const fetchImpl = async (_url, options) => {
    const command = JSON.parse(options.body);
    commands.push(command);
    let result = null;
    if (command[0] === "SET") {
      records.set(command[1], command[2]);
      result = "OK";
    } else if (command[0] === "GET") {
      result = readbackOverride ?? records.get(command[1]) ?? null;
    }
    return {
      ok: true,
      json: async () => ({ result }),
    };
  };
  return { commands, fetchImpl };
}

test("dry run validates local session and Redis configuration without Redis requests", async () => {
  const file = await createSessionFile(JSON.stringify(testSession));
  const redis = createMockRedis();
  const output = [];
  try {
    const success = await runMigration({
      env: testEnv,
      sessionFile: file.sessionFile,
      fetchImpl: redis.fetchImpl,
      dryRun: true,
      write: (line) => output.push(line),
    });

    assert.equal(success, true);
    assert.deepEqual(output, [
      "LOCAL_SESSION_VALID=true",
      "REDIS_CONFIG_VALID=true",
    ]);
    assert.deepEqual(redis.commands, []);
  } finally {
    await file.cleanup();
  }
});

test("migration writes through Redis store and verifies read-back", async () => {
  const file = await createSessionFile(JSON.stringify(testSession));
  const redis = createMockRedis();
  const output = [];
  const originalContents = JSON.stringify(testSession);
  try {
    const success = await runMigration({
      env: testEnv,
      sessionFile: file.sessionFile,
      fetchImpl: redis.fetchImpl,
      write: (line) => output.push(line),
    });

    assert.equal(success, true);
    assert.deepEqual(output, [
      "LOCAL_SESSION_VALID=true",
      "REDIS_CONFIG_VALID=true",
      "REDIS_WRITE_SUCCESS=true",
      "REDIS_READBACK_MATCH=true",
    ]);
    assert.deepEqual(redis.commands.map(([command]) => command), ["SET", "GET"]);
    assert.equal(redis.commands[0][1], "jbl:jctsl:session");
    assert.deepEqual(JSON.parse(redis.commands[0][2]), testSession);
    assert.equal(await fs.readFile(file.sessionFile, "utf8"), originalContents);
    assert.equal(JSON.stringify(output).includes(testSession.authToken), false);
    assert.equal(JSON.stringify(output).includes(testSession.userId), false);
    assert.equal(JSON.stringify(output).includes(testEnv.UPSTASH_REDIS_REST_TOKEN), false);
  } finally {
    await file.cleanup();
  }
});

test("invalid local session fails without contacting Redis or changing the file", async () => {
  const contents = JSON.stringify({ authToken: "", userId: testSession.userId });
  const file = await createSessionFile(contents);
  const redis = createMockRedis();
  const output = [];
  try {
    const success = await runMigration({
      env: testEnv,
      sessionFile: file.sessionFile,
      fetchImpl: redis.fetchImpl,
      write: (line) => output.push(line),
    });

    assert.equal(success, false);
    assert.deepEqual(output, ["LOCAL_SESSION_VALID=false"]);
    assert.deepEqual(redis.commands, []);
    assert.equal(await fs.readFile(file.sessionFile, "utf8"), contents);
  } finally {
    await file.cleanup();
  }
});

test("invalid Redis configuration fails without making a Redis request", async () => {
  const file = await createSessionFile(JSON.stringify(testSession));
  const redis = createMockRedis();
  const output = [];
  try {
    const success = await runMigration({
      env: {},
      sessionFile: file.sessionFile,
      fetchImpl: redis.fetchImpl,
      write: (line) => output.push(line),
    });

    assert.equal(success, false);
    assert.deepEqual(output, [
      "LOCAL_SESSION_VALID=true",
      "REDIS_CONFIG_VALID=false",
    ]);
    assert.deepEqual(redis.commands, []);
  } finally {
    await file.cleanup();
  }
});

test("Redis write failure fails safely without exposing provider response", async () => {
  const file = await createSessionFile(JSON.stringify(testSession));
  const output = [];
  try {
    const success = await runMigration({
      env: testEnv,
      sessionFile: file.sessionFile,
      fetchImpl: async () => ({
        ok: false,
        json: async () => ({ error: "private mock response" }),
      }),
      write: (line) => output.push(line),
    });

    assert.equal(success, false);
    assert.deepEqual(output, [
      "LOCAL_SESSION_VALID=true",
      "REDIS_CONFIG_VALID=true",
      "REDIS_WRITE_SUCCESS=false",
    ]);
    assert.equal(JSON.stringify(output).includes("private mock response"), false);
  } finally {
    await file.cleanup();
  }
});

test("Redis read-back failure fails without exposing provider response", async () => {
  const file = await createSessionFile(JSON.stringify(testSession));
  const commands = [];
  const output = [];
  try {
    const success = await runMigration({
      env: testEnv,
      sessionFile: file.sessionFile,
      fetchImpl: async (_url, options) => {
        const command = JSON.parse(options.body);
        commands.push(command[0]);
        if (command[0] === "SET") {
          return { ok: true, json: async () => ({ result: "OK" }) };
        }
        return {
          ok: false,
          json: async () => ({ error: "private mock response" }),
        };
      },
      write: (line) => output.push(line),
    });

    assert.equal(success, false);
    assert.deepEqual(commands, ["SET", "GET"]);
    assert.deepEqual(output, [
      "LOCAL_SESSION_VALID=true",
      "REDIS_CONFIG_VALID=true",
      "REDIS_WRITE_SUCCESS=true",
      "REDIS_READBACK_MATCH=false",
    ]);
    assert.equal(JSON.stringify(output).includes("private mock response"), false);
  } finally {
    await file.cleanup();
  }
});

test("read-back mismatch fails without printing session values", async () => {
  const file = await createSessionFile(JSON.stringify(testSession));
  const redis = createMockRedis({
    readbackOverride: JSON.stringify({
      authToken: "different-mock-token",
      userId: testSession.userId,
    }),
  });
  const output = [];
  try {
    const success = await runMigration({
      env: testEnv,
      sessionFile: file.sessionFile,
      fetchImpl: redis.fetchImpl,
      write: (line) => output.push(line),
    });

    assert.equal(success, false);
    assert.deepEqual(output, [
      "LOCAL_SESSION_VALID=true",
      "REDIS_CONFIG_VALID=true",
      "REDIS_WRITE_SUCCESS=true",
      "REDIS_READBACK_MATCH=false",
    ]);
    assert.equal(JSON.stringify(output).includes(testSession.authToken), false);
    assert.equal(JSON.stringify(output).includes(testSession.userId), false);
  } finally {
    await file.cleanup();
  }
});
