import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const metroHomeCssPath = fileURLToPath(
  new URL("../src/metro/MetroHome.css", import.meta.url)
);
const emergencyCssPath = fileURLToPath(
  new URL("../src/components/EmergencyView.css", import.meta.url)
);
const metroHomeJsxPath = fileURLToPath(
  new URL("../src/metro/MetroHome.jsx", import.meta.url)
);
const metroJourneyJsxPath = fileURLToPath(
  new URL("../src/metro/MetroJourney.jsx", import.meta.url)
);
const emergencyJsxPath = fileURLToPath(
  new URL("../src/components/EmergencyView.jsx", import.meta.url)
);
const appJsxPath = fileURLToPath(
  new URL("../src/App.jsx", import.meta.url)
);
const metroDataJsPath = fileURLToPath(
  new URL("../src/metro/metroData.js", import.meta.url)
);

test("Metro data contains all 11 stations from Mansarovar to Badi Chaupar", () => {
  const content = fs.readFileSync(metroDataJsPath, "utf-8");
  const requiredStations = [
    "Mansarovar",
    "New Aatish Market",
    "Vivek Vihar",
    "Shyam Nagar",
    "Ram Nagar",
    "Civil Lines",
    "Railway Station",
    "Sindhi Camp",
    "Chandpole",
    "Chhoti Chaupar",
    "Badi Chaupar",
  ];

  for (const st of requiredStations) {
    assert.ok(
      content.includes(`"${st}"`),
      `Station ${st} must exist in metroData.js`
    );
  }
});

test("Metro CSS includes responsive breakpoints for 320px, mobile, tablet, desktop, and 1920px ultrawide", () => {
  const css = fs.readFileSync(metroHomeCssPath, "utf-8");

  // Check 320px-359px
  assert.ok(css.includes("max-width: 359px"), "Small mobile breakpoint (320px-359px) must be present in MetroHome.css");
  // Check standard mobile
  assert.ok(css.includes("max-width: 600px"), "Mobile breakpoint (<= 600px) must be present in MetroHome.css");
  // Check tablet
  assert.ok(css.includes("max-width: 960px"), "Tablet breakpoint (<= 960px) must be present in MetroHome.css");
  // Check ultrawide
  assert.ok(css.includes("min-width: 1920px"), "Ultrawide desktop breakpoint (>= 1920px) must be present in MetroHome.css");
  // Check prefers-reduced-motion
  assert.ok(css.includes("prefers-reduced-motion"), "Accessibility reduced-motion must be present in MetroHome.css");
});

test("Emergency CSS includes responsive breakpoints for 320px, mobile, tablet, desktop, and 1920px ultrawide", () => {
  const css = fs.readFileSync(emergencyCssPath, "utf-8");

  // Check 320px-359px
  assert.ok(css.includes("max-width: 359px"), "Small mobile breakpoint (320px-359px) must be present in EmergencyView.css");
  // Check mobile <= 480px
  assert.ok(css.includes("max-width: 480px"), "Mobile breakpoint (<= 480px) must be present in EmergencyView.css");
  // Check tablet 481px-768px
  assert.ok(css.includes("max-width: 768px"), "Tablet breakpoint (481px-768px) must be present in EmergencyView.css");
  // Check desktop >= 1024px
  assert.ok(css.includes("min-width: 1024px"), "Desktop breakpoint (>= 1024px) must be present in EmergencyView.css");
  // Check ultrawide >= 1920px
  assert.ok(css.includes("min-width: 1920px"), "Ultrawide breakpoint (>= 1920px) must be present in EmergencyView.css");
});

test("App.jsx wraps Metro and SOS in responsive containers with ErrorBoundaries without max-w-md constraint", () => {
  const appJsx = fs.readFileSync(appJsxPath, "utf-8");

  assert.ok(
    appJsx.includes("<MetroErrorBoundary"),
    "MetroErrorBoundary must wrap MetroHome in App.jsx"
  );
  assert.ok(
    appJsx.includes("<EmergencyErrorBoundary"),
    "EmergencyErrorBoundary must wrap EmergencyView in App.jsx"
  );
  assert.ok(
    !appJsx.includes('appMode === "metro" && (\n        <Suspense fallback={<main className="w-full flex-1 max-w-md'),
    "Metro must NOT be wrapped in max-w-md"
  );
  assert.ok(
    !appJsx.includes('appMode === "emergency" && (\n        <Suspense fallback={<main className="w-full flex-1 max-w-md'),
    "Emergency must NOT be wrapped in max-w-md"
  );
});

