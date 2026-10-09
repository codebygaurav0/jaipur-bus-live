const https = require("https");

function errorCode(error) {
  const code = error?.code || (error?.name === "AbortError" ? "ETIMEDOUT" : "UNKNOWN");
  return /^[A-Z0-9_:-]{1,64}$/i.test(code) ? code : "UNKNOWN";
}

async function runDiagnosticStage(name, timeoutMs, operation, logger = console) {
  const start = Date.now();
  const controller = new AbortController();
  logger.info(`[JCTSL Diagnostic] stage=${name} event=start`);

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

  logger.info(
    `[JCTSL Diagnostic] stage=${name} event=complete elapsedMs=${elapsedMs} status=${success ? "success" : "error"}${code ? ` code=${code}` : ""}`
  );

  return {
    success,
    elapsedMs,
    value: result.type === "complete" ? result.value : null,
    error: stageFailure ? { code } : null,
  };
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

async function runJctslNetworkDiagnostic({
  baseUrl,
  dnsPromises,
  fetchImpl = fetch,
  httpsRequest = https.request,
  defaultResultOrder = "unknown",
  logger = console,
  dnsTimeoutMs = 2500,
  connectionTimeoutMs = 6000,
}) {
  const diagnosticStart = Date.now();
  const parsedUrl = new URL(baseUrl);
  const targetHost = parsedUrl.hostname;
  const targetPath = parsedUrl.pathname.endsWith("/")
    ? parsedUrl.pathname
    : `${parsedUrl.pathname}/`;
  const targetHttpsUrl = `${parsedUrl.origin}${targetPath}`;

  const dnsStages = await Promise.all([
    runDiagnosticStage(
      "dns.lookup",
      dnsTimeoutMs,
      () => dnsPromises.lookup(targetHost, { all: true }),
      logger
    ),
    runDiagnosticStage(
      "dns.resolve4",
      dnsTimeoutMs,
      () => dnsPromises.resolve4(targetHost),
      logger
    ),
    runDiagnosticStage(
      "dns.resolve6",
      dnsTimeoutMs,
      () => dnsPromises.resolve6(targetHost),
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

  const httpsStages = await Promise.all([
    runDiagnosticStage(
      "https.hostname",
      connectionTimeoutMs,
      (signal) =>
        safeHttpsProbe({
          host: targetHost,
          path: targetPath,
          timeoutMs: connectionTimeoutMs,
          request: httpsRequest,
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
              request: httpsRequest,
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
      "https.undiciFetch",
      connectionTimeoutMs,
      async (signal) => {
        const response = await fetchImpl(targetHttpsUrl, {
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

  const [hostnameStage, directIpv4Stage, fetchStage] = httpsStages;
  const fetchResult = fetchStage.value || {
    success: false,
    statusCode: null,
    statusText: null,
    serverHeader: null,
    error: fetchStage.error,
  };

  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    totalElapsedMs: Date.now() - diagnosticStart,
    target: {
      host: targetHost,
      path: targetPath,
      url: targetHttpsUrl,
      port: Number(parsedUrl.port || 443),
    },
    dns: {
      defaultResultOrder,
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
    undiciFetchTest: {
      ...fetchResult,
      elapsedMs: fetchStage.elapsedMs,
      error: fetchResult.error || fetchStage.error,
    },
    stages: {
      dnsLookup: { success: lookupStage.success, elapsedMs: lookupStage.elapsedMs, error: lookupStage.error },
      dnsResolve4: { success: resolve4Stage.success, elapsedMs: resolve4Stage.elapsedMs, error: resolve4Stage.error },
      dnsResolve6: { success: resolve6Stage.success, elapsedMs: resolve6Stage.elapsedMs, error: resolve6Stage.error },
      httpsHostname: { success: hostnameStage.success, elapsedMs: hostnameStage.elapsedMs, error: hostnameStage.error },
      httpsDirectIpv4Sni: { success: directIpv4Stage.success, elapsedMs: directIpv4Stage.elapsedMs, error: directIpv4Stage.error },
      httpsUndiciFetch: { success: fetchStage.success, elapsedMs: fetchStage.elapsedMs, error: fetchStage.error },
    },
  };
}

module.exports = {
  runDiagnosticStage,
  runJctslNetworkDiagnostic,
  safeHttpsProbe,
};
