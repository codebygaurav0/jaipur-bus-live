/**
 * Jaipur Bus Live — Standalone AWS Lambda Network Diagnostic Handler
 * Region: Asia Pacific (Mumbai) ap-south-1
 * 
 * Self-contained: Zero external dependencies, pure Node.js 18+/20+/22+ standard library.
 * Can be copy-pasted directly into the AWS Lambda web console in ap-south-1.
 * 
 * Tests:
 * 1. DNS resolve4 & resolve6
 * 2. TCP connect to 115.124.96.183:443 (bounded 5s timeout)
 * 3. TLS SNI handshake to www.omnificent.co.in (preserves rejectUnauthorized: true)
 * 4. HTTPS GET /OMB/
 * 
 * Never logs or returns tokens, cookies, or credentials.
 */

import https from "node:https";
import net from "node:net";
import dns from "node:dns";

function errorCode(error) {
  const code = error?.code || (error?.name === "AbortError" ? "ETIMEDOUT" : "UNKNOWN");
  return /^[A-Z0-9_:-]{1,64}$/i.test(code) ? code : "UNKNOWN";
}

async function runDiagnosticStage(name, timeoutMs, operation, logger = console) {
  const start = Date.now();
  const controller = new AbortController();
  logger.info?.(`[JCTSL Diagnostic] stage=${name} event=start`);

  let timeout;
  const operationResult = Promise.resolve()
    .then(() => operation(controller.signal))
    .then(
      (value) => ({ type: "complete", value }),
      (error) => ({ type: "error", error })
    );
  const timeoutResult = new Promise((resolve) => {
    timeout = setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
  });

  const result = await Promise.race([operationResult, timeoutResult]);
  clearTimeout(timeout);
  if (result.type === "timeout") controller.abort();

  const elapsedMs = Date.now() - start;
  const failure =
    result.type === "error"
      ? result.error
      : result.type === "timeout"
        ? { code: "ETIMEDOUT" }
        : null;
  const success =
    !failure && !(result.value && result.value.success === false);
  const stageFailure =
    failure || (result.value?.success === false ? result.value.error : null);
  const code = failure
    ? errorCode(failure)
    : result.value?.success === false
      ? errorCode(result.value.error)
      : null;

  logger.info?.(
    `[JCTSL Diagnostic] stage=${name} event=complete elapsedMs=${elapsedMs} status=${success ? "success" : "error"}${code ? ` code=${code}` : ""}`
  );

  return {
    success,
    elapsedMs,
    value: result.type === "complete" ? result.value : null,
    error: stageFailure ? { code } : null,
  };
}

function safeTcpProbe({
  host,
  port = 443,
  timeoutMs = 5000,
  connect = net.connect,
  signal,
}) {
  const boundedTimeoutMs = Math.min(
    Math.max(Number(timeoutMs) || 5000, 1),
    5000
  );
  const start = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let socket = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal && timeoutOnAbort) {
        signal.removeEventListener("abort", timeoutOnAbort);
      }
      if (socket) {
        try {
          if (typeof socket.removeAllListeners === "function") {
            socket.removeAllListeners();
          }
          if (typeof socket.destroy === "function") {
            socket.destroy();
          }
        } catch (_) {}
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        ...result,
        elapsedMs: Date.now() - start,
      });
    };

    const timeoutError = () => {
      finish({
        success: false,
        error: { code: "ETIMEDOUT" },
      });
    };

    const timeoutOnAbort = () => {
      timeoutError();
    };

    timer = setTimeout(timeoutError, boundedTimeoutMs);
    if (signal?.aborted) {
      timeoutError();
      return;
    }
    signal?.addEventListener("abort", timeoutOnAbort, { once: true });

    try {
      const onConnect = () => {
        const remoteAddress = socket?.remoteAddress || null;
        finish({
          success: true,
          ...(remoteAddress ? { remoteAddress } : {}),
          error: null,
        });
      };

      socket = connect({ host, port }, onConnect);

      if (socket && typeof socket.once === "function") {
        socket.once("connect", onConnect);
      }

      if (socket && typeof socket.on === "function") {
        socket.on("timeout", timeoutError);
        socket.on("error", (error) => {
          finish({
            success: false,
            error: { code: errorCode(error) },
          });
        });
        socket.on("close", () => {
          if (!settled) {
            finish({
              success: false,
              error: { code: "ECONNRESET" },
            });
          }
        });
      }

      if (socket && typeof socket.setTimeout === "function") {
        socket.setTimeout(boundedTimeoutMs);
      }
    } catch (error) {
      finish({
        success: false,
        error: { code: errorCode(error) },
      });
    }
  });
}