test("MetroJourney swap button rotates only the icon, not the button text", () => {
  const css = fs.readFileSync(metroHomeCssPath, "utf-8");
  const jsx = fs.readFileSync(metroJourneyJsxPath, "utf-8");

  assert.ok(
    jsx.includes('className="metro-swap-icon"'),
    "Swap button icon must have .metro-swap-icon class"
  );
  assert.ok(
    css.includes(".metro-premium .metro-swap-btn:hover:not(:disabled) .metro-swap-icon"),
    "Only the swap icon rotates on hover"
  );
  assert.ok(
    !css.includes(".metro-premium .metro-swap-btn:hover {\n  background: var(--m-pink-tint);\n  border-color: var(--m-pink-border);\n  transform: rotate(180deg);"),
    "The entire swap button must not rotate"
  );
});

test("EmergencyView includes location permission error handling and copy capability", () => {
  const jsx = fs.readFileSync(emergencyJsxPath, "utf-8");

  assert.ok(
    jsx.includes("handleRequestLiveLocation"),
    "handleRequestLiveLocation must be defined in EmergencyView"
  );
  assert.ok(
    jsx.includes("emergency-loc-error-banner"),
    "emergency-loc-error-banner must be present for location error messages"
  );
  assert.ok(
    jsx.includes("emergency-sos-copy-btn"),
    "Direct copy buttons must be present on top SOS cards"
  );
});

test("Metro SEO: sitemap.xml includes both homepage and /metro", () => {
  const sitemapPath = fileURLToPath(new URL("../public/sitemap.xml", import.meta.url));
  const content = fs.readFileSync(sitemapPath, "utf-8");

  assert.ok(content.includes("<loc>https://jaipur-bus-live.web.app/</loc>"), "Must include root homepage");
  assert.ok(content.includes("<loc>https://jaipur-bus-live.web.app/metro</loc>"), "Must include /metro");
  assert.ok(content.includes("<priority>1.0</priority>"), "Homepage must have 1.0 priority");
  assert.ok(content.includes("<priority>0.9</priority>"), "/metro must have 0.9 priority");
});

test("Metro SEO: App.jsx includes deep-linking, History API navigation, crawlable links and dynamic metadata", () => {
  const appJsx = fs.readFileSync(appJsxPath, "utf-8");

  // Route & Deep linking
  assert.ok(appJsx.includes("window.location.pathname"), "Must inspect pathname for deep linking");
  assert.ok(appJsx.includes("popstate"), "Must listen to popstate for back/forward navigation");
  assert.ok(appJsx.includes('href="/metro"'), "Must provide crawlable href=/metro links");

  // Dynamic Metadata
  assert.ok(
    appJsx.includes("Jaipur Metro Route Map, Fare & Timings | Jaipur Bus Live"),
    "Must set dedicated title for Metro"
  );
  assert.ok(
    appJsx.includes("https://jaipur-bus-live.web.app/metro"),
    "Must set dedicated canonical for Metro"
  );
  assert.ok(
    appJsx.includes("FAQPage"),
    "Must inject FAQPage JSON-LD structured data"
  );
});

test("Metro SEO: MetroHome.jsx contains visible crawlable FAQs matching structured data", () => {
  const metroHome = fs.readFileSync(metroHomeJsxPath, "utf-8");

  assert.ok(
    metroHome.includes("Frequently Asked Questions (FAQ)"),
    "Must render visible FAQ section header"
  );
  assert.ok(
    metroHome.includes("What are the operating timings of Jaipur Metro Pink Line?"),
    "Must visibly answer operating timings question"
  );
  assert.ok(
    metroHome.includes("How many stations are there on the Jaipur Metro Pink Line?"),
    "Must visibly answer station count question"
  );
  assert.ok(
    metroHome.includes("What is the ticket fare for Jaipur Metro?"),
    "Must visibly answer fare question"
  );
});

