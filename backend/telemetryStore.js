const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

function createMemoryTelemetryStore() {
  let snapshot = null;

  return {
    async load() {
      return snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
    },
    async save(value) {
      snapshot = JSON.parse(JSON.stringify(value));
    },
    async clear() {
      snapshot = null;
    },
  };
}

function createRedisTelemetryStore({
  url,
  token,
  fetchImpl = globalThis.fetch,
  key = "jbl:telemetry:snapshot",
}) {
  if (typeof url !== "string" || typeof token !== "string" ||
      !url.trim() || !token.trim() || typeof fetchImpl !== "function") {
    throw new Error("Invalid telemetry Redis configuration");
  }

  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error("Invalid telemetry Redis URL");
  }

  if (endpoint.protocol !== "https:") {
    throw new Error("Telemetry Redis URL must use HTTPS");
  }

  const redisUrl = endpoint.toString().replace(/\/$/, "");

  async function command(parts, failureCode) {
    let response;
    try {
      response = await fetchImpl(redisUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parts),
      });
    } catch {
      const error = new Error("Telemetry storage is unavailable");
      error.code = failureCode;
      throw error;
    }

    if (!response?.ok) {
      const error = new Error("Telemetry storage request failed");
      error.code = failureCode;
      throw error;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      const error = new Error("Invalid telemetry storage response");
      error.code = failureCode;
      throw error;
    }

    if (!payload || payload.error || !Object.hasOwn(payload, "result")) {
      const error = new Error("Telemetry storage request failed");
      error.code = failureCode;
      throw error;
    }

    return payload.result;
  }

  return {
    async load() {
      const value = await command(["GET", key], "TELEMETRY_STORE_READ_FAILED");
      if (value === null) return null;

      if (typeof value !== "string" || value.length > MAX_SNAPSHOT_BYTES) {
        const error = new Error("Invalid stored telemetry snapshot");
        error.code = "TELEMETRY_STORE_INVALID_DATA";
        throw error;
      }

      try {
        return JSON.parse(value);
      } catch {
        const error = new Error("Stored telemetry snapshot is not valid JSON");
        error.code = "TELEMETRY_STORE_INVALID_DATA";
        throw error;
      }
    },

    async save(snapshot) {
      let serialized;
      try {
        serialized = JSON.stringify(snapshot);
      } catch {
        const error = new Error("Telemetry snapshot cannot be serialized");
        error.code = "TELEMETRY_STORE_INVALID_DATA";
        throw error;
      }

      if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_SNAPSHOT_BYTES) {
        const error = new Error("Telemetry snapshot exceeds the storage limit");
        error.code = "TELEMETRY_STORE_INVALID_DATA";
        throw error;
      }

      await command(
        ["SET", key, serialized, "EX", "900"],
        "TELEMETRY_STORE_WRITE_FAILED"
      );
    },

    async clear() {
      await command(["DEL", key], "TELEMETRY_STORE_CLEAR_FAILED");
    },
  };
}

function createTelemetryStoreForRuntime({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (env.VERCEL === "1") {
    return createRedisTelemetryStore({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
      fetchImpl,
    });
  }

  return createMemoryTelemetryStore();
}

module.exports = {
  createMemoryTelemetryStore,
  createRedisTelemetryStore,
  createTelemetryStoreForRuntime,
};