function safeHttpsProbe({
  host,
  ip = null,
  servername = null,
  path = "/OMB/",
  timeoutMs = 6000,
  request = https.request,
  signal,
}) {
  const start = Date.now();
  const connectHost = ip || host;

  return new Promise((resolve) => {
    let settled = false;
    let timer;
    let req;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", timeoutError);
      resolve({ ...result, elapsedMs: Date.now() - start });
    };

    const timeoutError = () => {
      const error = new Error("HTTPS diagnostic connection timed out");
      error.code = "ETIMEDOUT";
      if (req) req.destroy(error);
      finish({
        success: false,
        statusCode: null,
        statusMessage: null,
        serverHeader: null,
        contentType: null,
        remoteAddress: null,
        remoteFamily: null,
        tlsAuthorized: null,
        tlsProtocol: null,
        tlsCipher: null,
        certSubject: null,
        error: { code: "ETIMEDOUT" },
      });
    };

    timer = setTimeout(timeoutError, timeoutMs);
    if (signal?.aborted) {
      timeoutError();
      return;
    }
    signal?.addEventListener("abort", timeoutError, { once: true });

    try {
      req = request(
        {
          hostname: connectHost,
          port: 443,
          path,
          method: "GET",
          servername: servername || host,
          rejectUnauthorized: true,
          headers: {
            Host: host,
            "User-Agent": "okhttp/4.9.0",
            Accept: "*/*",
          },
          timeout: timeoutMs,
        },
        (res) => {
          if (settled) {
            res.resume();
            return;
          }

          const socket = res.socket;
          const cert = socket?.getPeerCertificate ? socket.getPeerCertificate() : null;
          finish({
            success: true,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            serverHeader: res.headers.server || null,
            contentType: res.headers["content-type"] || null,
            remoteAddress: socket?.remoteAddress || null,
            remoteFamily: socket?.remoteFamily || null,
            tlsAuthorized: socket?.authorized ?? null,
            tlsProtocol: socket?.getProtocol ? socket.getProtocol() : null,
            tlsCipher: socket?.getCipher ? socket.getCipher()?.name : null,
            certSubject: cert?.subject?.CN || null,
            error: null,
          });
          res.resume();
        }
      );

      req.on("timeout", timeoutError);
      req.on("error", (error) => {
        finish({
          success: false,
          statusCode: null,
          statusMessage: null,
          serverHeader: null,
          contentType: null,
          remoteAddress: null,
          remoteFamily: null,
          tlsAuthorized: null,
          tlsProtocol: null,
          tlsCipher: null,
          certSubject: null,
          error: { code: errorCode(error) },
        });
      });
      req.end();
    } catch (error) {
      finish({
        success: false,
        statusCode: null,
        statusMessage: null,
        serverHeader: null,
        contentType: null,
        remoteAddress: null,
        remoteFamily: null,
        tlsAuthorized: null,
        tlsProtocol: null,
        tlsCipher: null,
        certSubject: null,
        error: { code: errorCode(error) },
      });
    }
  });
}

