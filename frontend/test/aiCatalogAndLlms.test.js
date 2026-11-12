import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("llms.txt conforms to llmstxt.org specification", () => {
  const filePath = path.join(__dirname, "../public/llms.txt");
  assert.ok(fs.existsSync(filePath), "llms.txt must exist in public directory");

  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.startsWith("# Jaipur Bus Live"), "Must start with H1 project title");
  assert.ok(content.includes("> Real-time JCTSL bus GPS tracking"), "Must include blockquote summary");
  assert.ok(content.includes("- [Jaipur Bus Live Web App]("), "Must include markdown formatted links");
  assert.ok(content.includes("- [Live Bus Telemetry API]("), "Must include live bus API markdown link");
  assert.ok(content.includes("- [Bus Routes API]("), "Must include routes API link");
  assert.ok(content.includes("- [Bus Stops API]("), "Must include bus stops API link");
  assert.ok(content.includes("## Core Capabilities"), "Must include capabilities section");
  assert.ok(content.includes("## Primary Resources"), "Must include primary resources section");
});

test("robots.txt strictly conforms to RFC 9309 protocol", () => {
  const filePath = path.join(__dirname, "../public/robots.txt");
  assert.ok(fs.existsSync(filePath), "robots.txt must exist in public directory");

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  const validDirectives = ["user-agent", "allow", "disallow", "sitemap"];
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    assert.ok(colonIdx > 0, `Line must have key-value format: ${line}`);
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    assert.ok(
      validDirectives.includes(key),
      `robots.txt directive '${key}' is invalid under RFC 9309`
    );
  }

  assert.ok(!content.toLowerCase().includes("agentmap:"), "robots.txt must not contain non-standard Agentmap");
  assert.ok(content.includes("Sitemap: https://jaipur-bus-live.web.app/sitemap.xml"), "Must reference standard sitemap URL");
});

test("ai-catalog.json matches ARD specification schema and includes valid entries", () => {
  const schemaPath = path.join(__dirname, "../public/ai-catalog.schema.json");
  const catalogPath = path.join(__dirname, "../public/ai-catalog.json");
  const wellKnownPath = path.join(__dirname, "../public/.well-known/ai-catalog.json");

  assert.ok(fs.existsSync(schemaPath), "ai-catalog.schema.json must exist");
  assert.ok(fs.existsSync(catalogPath), "ai-catalog.json must exist");
  assert.ok(fs.existsSync(wellKnownPath), ".well-known/ai-catalog.json must exist");

  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const wellKnown = JSON.parse(fs.readFileSync(wellKnownPath, "utf8"));

  assert.equal(catalog.specVersion, "1.0", "specVersion must be 1.0 per ARD standard");
  assert.ok(catalog.host, "host block must exist");
  assert.equal(catalog.host.displayName, "Jaipur Bus Live");
  assert.ok(Array.isArray(catalog.entries), "entries must be an array");
  assert.ok(catalog.entries.length >= 5, "must define transit entries");

  for (const entry of catalog.entries) {
    assert.ok(
      entry.identifier.startsWith("urn:air:") || entry.identifier.startsWith("urn:ai:"),
      `identifier must be valid URN: ${entry.identifier}`
    );
    assert.ok(entry.displayName, "displayName is required");
    assert.ok(entry.type, "type is required");
    assert.ok(entry.url, "url is required");
    assert.ok(entry.description, "description is required");
    assert.ok(
      Array.isArray(entry.representativeQueries) && entry.representativeQueries.length >= 2,
      "representativeQueries must have at least 2 queries"
    );
  }

  // Ensure catalog and .well-known/ai-catalog.json are completely identical
  assert.deepEqual(catalog, wellKnown, "ai-catalog.json and .well-known/ai-catalog.json must be identical");

  // Validate schema compatibility with Ajv standard JSON Schema Draft 2020-12 per official ARD specification
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const isValid = validate(catalog);
  assert.ok(isValid, `ai-catalog.json must be valid according to official ARD schema: ${JSON.stringify(validate.errors)}`);
});

test("index.html preserves Google AdSense and critical LCP preload", () => {
  const indexPath = path.join(__dirname, "../index.html");
  const content = fs.readFileSync(indexPath, "utf8");

  assert.ok(
    content.includes('content="ca-pub-9794253080735375"'),
    "AdSense account meta tag must be preserved"
  );
  assert.ok(
    content.includes("ca-pub-9794253080735375"),
    "AdSense client script must be present"
  );
  assert.ok(
    content.includes('rel="preload" href="/assets/hero/hero-bus-hawa-mahal.svg" as="image" type="image/svg+xml" fetchpriority="high"'),
    "Critical LCP hero SVG preload must be present with high fetchpriority"
  );
  assert.ok(
    content.includes("G-Z0VP0E0JG2"),
    "Google Analytics tracking ID must be present"
  );
});

test("metro/index.html preserves Google AdSense, Analytics, SEO metadata and critical LCP preloads", () => {
  const metroIndexPath = path.join(__dirname, "../metro/index.html");
  assert.ok(fs.existsSync(metroIndexPath), "metro/index.html must exist");
  const content = fs.readFileSync(metroIndexPath, "utf8");

  assert.ok(content.includes('content="ca-pub-9794253080735375"'), "AdSense account meta tag must be preserved in metro HTML");
  assert.ok(content.includes("ca-pub-9794253080735375"), "AdSense client script must be present in metro HTML");
  assert.ok(content.includes("G-Z0VP0E0JG2"), "Google Analytics tracking ID must be present in metro HTML");
  assert.ok(content.includes('rel="canonical" href="https://jaipur-bus-live.web.app/metro"'), "Canonical URL must be /metro");
  assert.ok(content.includes("Jaipur Metro Route Map, Fare &amp; Timings | Jaipur Bus Live"), "Title must be keyword optimized");
  assert.ok(content.includes('rel="preload" href="/assets/metro/jaipur-metro-guide-hero-mobile.webp" as="image" type="image/webp" fetchpriority="high" media="(max-width: 600px)"'), "Must preload mobile WebP");
  assert.ok(content.includes('rel="preload" href="/assets/metro/jaipur-metro-guide-hero.webp" as="image" type="image/webp" fetchpriority="high" media="(min-width: 601px)"'), "Must preload desktop WebP");
});