test("SOS Button Visibility: Hidden in Metro mode, visible in Bus mode, with responsive grid switcher", () => {
  const appJsx = fs.readFileSync(appJsxPath, "utf-8").replace(/\r\n/g, "\n");

  // Verify top navigation grid adapts dynamically between 2 columns (metro) and 3 columns (bus)
  assert.ok(
    appJsx.includes('appMode === "metro" ? "grid-cols-2" : "grid-cols-3"'),
    "Top switcher container must adapt to 2 columns in metro mode and 3 columns in bus mode"
  );

  // Verify SOS button in top switcher is conditioned on appMode !== 'metro'
  assert.ok(
    appJsx.includes('{appMode !== "metro" && (\n          <button\n            type="button"\n            onClick={() => setAppMode("emergency")}\n            aria-label="Switch to Emergency SOS helplines"'),
    "Top switcher SOS button must be conditionally hidden when appMode === 'metro'"
  );

  // Verify SOS button in Info Drawer is conditioned on appMode !== 'metro'
  assert.ok(
    appJsx.includes('{appMode !== "metro" && (\n                  <button\n                    type="button"\n                    onClick={() => {\n                      setAppMode("emergency");\n                      setShowInfoDrawer(false);'),
    "Info drawer SOS button must be conditionally hidden when appMode === 'metro'"
  );
});

test("Metro UI: Redundant Header, Navigation Row, and Route Search are completely hidden in Metro mode", () => {
  const appJsx = fs.readFileSync(appJsxPath, "utf-8").replace(/\r\n/g, "\n");

  // 1. Top header (with JAIPUR METRO brand & JMRC badge) must be conditioned on appMode !== 'metro'
  assert.ok(
    appJsx.includes('{appMode !== "metro" && (\n        <header className="sticky top-0 z-[500] flex h-14 w-full items-center justify-between header-3d px-4 max-w-md mx-auto">'),
    "Top header bar must be conditionally hidden when appMode === 'metro'"
  );

  // 2. Navigation switcher row (Bus, Metro, SOS) must be conditioned on appMode !== 'metro'
  assert.ok(
    appJsx.includes('{appMode !== "metro" && (\n        <div\n          className={`mx-auto grid w-full max-w-md ${'),
    "Transport navigation button row must be conditionally hidden when appMode === 'metro'"
  );

  // 3. Route Search with Live Bus bar must be conditioned on appMode !== 'metro'
  assert.ok(
    appJsx.includes('{appMode !== "metro" && (\n        <div className="w-full max-w-md mx-auto px-4 pt-2.5 pb-3">'),
    "Route Search with Live Bus navigation bar must be conditionally hidden when appMode === 'metro'"
  );
});

test("Metro Hero Card: Exact original dimensions with new Jaipur Metro image, object-fit cover, and no oversized layout", () => {
  const metroHome = fs.readFileSync(metroHomeJsxPath, "utf-8");
  const css = fs.readFileSync(metroHomeCssPath, "utf-8");

  // Hero section preserves .metro-hero card class
  assert.ok(
    metroHome.includes('className="metro-hero"'),
    "MetroHome must render .metro-hero section"
  );
  assert.ok(
    metroHome.includes('/assets/metro/jaipur-metro-guide-hero.webp'),
    "Hero card must link to optimized WebP image"
  );
  assert.ok(
    metroHome.includes('/assets/metro/jaipur-metro-guide-hero.jpg'),
    "Hero card must provide fallback JPEG image"
  );

  // CSS preserves exact card dimensions and uses object-fit: cover
  assert.ok(
    css.includes(".metro-premium .metro-hero {"),
    "CSS must define .metro-hero container"
  );
  assert.ok(
    css.includes("object-fit: cover"),
    "Hero image must use object-fit: cover"
  );
  assert.ok(
    css.includes("object-position: center 12%"),
    "Hero image must adjust object-position appropriately"
  );

  // Old text, heading, kicker, and decorative art removed from inside the card
  assert.ok(!metroHome.includes('className="metro-hero-kicker"'), "Old .metro-hero-kicker must be removed");
  assert.ok(!metroHome.includes('className="metro-hero-art"'), "Old .metro-hero-art must be removed");
  assert.ok(!metroHome.includes('Fast, Clean Transit'), "Old HTML hero heading must be removed");

  // Image files exist on disk
  const webpPath = fileURLToPath(new URL("../public/assets/metro/jaipur-metro-guide-hero.webp", import.meta.url));
  const jpgPath = fileURLToPath(new URL("../public/assets/metro/jaipur-metro-guide-hero.jpg", import.meta.url));
  assert.ok(fs.existsSync(webpPath), "WebP hero image must exist in public assets");
  assert.ok(fs.existsSync(jpgPath), "JPEG hero image must exist in public assets");
});