function safeAuthorizedApiProbe({
  host,
  ip = null,
  servername = null,
  path = "/OMB/allvehloc",
  authToken,
  userId,
  timeoutMs = 8000,
  request = https.request,
  signal,
}) {
  const start = Date.now();
  const connectHost = ip || host;

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let req = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal && timeoutError) signal.removeEventListener("abort", timeoutError);
      resolve({ ...result, elapsedMs: Date.now() - start });
    };

    const timeoutError = () => {
      const error = new Error("JCTSL authorized API connection timed out");
      error.code = "ETIMEDOUT";
      if (req) {
        try {
          req.destroy(error);
        } catch (_) {}
      }
      finish({
        tested: true,
        success: false,
        statusCode: null,
        busCount: 0,
        hasAuthToken: Boolean(authToken),
        hasUserId: Boolean(userId),
        error: { code: "ETIMEDOUT" },
      });
    };

    timer = setTimeout(timeoutError, timeoutMs);
    if (signal?.aborted) {
      timeoutError();
      return;
    }
    signal?.addEventListener("abort", timeoutError, { once: true });

    try {
      const payload = JSON.stringify({ org_id: "1" });
      const reqHeaders = {
        Host: host,
        "User-Agent": "okhttp/4.9.0",
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": Buffer.byteLength(payload),
      };
      if (authToken) reqHeaders["Auth-token"] = authToken;
      if (userId) reqHeaders["User-ID"] = String(userId);

      req = request(
        {
          hostname: connectHost,
          port: 443,
          path,
          method: "POST",
          servername: servername || host,
          rejectUnauthorized: true,
          headers: reqHeaders,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("error", (error) => {
            finish({
              tested: true,
              success: false,
              statusCode: res.statusCode || null,
              busCount: 0,
              hasAuthToken: Boolean(authToken),
              hasUserId: Boolean(userId),
              error: { code: errorCode(error) },
            });
          });
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let busCount = 0;
            let parseOk = false;
            try {
              const data = JSON.parse(raw);
              if (Array.isArray(data)) {
                busCount = data.length;
                parseOk = true;
              } else if (data && typeof data === "object") {
                const arr = Array.isArray(data.respData)
                  ? data.respData
                  : Array.isArray(data.data)
                    ? data.data
                    : Array.isArray(data.vehicles)
                      ? data.vehicles
                      : [];
                busCount = arr.length;
                parseOk = arr.length > 0;
              }
            } catch (_) {}

            const isSuccess =
              res.statusCode === 200 && (parseOk || raw.length > 500);
            finish({
              tested: true,
              success: isSuccess,
              statusCode: res.statusCode || null,
              busCount,
              rawBytes: raw.length,
              hasAuthToken: Boolean(authToken),
              hasUserId: Boolean(userId),
              error: isSuccess ? null : { code: `HTTP_${res.statusCode}` },
            });
          });
        }
      );

      req.on("timeout", timeoutError);
      req.on("error", (error) => {
        finish({
          tested: true,
          success: false,
          statusCode: null,
          busCount: 0,
          hasAuthToken: Boolean(authToken),
          hasUserId: Boolean(userId),
          error: { code: errorCode(error) },
        });
      });
      req.write(payload);
      req.end();
    } catch (error) {
      finish({
        tested: true,
        success: false,
        statusCode: null,
        busCount: 0,
        hasAuthToken: Boolean(authToken),
        hasUserId: Boolean(userId),
        error: { code: errorCode(error) },
      });
    }
  });
}

function failedProbe(stage) {
  return (
    stage.value || {
      success: false,
      statusCode: null,
      statusMessage: null,
      serverHeader: null,
      contentType: null,
      remoteAddress: null,
      remoteFamily: null,
      tlsAuthorized: null,
      tlsProtocol: null,
      tlsCipher: null,
      certSubject: null,
      elapsedMs: stage.elapsedMs,
      error: stage.error || { code: "UNKNOWN" },
    }
  );
}

