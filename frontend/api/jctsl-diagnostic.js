
import crypto from "node:crypto";
import dns from "node:dns";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runJctslNetworkDiagnostic } = require(
  "../backend/jctslNetworkDiagnostic.cjs"
);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expected = process.env.DIAGNOSTIC_SECRET;
  const provided = req.headers["x-diagnostic-secret"];

  if (!expected) {
    return res.status(503).json({
      error: "Diagnostic endpoint not configured",
    });
  }

  if (typeof provided !== "string") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await runJctslNetworkDiagnostic({
      baseUrl:
        process.env.JCTSL_BASE_URL ||
        "https://www.omnificent.co.in/OMB/",
      dnsPromises: dns.promises,
      defaultResultOrder:
        typeof dns.getDefaultResultOrder === "function"
          ? dns.getDefaultResultOrder()
          : "unknown",
      logger: console,
      testAuthorizedApi: false,
    });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: "Diagnostic execution failed",
      code: /^[A-Z0-9_:-]{1,64}$/i.test(err?.code || "")
        ? err.code
        : "UNKNOWN",
    });
  }
}