test("React runtime stability: TelemetryLiveAgeBadge, RouteSearchView, and NearbyBusesView bindings", () => {
  const telemetryBadgePath = fileURLToPath(new URL("../src/components/TelemetryLiveAgeBadge.jsx", import.meta.url));
  const routeSearchViewPath = fileURLToPath(new URL("../src/components/RouteSearchView.jsx", import.meta.url));
  const nearbyBusesViewPath = fileURLToPath(new URL("../src/components/NearbyBusesView.jsx", import.meta.url));

  assert.ok(fs.existsSync(telemetryBadgePath), "TelemetryLiveAgeBadge.jsx must exist");
  const badgeContent = fs.readFileSync(telemetryBadgePath, "utf-8");
  assert.ok(badgeContent.includes("export function TelemetryLiveAgeBadge"), "TelemetryLiveAgeBadge must be exported");

  const routeSearchContent = fs.readFileSync(routeSearchViewPath, "utf-8");
  assert.ok(routeSearchContent.includes("import TelemetryLiveAgeBadge from \"./TelemetryLiveAgeBadge\""), "RouteSearchView must import TelemetryLiveAgeBadge");
  assert.ok(routeSearchContent.includes("function findBusStopContext"), "RouteSearchView must define findBusStopContext");
  assert.ok(routeSearchContent.includes("function calculateDistanceKm"), "RouteSearchView must define calculateDistanceKm");
  assert.ok(routeSearchContent.includes("lastTelemetryUpdate"), "RouteSearchView must receive lastTelemetryUpdate");
  assert.ok(routeSearchContent.includes("loadUniversalRoute"), "RouteSearchView must receive loadUniversalRoute");

  const nearbyBusesContent = fs.readFileSync(nearbyBusesViewPath, "utf-8");
  assert.ok(nearbyBusesContent.includes("function formatDistance"), "NearbyBusesView must define formatDistance");
  assert.ok(nearbyBusesContent.includes("cleanRouteCode"), "NearbyBusesView must define cleanRouteCode");
  assert.ok(nearbyBusesContent.includes("openRouteSearch"), "NearbyBusesView must receive openRouteSearch");
  assert.ok(nearbyBusesContent.includes("availableRoutes"), "NearbyBusesView must receive availableRoutes");

  const nearbyStopsViewPath = fileURLToPath(new URL("../src/components/NearbyStopsView.jsx", import.meta.url));
  const nearbyStopsContent = fs.readFileSync(nearbyStopsViewPath, "utf-8");
  assert.ok(nearbyStopsContent.includes("String(stop.latitude ?? \"\").slice"), "NearbyStopsView must safely convert stop coordinates to string before slicing");
});

test("React JSX property compliance: fetchPriority must be camelCase in JSX", () => {
  const appJsx = fs.readFileSync(appJsxPath, "utf-8");
  const metroHome = fs.readFileSync(metroHomeJsxPath, "utf-8");

  assert.ok(appJsx.includes('fetchPriority="high"'), "App.jsx must use camelCase fetchPriority");
  assert.ok(!appJsx.includes('fetchpriority="high"'), "App.jsx must not use lowercase fetchpriority in JSX");

  assert.ok(metroHome.includes('fetchPriority="high"'), "MetroHome.jsx must use camelCase fetchPriority");
  assert.ok(!metroHome.includes('fetchpriority="high"'), "MetroHome.jsx must not use lowercase fetchpriority in JSX");
});

