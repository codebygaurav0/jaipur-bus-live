const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  runJctslNetworkDiagnostic,
  safeHttpsProbe,
  safeTcpProbe,
  safeAuthorizedApiProbe,
} = require("../jctslNetworkDiagnostic");

function successfulHttpsRequest(options, callback) {
  const request = new EventEmitter();
  request.end = () => {
    const response = new EventEmitter();
    response.statusCode = 200;
    response.statusMessage = "OK";
    response.headers = { server: "test-server", "content-type": "text/html" };
    response.socket = {
      remoteAddress: "192.0.2.1",
      remoteFamily: "IPv4",
      authorized: true,
      getProtocol: () => "TLSv1.3",
      getCipher: () => ({ name: "TEST-CIPHER" }),
      getPeerCertificate: () => ({ subject: { CN: "test.example" } }),
    };
    response.resume = () => {};
    callback(response);
  };
  request.destroy = (error) => request.emit("error", error);
  request.options = options;
  return request;
}

test("DNS timeouts do not prevent the other diagnostic stages from completing", async () => {
  const messages = [];
  const logger = { info: (message) => messages.push(message) };
  const result = await runJctslNetworkDiagnostic({
    baseUrl: "https://www.omnificent.co.in/OMB/",
    dnsPromises: {
      lookup: () => new Promise(() => {}),
      resolve4: () => new Promise(() => {}),
      resolve6: async () => ["2001:db8::1"],
    },
    httpsRequest: successfulHttpsRequest,
    fetchImpl: async () => ({
      status: 200,
      statusText: "OK",
      headers: { get: () => "test-server" },
    }),
    logger,
    dnsTimeoutMs: 15,
    connectionTimeoutMs: 100,
  });

  assert.equal(result.dns.lookupError.code, "ETIMEDOUT");
  assert.equal(result.dns.resolve4Error.code, "ETIMEDOUT");
  assert.equal(result.stages.dnsLookup.success, false);
  assert.equal(result.stages.httpsHostname.success, true);
  assert.equal(result.httpsConnectionTest.statusCode, 200);
  assert.equal(result.undiciFetchTest.statusCode, 200);
  assert.ok(messages.some((message) => message.includes("stage=dns.lookup event=start")));
  assert.ok(messages.some((message) => message.includes("stage=dns.lookup event=complete")));
});

