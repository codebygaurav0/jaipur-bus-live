const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  runJctslNetworkDiagnostic,
  safeHttpsProbe,
  safeTcpProbe,
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
