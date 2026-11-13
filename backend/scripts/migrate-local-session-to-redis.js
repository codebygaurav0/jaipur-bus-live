const fs = require("node:fs/promises");
const path = require("node:path");
const {
  createRedisSessionStore,
  normalizeSession,
} = require("../sessionStore");

const DEFAULT_SESSION_FILE = path.join(__dirname, "..", ".session.json");

async function readLocalSession(sessionFile) {
  let contents;
  try {
    contents = await fs.readFile(sessionFile, "utf8");
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }

  return normalizeSession(parsed);
}

async function runMigration({
  env = process.env,
  sessionFile = DEFAULT_SESSION_FILE,
  fetchImpl = globalThis.fetch,
  dryRun = false,
  write = console.log,
} = {}) {
  const session = await readLocalSession(sessionFile);
  write(`LOCAL_SESSION_VALID=${session ? "true" : "false"}`);
  if (!session) return false;

  let store;
  try {
    store = createRedisSessionStore({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
      fetchImpl,
    });
  } catch {
    write("REDIS_CONFIG_VALID=false");
    return false;
  }

  write("REDIS_CONFIG_VALID=true");
  if (dryRun) return true;

  try {
    await store.save(session);
    write("REDIS_WRITE_SUCCESS=true");
  } catch {
    write("REDIS_WRITE_SUCCESS=false");
    return false;
  }

  try {
    const loaded = await store.load();
    const matches =
      loaded.session?.authToken === session.authToken &&
      loaded.session?.userId === session.userId;
    write(`REDIS_READBACK_MATCH=${matches ? "true" : "false"}`);
    return matches;
  } catch {
    write("REDIS_READBACK_MATCH=false");
    return false;
  }
}

async function main(argv = process.argv.slice(2)) {
  const unknownArguments = argv.filter((argument) => argument !== "--dry-run");
  if (unknownArguments.length > 0) {
    console.log("MIGRATION_SUCCESS=false");
    process.exitCode = 1;
    return;
  }

  const success = await runMigration({ dryRun: argv.includes("--dry-run") });
  console.log(`MIGRATION_SUCCESS=${success ? "true" : "false"}`);
  if (!success) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(() => {
    console.log("MIGRATION_SUCCESS=false");
    process.exitCode = 1;
  });
}

module.exports = { runMigration };