export async function runJctslNetworkDiagnostic({
  baseUrl = "https://www.omnificent.co.in/OMB/",
  logger = console,
  dnsTimeoutMs = 2500,
  connectionTimeoutMs = 6000,
  tcpTimeoutMs = 5000,
  authToken = null,
  userId = null,
  testAuthorizedApi = false,
} = {}) {
  const diagnosticStart = Date.now();
  const parsedUrl = new URL(baseUrl);
  const targetHost = parsedUrl.hostname;
  const targetPort = Number(parsedUrl.port || 443);
  const targetPath = parsedUrl.pathname.endsWith("/")
    ? parsedUrl.pathname
    : `${parsedUrl.pathname}/`;
  const targetHttpsUrl = `${parsedUrl.origin}${targetPath}`;

  const defaultTcpTimeout =
    connectionTimeoutMs < 5000 ? connectionTimeoutMs : 5000;
  const boundedTcpTimeoutMs = Math.min(
    Math.max(
      Number(tcpTimeoutMs !== undefined ? tcpTimeoutMs : defaultTcpTimeout) || 5000,
      1
    ),
    5000
  );

  const dnsStages = await Promise.all([
    runDiagnosticStage(
      "dns.lookup",
      dnsTimeoutMs,
      () => dns.promises.lookup(targetHost, { all: true }),
      logger
    ),
    runDiagnosticStage(
      "dns.resolve4",
      dnsTimeoutMs,
      () => dns.promises.resolve4(targetHost),
      logger
    ),
    runDiagnosticStage(
      "dns.resolve6",
      dnsTimeoutMs,
      () => dns.promises.resolve6(targetHost),
      logger
    ),
  ]);

  const [lookupStage, resolve4Stage, resolve6Stage] = dnsStages;
  const lookupResults = Array.isArray(lookupStage.value) ? lookupStage.value : [];
  const resolve4Results = Array.isArray(resolve4Stage.value) ? resolve4Stage.value : [];
  const resolve6Results = Array.isArray(resolve6Stage.value) ? resolve6Stage.value : [];

  const resolvedIpv4Candidate =
    resolve4Results[0] ||
    lookupResults.find((result) => result.family === 4 || result.family === "IPv4")
      ?.address ||
    null;

  const connectionStages = await Promise.all([
    runDiagnosticStage(
      "tcp.connect",
      boundedTcpTimeoutMs,
      (signal) =>
        safeTcpProbe({
          host: targetHost,
          port: targetPort,
          timeoutMs: boundedTcpTimeoutMs,
          signal,
        }),
      logger
    ),
    runDiagnosticStage(
      "https.hostname",
      connectionTimeoutMs,
      (signal) =>
        safeHttpsProbe({
          host: targetHost,
          path: targetPath,
          timeoutMs: connectionTimeoutMs,
          signal,
        }),
      logger
    ),
    runDiagnosticStage(
      "https.directIpv4Sni",
      connectionTimeoutMs,
      (signal) =>
        resolvedIpv4Candidate
          ? safeHttpsProbe({
              host: targetHost,
              ip: resolvedIpv4Candidate,
              servername: targetHost,
              path: targetPath,
              timeoutMs: connectionTimeoutMs,
              signal,
            }).then((probe) => ({
              tested: true,
              resolvedIpv4: resolvedIpv4Candidate,
              servername: targetHost,
              hostHeader: targetHost,
              path: targetPath,
              ...probe,
            }))
          : Promise.resolve({
              tested: false,
              reason: "No IPv4 address resolved via resolve4 or lookup",
              success: false,
              error: { code: resolve4Stage.error?.code || lookupStage.error?.code || "ENODATA" },
            }),
      logger
    ),
    runDiagnosticStage(
      "https.fetch",
      connectionTimeoutMs,
      async (signal) => {
        const response = await fetch(targetHttpsUrl, {
          method: "GET",
          headers: {
            "User-Agent": "okhttp/4.9.0",
            Accept: "*/*",
          },
          signal,
        });
        return {
          success: true,
          statusCode: response.status,
          statusText: response.statusText,
          serverHeader: response.headers.get("server") || null,
          error: null,
        };
      },
      logger
    ),
  ]);

  const [tcpStage, hostnameStage, directIpv4Stage, fetchStage] = connectionStages;
  const fetchResult = fetchStage.value || {
    success: false,
    statusCode: null,
    statusText: null,
    serverHeader: null,
    error: fetchStage.error,
  };

  const tcpTestResult =
    tcpStage.value || {
      success: false,
      elapsedMs: tcpStage.elapsedMs,
      error: tcpStage.error || { code: "UNKNOWN" },
    };

  let authorizedApiTestResult = {
    tested: false,
    reason: "Not requested",
    hasAuthToken: Boolean(authToken),
    hasUserId: Boolean(userId),
  };

  if (testAuthorizedApi) {
    if (!authToken || !userId) {
      authorizedApiTestResult = {
        tested: false,
        reason: "No credentials provided via environment or session",
        hasAuthToken: Boolean(authToken),
        hasUserId: Boolean(userId),
      };
    } else if (!tcpStage.success) {
      authorizedApiTestResult = {
        tested: false,
        reason: "Skipped: upstream TCP connection timed out",
        hasAuthToken: Boolean(authToken),
        hasUserId: Boolean(userId),
      };
    } else {
      const apiStage = await runDiagnosticStage(
        "api.authorizedLiveBuses",
        connectionTimeoutMs,
        (signal) =>
          safeAuthorizedApiProbe({
            host: targetHost,
            ip: resolvedIpv4Candidate,
            servername: targetHost,
            path: "/OMB/allvehloc",
            authToken,
            userId,
            timeoutMs: connectionTimeoutMs,
            signal,
          }),
        logger
      );
      authorizedApiTestResult = apiStage.value || {
        tested: true,
        success: false,
        statusCode: null,
        busCount: 0,
        hasAuthToken: Boolean(authToken),
        hasUserId: Boolean(userId),
        elapsedMs: apiStage.elapsedMs,
        error: apiStage.error || { code: "UNKNOWN" },
      };
    }
  }

  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    totalElapsedMs: Date.now() - diagnosticStart,
    target: {
      host: targetHost,
      path: targetPath,
      url: targetHttpsUrl,
      port: targetPort,
    },
    dns: {
      lookup: lookupResults,
      lookupError: lookupStage.error,
      resolve4: resolve4Results,
      resolve4Error: resolve4Stage.error,
      resolve6: resolve6Results,
      resolve6Error: resolve6Stage.error,
      hasIpv4: resolve4Results.length > 0 ||
        lookupResults.some((result) => result.family === 4 || result.family === "IPv4"),
      hasIpv6: resolve6Results.length > 0 ||
        lookupResults.some((result) => result.family === 6 || result.family === "IPv6"),
    },
    tcpConnectionTest: tcpTestResult,
    httpsConnectionTest: failedProbe(hostnameStage),
    directIpv4SniTest:
      directIpv4Stage.value ||
      (resolvedIpv4Candidate
        ? {
            tested: true,
            resolvedIpv4: resolvedIpv4Candidate,
            servername: targetHost,
            hostHeader: targetHost,
            path: targetPath,
            ...failedProbe(directIpv4Stage),
          }
        : failedProbe(directIpv4Stage)),
    fetchTest: {
      ...fetchResult,
      elapsedMs: fetchStage.elapsedMs,
      error: fetchResult.error || fetchStage.error,
    },
    authorizedApiTest: authorizedApiTestResult,
    stages: {
      dnsLookup: { success: lookupStage.success, elapsedMs: lookupStage.elapsedMs, error: lookupStage.error },
      dnsResolve4: { success: resolve4Stage.success, elapsedMs: resolve4Stage.elapsedMs, error: resolve4Stage.error },
      dnsResolve6: { success: resolve6Stage.success, elapsedMs: resolve6Stage.elapsedMs, error: resolve6Stage.error },
      tcpConnect: { success: tcpStage.success, elapsedMs: tcpStage.elapsedMs, error: tcpStage.error },
      httpsHostname: { success: hostnameStage.success, elapsedMs: hostnameStage.elapsedMs, error: hostnameStage.error },
      httpsDirectIpv4Sni: { success: directIpv4Stage.success, elapsedMs: directIpv4Stage.elapsedMs, error: directIpv4Stage.error },
      httpsUndiciFetch: { success: fetchStage.success, elapsedMs: fetchStage.elapsedMs, error: fetchStage.error },
      ...(testAuthorizedApi
        ? {
            apiAuthorizedLiveBuses: {
              success: authorizedApiTestResult.success,
              elapsedMs: authorizedApiTestResult.elapsedMs || 0,
              error: authorizedApiTestResult.error || null,
            },
          }
        : {}),
    },
  };
}

// AWS Lambda entrypoint handler
export const handler = async (event = {}) => {
  try {
    const wantsApiTest = Boolean(event?.testApi || process.env.JCTSL_AUTH_TOKEN);
    const authToken = event?.authToken || process.env.JCTSL_AUTH_TOKEN || null;
    const userId = event?.userId || process.env.JCTSL_USER_ID || null;

    const result = await runJctslNetworkDiagnostic({
      testAuthorizedApi: wantsApiTest,
      authToken,
      userId,
    });
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(result, null, 2),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "AWS Lambda diagnostic execution failed",
        code: errorCode(err),
      }),
    };
  }
};
