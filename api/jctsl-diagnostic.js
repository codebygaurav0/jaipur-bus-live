// Standalone temporary diagnostic endpoint for Vercel Serverless Function (Mumbai bom1 region)
// Used to test outbound connectivity to JCTSL (www.omnificent.co.in) from an Indian cloud region
const dns = require("dns");
const { runJctslNetworkDiagnostic } = require("../backend/jctslNetworkDiagnostic");

module.exports = async function handler(req, res) {
  try {
    const wantsApiTest = req?.query?.api === "1" || req?.query?.api === "true";
    const authToken = process.env.JCTSL_AUTH_TOKEN || null;
    const userId = process.env.JCTSL_USER_ID || null;

    const result = await runJctslNetworkDiagnostic({
      baseUrl: process.env.JCTSL_BASE_URL || "https://www.omnificent.co.in/OMB/",
      dnsPromises: dns.promises,
      defaultResultOrder:
        typeof dns.getDefaultResultOrder === "function"
          ? dns.getDefaultResultOrder()
          : "unknown",
      logger: console,
      testAuthorizedApi: wantsApiTest && Boolean(authToken && userId),
      authToken,
      userId,
    });
    if (res && typeof res.setHeader === "function") {
      res.setHeader("Cache-Control", "no-store, max-age=0");
    }
    if (res && typeof res.status === "function") {
      return res.status(200).json(result);
    }
    return result;
  } catch (err) {
    const code = /^[A-Z0-9_:-]{1,64}$/i.test(err?.code || "") ? err.code : "UNKNOWN";
    if (res && typeof res.status === "function") {
      return res.status(500).json({
        error: "Diagnostic execution failed",
        code,
      });
    }
    throw err;
  }
};