test("direct HTTPS connection timeout is bounded and sanitized", async () => {
  const result = await safeHttpsProbe({
    host: "www.omnificent.co.in",
    ip: "192.0.2.10",
    servername: "www.omnificent.co.in",
    timeoutMs: 15,
    request(options) {
      const request = new EventEmitter();
      request.end = () => {};
      request.destroy = (error) => request.emit("error", error);
      request.options = options;
      return request;
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, "ETIMEDOUT");
  assert.equal(result.error.message, undefined);
});

test("HTTPS probe accepts an HTTP response while retaining SNI, Host, and TLS validation", async () => {
  let requestOptions;
  const result = await safeHttpsProbe({
    host: "www.omnificent.co.in",
    ip: "192.0.2.10",
    servername: "www.omnificent.co.in",
    path: "/OMB/allvehloc",
    request(options, callback) {
      requestOptions = options;
      return successfulHttpsRequest(options, callback);
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.tlsAuthorized, true);
  assert.equal(requestOptions.hostname, "192.0.2.10");
  assert.equal(requestOptions.servername, "www.omnificent.co.in");
  assert.equal(requestOptions.headers.Host, "www.omnificent.co.in");
  assert.equal(requestOptions.rejectUnauthorized, true);
});

test("TCP connection timeout is bounded, cleans up socket, and omits remoteAddress", async () => {
  let destroyed = false;
  let listenersRemoved = false;
  const result = await safeTcpProbe({
    host: "www.omnificent.co.in",
    port: 443,
    timeoutMs: 15,
    connect(options) {
      const socket = new EventEmitter();
      socket.destroy = () => {
        destroyed = true;
      };
      socket.removeAllListeners = () => {
        listenersRemoved = true;
      };
      return socket;
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, "ETIMEDOUT");
  assert.equal(result.remoteAddress, undefined);
  assert.ok(result.elapsedMs >= 10);
  assert.equal(destroyed, true);
  assert.equal(listenersRemoved, true);
});

test("TCP connection records success, remoteAddress, and cleans up socket", async () => {
  let destroyed = false;
  let listenersRemoved = false;
  const result = await safeTcpProbe({
    host: "www.omnificent.co.in",
    port: 443,
    timeoutMs: 100,
    connect(options, callback) {
      const socket = new EventEmitter();
      socket.remoteAddress = "115.124.96.183";
      socket.destroy = () => {
        destroyed = true;
      };
      socket.removeAllListeners = () => {
        listenersRemoved = true;
      };
      setImmediate(() => {
        if (callback) callback();
      });
      return socket;
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.remoteAddress, "115.124.96.183");
  assert.equal(result.error, null);
  assert.equal(destroyed, true);
  assert.equal(listenersRemoved, true);
});

test("TCP connection handles error cleanly, sanitizes error code, and cleans up socket", async () => {
  let destroyed = false;
  let listenersRemoved = false;
  const result = await safeTcpProbe({
    host: "www.omnificent.co.in",
    port: 443,
    timeoutMs: 100,
    connect() {
      const socket = new EventEmitter();
      socket.destroy = () => {
        destroyed = true;
      };
      socket.removeAllListeners = () => {
        listenersRemoved = true;
      };
      setImmediate(() => {
        const error = new Error("Connection refused");
        error.code = "ECONNREFUSED";
        socket.emit("error", error);
      });
      return socket;
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, "ECONNREFUSED");
  assert.equal(result.remoteAddress, undefined);
  assert.equal(destroyed, true);
  assert.equal(listenersRemoved, true);
});

test("runJctslNetworkDiagnostic includes tcpConnectionTest in output", async () => {
  const result = await runJctslNetworkDiagnostic({
    baseUrl: "https://www.omnificent.co.in/OMB/",
    dnsPromises: {
      lookup: async () => [{ address: "115.124.96.183", family: 4 }],
      resolve4: async () => ["115.124.96.183"],
      resolve6: async () => [],
    },
    httpsRequest: successfulHttpsRequest,
    fetchImpl: async () => ({
      status: 200,
      statusText: "OK",
      headers: { get: () => "test-server" },
    }),
    netConnect(options, callback) {
      const socket = new EventEmitter();
      socket.remoteAddress = "115.124.96.183";
      socket.destroy = () => {};
      socket.removeAllListeners = () => {};
      setImmediate(() => {
        if (callback) callback();
      });
      return socket;
    },
    logger: { info: () => {} },
    dnsTimeoutMs: 50,
    connectionTimeoutMs: 50,
    tcpTimeoutMs: 50,
  });

  assert.ok(result.tcpConnectionTest);
  assert.equal(result.tcpConnectionTest.success, true);
  assert.equal(result.tcpConnectionTest.remoteAddress, "115.124.96.183");
  assert.equal(result.tcpConnectionTest.error, null);
  assert.ok(result.stages.tcpConnect);
  assert.equal(result.stages.tcpConnect.success, true);
});

test("safeAuthorizedApiProbe successfully performs authorized POST and extracts bus count without leaking tokens", async () => {
  let capturedOptions;
  let writtenBody;
  const mockToken = "SECRET_AUTH_TOKEN_TEST_999";
  const mockUserId = "98765";

  const result = await safeAuthorizedApiProbe({
    host: "www.omnificent.co.in",
    ip: "115.124.96.183",
    servername: "www.omnificent.co.in",
    authToken: mockToken,
    userId: mockUserId,
    timeoutMs: 500,
    request(options, callback) {
      capturedOptions = options;
      const req = new EventEmitter();
      req.write = (chunk) => { writtenBody = chunk; };
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        setImmediate(() => {
          res.emit("data", Buffer.from(JSON.stringify({
            respCode: 200,
            respMessage: "Success",
            respData: [{ vehId: "RJ14-1" }, { vehId: "RJ14-2" }, { vehId: "RJ14-3" }, { vehId: "RJ14-4" }],
          })));
          res.emit("end");
        });
        callback(res);
      };
      req.destroy = (err) => req.emit("error", err);
      return req;
    },
  });

  assert.equal(result.tested, true);
  assert.equal(result.success, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.busCount, 4);
  assert.equal(result.hasAuthToken, true);
  assert.equal(result.hasUserId, true);
  assert.equal(capturedOptions.headers["Auth-token"], mockToken);
  assert.equal(capturedOptions.headers["User-ID"], mockUserId);
  assert.equal(capturedOptions.rejectUnauthorized, true);

  // Strict token sanitization check
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(mockToken), false, "Token must never be present in diagnostic output");
  assert.equal(serialized.includes(mockUserId), false, "User-ID must never be present in diagnostic output");
});

test("runJctslNetworkDiagnostic skips authorizedApiTest if TCP connection fails", async () => {
  const result = await runJctslNetworkDiagnostic(
    { baseUrl: "https://www.omnificent.co.in/OMB/",
      dnsPromises: {
        lookup: async () => [{ address: "115.124.96.183", family: 4 }],
        resolve4: async () => ["115.124.96.183"],
        resolve6: async () => [],
      },
      netConnect(options) {
        const socket = new EventEmitter();
        socket.destroy = () => {};
        socket.removeAllListeners = () => {};
        setImmediate(() => {
          const err = new Error("Connection timeout");
          err.code = "ETIMEDOUT";
          socket.emit("error", err);
        });
        return socket;
      },
      httpsRequest: successfulHttpsRequest,
      fetchImpl: async () => ({ status: 200, statusText: "OK", headers: { get: () => "test" } }),
      logger: { info: () => {} },
      testAuthorizedApi: true,
      authToken: "SOME_TOKEN",
      userId: "12345",
      dnsTimeoutMs: 50,
      connectionTimeoutMs: 50,
      tcpTimeoutMs: 50,
    }
  );

  assert.equal(result.tcpConnectionTest.success, false);
  assert.equal(result.authorizedApiTest.tested, false);
  assert.ok(result.authorizedApiTest.reason.includes("timed out"));
});