test("Metro PageSpeed Optimizations: WebP size (60-90KB), responsive srcSet, LCP preloads, OpenStreetMap deferral, and A11y", () => {
  const webpPath = fileURLToPath(new URL("../public/assets/metro/jaipur-metro-guide-hero.webp", import.meta.url));
  const mobileWebpPath = fileURLToPath(new URL("../public/assets/metro/jaipur-metro-guide-hero-mobile.webp", import.meta.url));
  const metroHomeJsx = fs.readFileSync(metroHomeJsxPath, "utf-8");
  const metroMapJsx = fs.readFileSync(fileURLToPath(new URL("../src/metro/MetroMap.jsx", import.meta.url)), "utf-8");
  const metroCss = fs.readFileSync(metroHomeCssPath, "utf-8");
  const indexHtml = fs.readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf-8");

  // 1. Image compression (Target: 60-90 KB maximum)
  const webpSize = fs.statSync(webpPath).size;
  assert.ok(webpSize >= 60 * 1024 && webpSize <= 90 * 1024, `WebP image must be between 60KB and 90KB (actual: ${(webpSize / 1024).toFixed(1)} KB)`);

  // Mobile WebP variant
  const mobileWebpSize = fs.statSync(mobileWebpPath).size;
  assert.ok(mobileWebpSize <= 50 * 1024, `Mobile WebP must be under 50KB for fast mobile LCP (actual: ${(mobileWebpSize / 1024).toFixed(1)} KB)`);

  // Responsive srcSet and sizes in picture element
  assert.ok(metroHomeJsx.includes('srcSet="/assets/metro/jaipur-metro-guide-hero-mobile.webp 480w'), "Hero picture must include mobile 480w variant");
  assert.ok(metroHomeJsx.includes('sizes="(max-width: 600px) 480px'), "Hero picture must specify responsive sizes");
  assert.ok(metroHomeJsx.includes('fetchPriority="high"'), "Hero image must preserve high fetchPriority");

  // 2. Preloads in index.html
  assert.ok(indexHtml.includes('rel="preload" href="/assets/metro/jaipur-metro-guide-hero-mobile.webp" as="image" type="image/webp" fetchpriority="high" media="(max-width: 600px)"'), "Must preload mobile hero image in index.html");
  assert.ok(indexHtml.includes('rel="preload" href="/assets/metro/jaipur-metro-guide-hero.webp" as="image" type="image/webp" fetchpriority="high" media="(min-width: 601px)"'), "Must preload desktop hero image in index.html");

  // 3. OpenStreetMap viewport-deferred initialization
  assert.ok(metroMapJsx.includes("IntersectionObserver"), "MetroMap must use IntersectionObserver to defer tile requests until in/near viewport");
  assert.ok(metroMapJsx.includes("mapInView"), "MetroMap must gate map initialization on mapInView state");

  // 4. Accessibility: Heading hierarchy
  assert.ok(metroHomeJsx.includes("<h1>Jaipur Metro Guide</h1>"), "Must have main H1");
  assert.ok(metroHomeJsx.includes('<h2 className="metro-section-title">Pink Line Corridor Tools</h2>'), "Corridor tools section must be H2");
  assert.ok(metroHomeJsx.includes("<h2>Explore All 11 Stations</h2>"), "Stations panel must be H2");
  assert.ok(metroHomeJsx.includes("<h2>Official JMRC Fare Slabs</h2>"), "Fare slabs must be H2");
  assert.ok(metroHomeJsx.includes("<h2>Frequently Asked Questions (FAQ)</h2>"), "FAQ section must be H2");

  // 5. Accessibility: WCAG contrast and touch targets
  assert.ok(metroCss.includes("--m-text-muted: #4e635c;"), "--m-text-muted must have WCAG AA compliant contrast ratio (>4.5:1)");
  assert.ok(metroCss.includes(".metro-premium .metro-back-button {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  min-height: 44px;"), "Back button must have minimum 44px touch target height");
  assert.ok(metroCss.includes("min-height: 44px;"), "Must include min-height 44px touch target rules");
});





