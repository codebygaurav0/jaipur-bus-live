import { useCallback, useEffect, useRef, useState, useMemo, lazy, Suspense } from "react";
import "./App.css";
import { apiUrl } from "./apiBase";

const LiveBusMap = lazy(() => import("./components/LiveBusMap"));
const MetroHome = lazy(() => import("./metro/MetroHome"));
if (typeof window !== "undefined" && window.location.pathname.startsWith("/metro")) {
  import("./metro/MetroHome");
}
const EmergencyView = lazy(() => import("./components/EmergencyView"));
const SupportView = lazy(() => import("./components/SupportView"));
const RouteSearchView = lazy(() => import("./components/RouteSearchView"));
const NearbyStopsView = lazy(() => import("./components/NearbyStopsView"));
const NearbyBusesView = lazy(() => import("./components/NearbyBusesView"));
import MetroErrorBoundary from "./metro/MetroErrorBoundary";
import MetroSuspenseSkeleton from "./metro/MetroSuspenseSkeleton";
import EmergencyErrorBoundary from "./components/EmergencyErrorBoundary";

import TelemetryLiveAgeBadge from "./components/TelemetryLiveAgeBadge";
export { TelemetryLiveAgeBadge };

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(distKm) {
  if (distKm === null || distKm === undefined || isNaN(distKm)) return "—";
  if (distKm < 1) return `${Math.round(distKm * 1000)} m`;
  return `${distKm.toFixed(1)} km`;
}

// Normalization functions
const cleanRouteCode = (str) =>
  String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[-\s]/g, "");

const cleanText = (str) =>
  String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");

function findBusStopContext(busLat, busLng, orderedStops) {
  if (!orderedStops || orderedStops.length === 0 || isNaN(busLat) || isNaN(busLng)) {
    return {
      nearestStop: "Unknown Stop",
      distanceKm: null,
      prevStop: null,
      nextStop: null,
      nearestIndex: -1,
    };
  }

  let minDistance = Infinity;
  let nearestIndex = -1;

  for (let i = 0; i < orderedStops.length; i++) {
    const s = orderedStops[i];
    const sLat = parseFloat(s.latitude);
    const sLng = parseFloat(s.longitude);
    if (isNaN(sLat) || isNaN(sLng) || sLat === 0 || sLng === 0) continue;

    const dist = calculateDistanceKm(busLat, busLng, sLat, sLng);
    if (dist < minDistance) {
      minDistance = dist;
      nearestIndex = i;
    }
  }

  if (nearestIndex === -1) {
    return {
      nearestStop: "Unknown Stop",
      distanceKm: null,
      prevStop: null,
      nextStop: null,
      nearestIndex: -1,
    };
  }

  const nearestStop = orderedStops[nearestIndex];
  const prevStop = nearestIndex > 0 ? orderedStops[nearestIndex - 1] : null;
  const nextStop =
    nearestIndex < orderedStops.length - 1 ? orderedStops[nearestIndex + 1] : null;

  return {
    nearestStop: nearestStop.bus_stop || nearestStop.bus_stop_name || nearestStop.stop_name || "Unknown Stop",
    distanceKm: minDistance,
    prevStop: prevStop ? prevStop.bus_stop || prevStop.bus_stop_name || prevStop.stop_name || null : null,
    nextStop: nextStop ? nextStop.bus_stop || nextStop.bus_stop_name || nextStop.stop_name || null : null,
    nearestIndex,
  };
}

export default function App() {
  const mapInstance = useRef(null);
  const liveBusFetchInFlight = useRef(false);
  const liveBusLastPollSucceeded = useRef(null);
  const [selectedBusNumber, setSelectedBusNumber] = useState(null);
  const [followSelectedBus, setFollowSelectedBus] = useState(false);
  const [focusedStop, setFocusedStop] = useState(null);

  // =========================================================
  // App State & Route Synchronization
  // =========================================================
  const getInitialAppMode = () => {
    if (typeof window !== "undefined") {
      const path = window.location.pathname.toLowerCase().replace(/\/+$/, "");
      if (path === "/metro" || path === "/pages/jaipur-metro-guide") {
        return "metro";
      }
    }
    return "bus";
  };

  const [appMode, setAppMode] = useState(getInitialAppMode);

  const navigateToMode = (mode, push = true) => {
    setAppMode(mode);
    if (typeof window !== "undefined" && window.history) {
      const targetPath = mode === "metro" ? "/metro" : "/";
      const currentPath = window.location.pathname.toLowerCase().replace(/\/+$/, "") || "/";
      const expectedPath = targetPath === "/" ? "/" : targetPath;
      if (currentPath !== expectedPath) {
        if (push) {
          window.history.pushState({ mode }, "", targetPath);
        } else {
          window.history.replaceState({ mode }, "", targetPath);
        }
      }
    }
  };

  // Browser Back / Forward History Navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase().replace(/\/+$/, "");
      if (path === "/metro" || path === "/pages/jaipur-metro-guide") {
        setAppMode("metro");
      } else {
        setAppMode("bus");
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Idle prefetch of Metro module to ensure zero-CLS SPA navigation
  useEffect(() => {
    if (typeof window === "undefined" || appMode === "metro") return;
    const preload = () => {
      import("./metro/MetroHome");
    };
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(preload, { timeout: 3000 });
      return () => window.cancelIdleCallback(handle);
    } else {
      const timer = setTimeout(preload, 2000);
      return () => clearTimeout(timer);
    }
  }, [appMode]);

  // Dynamic SEO Metadata & Structured Data Synchronization
  useEffect(() => {
    if (typeof document === "undefined") return;

    if (appMode === "metro") {
      document.title = "Jaipur Metro Route Map, Fare & Timings | Jaipur Bus Live";

      const updateMeta = (selector, attr, val) => {
        let el = document.querySelector(selector);
        if (!el) {
          el = document.createElement("meta");
          if (selector.startsWith('meta[name="')) {
            el.setAttribute("name", selector.slice(11, -2));
          } else if (selector.startsWith('meta[property="')) {
            el.setAttribute("property", selector.slice(15, -2));
          }
          document.head.appendChild(el);
        }
        el.setAttribute(attr, val);
      };

      const updateLink = (rel, href) => {
        let el = document.querySelector(`link[rel="${rel}"]`);
        if (!el) {
          el = document.createElement("link");
          el.setAttribute("rel", rel);
          document.head.appendChild(el);
        }
        el.setAttribute("href", href);
      };

      updateMeta('meta[name="description"]', "content", "Explore Jaipur Metro routes, Pink Line stations, fares, timings and an easy journey planner. Find stations and travel across Jaipur with Jaipur Bus Live.");
      updateLink("canonical", "https://jaipur-bus-live.web.app/metro");
      updateMeta('meta[name="robots"]', "content", "index, follow");
      updateMeta('meta[property="og:type"]', "content", "website");
      updateMeta('meta[property="og:site_name"]', "content", "Jaipur Bus Live");
      updateMeta('meta[property="og:locale"]', "content", "en_IN");
      updateMeta('meta[property="og:title"]', "content", "Jaipur Metro Route Map, Fare & Timings | Jaipur Bus Live");
      updateMeta('meta[property="og:description"]', "content", "Explore Jaipur Metro routes, Pink Line stations, fares, timings and an easy journey planner. Find stations and travel across Jaipur with Jaipur Bus Live.");
      updateMeta('meta[property="og:url"]', "content", "https://jaipur-bus-live.web.app/metro");
      updateMeta('meta[property="og:image"]', "content", "https://jaipur-bus-live.web.app/assets/metro/jaipur-metro-guide-hero.jpg");
      updateMeta('meta[property="og:image:alt"]', "content", "Jaipur Metro Pink Line route map, stations, timings and journey planner on Jaipur Bus Live");
      updateMeta('meta[name="twitter:card"]', "content", "summary_large_image");
      updateMeta('meta[name="twitter:title"]', "content", "Jaipur Metro Route Map, Fare & Timings | Jaipur Bus Live");
      updateMeta('meta[name="twitter:description"]', "content", "Explore Jaipur Metro routes, Pink Line stations, fares, timings and an easy journey planner. Find stations and travel across Jaipur with Jaipur Bus Live.");
      updateMeta('meta[name="twitter:image"]', "content", "https://jaipur-bus-live.web.app/assets/metro/jaipur-metro-guide-hero.jpg");
      updateMeta('meta[name="twitter:image:alt"]', "content", "Jaipur Metro Pink Line route map, stations, timings and journey planner on Jaipur Bus Live");

      // Add Metro Structured Data (WebPage + FAQPage)
      let metroScript = document.getElementById("metro-structured-data");
      if (!metroScript) {
        metroScript = document.createElement("script");
        metroScript.id = "metro-structured-data";
        metroScript.type = "application/ld+json";
        document.head.appendChild(metroScript);
      }
      metroScript.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebPage",
            "@id": "https://jaipur-bus-live.web.app/metro#webpage",
            "url": "https://jaipur-bus-live.web.app/metro",
            "name": "Jaipur Metro Route Map, Fare & Timings | Jaipur Bus Live",
            "description": "Explore Jaipur Metro routes, Pink Line stations, fares, timings and an easy journey planner. Find stations and travel across Jaipur with Jaipur Bus Live.",
            "isPartOf": {
              "@type": "WebSite",
              "@id": "https://jaipur-bus-live.web.app/#website",
              "name": "Jaipur Bus Live",
              "url": "https://jaipur-bus-live.web.app/"
            }
          },
          {
            "@type": "FAQPage",
            "mainEntity": [
              {
                "@type": "Question",
                "name": "What are the operating timings of Jaipur Metro Pink Line?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Jaipur Metro operates daily from 06:20 AM to 09:50 PM. Peak frequency is every 10–12 minutes, and off-peak frequency is every 15 minutes between Mansarovar and Badi Chaupar."
                }
              },
              {
                "@type": "Question",
                "name": "How many stations are there on the Jaipur Metro Pink Line?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "The Jaipur Metro Pink Line consists of 11 stations over 11.97 km: Mansarovar, New Aatish Market, Vivek Vihar, Shyam Nagar, Ram Nagar, Civil Lines, Railway Station, Sindhi Camp, Chandpole, Chhoti Chaupar, and Badi Chaupar (8 elevated and 3 underground stations)."
                }
              },
              {
                "@type": "Question",
                "name": "What is the ticket fare for Jaipur Metro?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Jaipur Metro single token fares range from ₹6 for 1–2 stations, ₹12 for 3–5 stations, ₹18 for 6–8 stations, up to ₹22 for 9 or more stations. JMRC Smart Card users receive an automatic 10% discount on every journey."
                }
              },
              {
                "@type": "Question",
                "name": "Where can I interchange between Jaipur Metro, Indian Railways, and Bus Stand?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Railway Station metro station provides direct access to Jaipur Junction Railway Station, while Sindhi Camp metro station connects directly to Sindhi Camp Central Bus Stand."
                }
              },
              {
                "@type": "Question",
                "name": "How long does it take to travel the entire Jaipur Metro Pink Line?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "The end-to-end journey from Mansarovar to Badi Chaupar covers 11.97 km and takes approximately 24 to 34 minutes."
                }
              }
            ]
          }
        ]
      });
    } else {
      // Restore Bus Homepage Baseline Metadata
      document.title = "Jaipur Bus Live  JCTSL Live Bus Tracking & Jaipur Metro";

      const updateMeta = (selector, attr, val) => {
        const el = document.querySelector(selector);
        if (el) el.setAttribute(attr, val);
      };

      const updateLink = (rel, href) => {
        const el = document.querySelector(`link[rel="${rel}"]`);
        if (el) el.setAttribute("href", href);
      };

      updateMeta('meta[name="description"]', "content", "Jaipur Bus Live helps you track JCTSL buses with real-time GPS, search bus routes and nearby stops, and explore Jaipur Metro stations, routes, fares and journey information.");
      updateLink("canonical", "https://jaipur-bus-live.web.app/");
      updateMeta('meta[name="robots"]', "content", "index, follow");
      updateMeta('meta[property="og:type"]', "content", "website");
      updateMeta('meta[property="og:site_name"]', "content", "Jaipur Bus Live");
      updateMeta('meta[property="og:locale"]', "content", "en_IN");
      updateMeta('meta[property="og:title"]', "content", "Jaipur Bus Live - JCTSL Live Bus Tracking & Jaipur Metro");
      updateMeta('meta[property="og:description"]', "content", "Track Jaipur JCTSL buses, find routes and nearby stops, and explore Jaipur Metro information.");
      updateMeta('meta[property="og:url"]', "content", "https://jaipur-bus-live.web.app/");
      updateMeta('meta[property="og:image"]', "content", "https://jaipur-bus-live.web.app/jaipur-bus-live-logo.webp");
      updateMeta('meta[property="og:image:alt"]', "content", "Jaipur Bus Live logo");
      updateMeta('meta[name="twitter:card"]', "content", "summary");
      updateMeta('meta[name="twitter:title"]', "content", "Jaipur Bus Live - JCTSL Bus Tracking & Jaipur Metro");
      updateMeta('meta[name="twitter:description"]', "content", "Jaipur bus tracking, routes, nearby stops and Jaipur Metro information.");
      updateMeta('meta[name="twitter:image"]', "content", "https://jaipur-bus-live.web.app/jaipur-bus-live-logo.webp");
      updateMeta('meta[name="twitter:image:alt"]', "content", "Jaipur Bus Live logo");

      // Remove Metro Structured Data script
      const metroScript = document.getElementById("metro-structured-data");
      if (metroScript && metroScript.parentNode) {
        metroScript.parentNode.removeChild(metroScript);
      }
    }
  }, [appMode]);
  const [currentView, setCurrentView] = useState("home"); // "home" | "routeSearch" | "nearbyStops" | "nearbyBuses"
  const [location, setLocation] = useState({ lat: 26.9124, lng: 75.7873 });
  const [hasUserLocation, setHasUserLocation] = useState(false);

  // Real JCTSL Stops & Routes Data
  const [allStops, setAllStops] = useState([]);
  const [stopsLoading, setStopsLoading] = useState(true);
  const [availableRoutes, setAvailableRoutes] = useState([]);
  const [routesLoading, setRoutesLoading] = useState(true);

  // Real City Live Buses Telemetry
  const [cityLiveBuses, setCityLiveBuses] = useState([]);
  const [cityLiveBusesLoading, setCityLiveBusesLoading] = useState(false);
  const [cityLiveBusesError, setCityLiveBusesError] = useState("");
  const [cityLiveBusesSource, setCityLiveBusesSource] = useState("unavailable");
  const [lastTelemetryUpdate, setLastTelemetryUpdate] = useState("");



  // Selected Stop Details (for Nearby Stops view)
  const [selectedStop, setSelectedStop] = useState(null);
  const [stopBuses, setStopBuses] = useState([]);
  const [stopBusesError, setStopBusesError] = useState(false);
  const [stopBusesLoading, setStopBusesLoading] = useState(false);
  const [stopDetailsOpen, setStopDetailsOpen] = useState(false);

  // Stop Search in Nearby Stops View
  const [stopsSearchQuery, setStopsSearchQuery] = useState("");

  // Buses Search in Nearby Buses View
  const [busesSearchQuery, setBusesSearchQuery] = useState("");

  // Journey Planner (From / To)
  const [sourceText, setSourceText] = useState("");
  const [fromStop, setFromStop] = useState(null);
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [destText, setDestText] = useState("");
  const [toStop, setToStop] = useState(null);
  const [showDestDropdown, setShowDestDropdown] = useState(false);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [routingSearched, setRoutingSearched] = useState(false);
  const [journeyRoutes, setJourneyRoutes] = useState([]);
  const [connectingJourneys, setConnectingJourneys] = useState([]);
  const [expandedRouteKey, setExpandedRouteKey] = useState(null);
  const [routingMessage, setRoutingMessage] = useState("");

  // Universal Route Search View
  const [universalSearchQuery, setUniversalSearchQuery] = useState("");
  const [showUniversalDropdown, setShowUniversalDropdown] = useState(false);
  const [selectedUniversalRoute, setSelectedUniversalRoute] = useState(null);
  const [universalRouteMap, setUniversalRouteMap] = useState(null);
  const [universalLiveBuses, setUniversalLiveBuses] = useState([]);
  const [universalRouteSource, setUniversalRouteSource] = useState("unavailable");
  const [universalRouteLoading, setUniversalRouteLoading] = useState(false);
  const [universalRouteError, setUniversalRouteError] = useState("");

  // Favorites & Info Drawer
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("jbl_favs") || "[]");
    } catch {
      return [];
    }
  });
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);

  // Route stop index cache ref: route_id -> stops array
  const routeStopsCacheRef = useRef({});

  // Sync favorites to localStorage
  useEffect(() => {
    localStorage.setItem("jbl_favs", JSON.stringify(favorites));
  }, [favorites]);

  const toggleFavorite = (routeOrgNo) => {
    if (!routeOrgNo) return;
    setFavorites((prev) =>
      prev.includes(routeOrgNo)
        ? prev.filter((r) => r !== routeOrgNo)
        : [...prev, routeOrgNo]
    );
  };

  // =========================================================
  // 3. API FETCH FUNCTIONS (Backend proxy to real JCTSL)
  // =========================================================
  const fetchBusStops = useCallback(async () => {
    try {
      setStopsLoading(true);
      const res = await fetch(apiUrl("/api/bus-stops"));
      const data = await res.json();
      if (Array.isArray(data?.respData)) {
        setAllStops(data.respData);
      }
    } catch (err) {
      console.warn("Bus stops error:", err);
    } finally {
      setStopsLoading(false);
    }
  }, []);

  const fetchAvailableRoutes = useCallback(async () => {
    try {
      setRoutesLoading(true);
      const res = await fetch(apiUrl("/api/routes"));
      const data = await res.json();
      if (Array.isArray(data?.respData)) {
        setAvailableRoutes(data.respData);
      }
    } catch (err) {
      console.warn("Routes error:", err);
    } finally {
      setRoutesLoading(false);
    }
  }, []);

  const fetchCityLiveBuses = useCallback(async () => {
    if (liveBusFetchInFlight.current) return;
    liveBusFetchInFlight.current = true;
    try {
      setCityLiveBusesLoading(true);
      setCityLiveBusesError("");
      const res = await fetch(apiUrl("/api/live-buses"));
      const data = await res.json();
      const buses = Array.isArray(data?.respData) ? data.respData : [];
      const successfulResponse = res.ok &&
        data?.success !== false &&
        String(data?.respCode) === "200" &&
        Array.isArray(data?.respData);
      liveBusLastPollSucceeded.current = successfulResponse;

      if (successfulResponse) {
        setCityLiveBuses(buses);
        const source = data.isFallback
          ? "fallback"
          : data.isCached || data.upstreamReachable !== true
            ? "cached"
            : "live";
        setCityLiveBusesSource(source);
        const updatedAt = data.cacheTimestamp ||
          data.summary?.lastUpdated ||
          data.timestamp;
        const updatedDate = updatedAt ? new Date(updatedAt) : null;
        setLastTelemetryUpdate(
          updatedDate && Number.isFinite(updatedDate.getTime())
            ? updatedDate.toISOString()
            : ""
        );
      } else {
        setCityLiveBuses([]);
        setCityLiveBusesSource("unavailable");
        setLastTelemetryUpdate("");
        setCityLiveBusesError("Unable to fetch live data");
      }
    } catch (err) {
      liveBusLastPollSucceeded.current = false;
      console.warn("City live buses error:", err);
      setCityLiveBuses([]);
      setCityLiveBusesSource("unavailable");
      setLastTelemetryUpdate("");
      setCityLiveBusesError("Unable to fetch live data");
    } finally {
      liveBusFetchInFlight.current = false;
      setCityLiveBusesLoading(false);
    }
  }, []);

  // =========================================================
  // 2. INITIAL DATA LOAD & REFRESH INTERVAL
  // =========================================================
  useEffect(() => {
    if (appMode === "metro") return;

    const initialLiveFetch = setTimeout(fetchCityLiveBuses, 0);

    const secondaryDataTimer = setTimeout(() => {
      fetchBusStops();
      fetchAvailableRoutes();
    }, 600);

    const refreshInterval = setInterval(fetchCityLiveBuses, 25000);

    return () => {
      clearTimeout(initialLiveFetch);
      clearTimeout(secondaryDataTimer);
      clearInterval(refreshInterval);
    };
  }, [appMode, fetchAvailableRoutes, fetchBusStops, fetchCityLiveBuses]);

  const fetchBusesNearStop = async (stop) => {
    if (!stop) return;
    const stopCode = stop.bus_stop_code || stop.stop_code || stop.bus_stop_cd;
    if (!stopCode) return;

    try {
      setStopBusesLoading(true);
      setStopBusesError(false);
      const res = await fetch(
        apiUrl(`/api/buses-near-stop/${encodeURIComponent(stopCode)}`)
      );
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        setStopBuses([]);
        setStopBusesError(true);
        return;
      }
      const list = Array.isArray(data?.respData)
        ? data.respData
        : Array.isArray(data?.respData?.buses)
        ? data.respData.buses
        : [];
      setStopBuses(list);
    } catch (err) {
      console.warn("Buses near stop error:", err);
      setStopBuses([]);
      setStopBusesError(true);
    } finally {
      setStopBusesLoading(false);
    }
  };

  // =========================================================
  // 4. SORTED NEARBY STOPS (Computed with Haversine)
  // =========================================================
  const nearbyStops = useMemo(() => {
    if (appMode === "metro" || !allStops.length) return [];
    return [...allStops]
      .map((s) => {
        const lat = parseFloat(s.latitude);
        const lon = parseFloat(s.longitude);
        const distKm =
          !isNaN(lat) && !isNaN(lon) && lat !== 0
            ? calculateDistanceKm(location.lat, location.lng, lat, lon)
            : Infinity;
        return { ...s, distanceKm: distKm };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }, [appMode, allStops, location]);

  const locateMe = () => {
    if (!mapInstance.current) return;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setLocation({ lat, lng });
          setHasUserLocation(true);
          mapInstance.current.setView([lat, lng], 15);
        },
        () => {
          mapInstance.current.setView([location.lat, location.lng], 14);
        }
      );
    } else {
      mapInstance.current.setView([location.lat, location.lng], 14);
    }
  };

  // =========================================================
  // 6. STOP DETAILS HANDLERS
  // =========================================================
  const openStopDetails = (stop) => {
    setSelectedStop(stop);
    setStopDetailsOpen(true);
    fetchBusesNearStop(stop);
  };

  const showStopOnMap = (stop) => {
    if (!stop) return;
    const lat = parseFloat(stop.latitude);
    const lng = parseFloat(stop.longitude);
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0) {
      setCurrentView("home");
      setStopDetailsOpen(false);
      setFocusedStop(stop);
    }
  };

  // =========================================================
  // 7. AUTOCOMPLETE FILTER LOGIC (Whitespace & Case Tolerant)
  // =========================================================
  const filterStops = (query) => {
    const raw = String(query || "").trim().toLowerCase();
    if (!raw) return [];
    const qClean = cleanText(raw);
    const tokens = raw.split(/\s+/).filter(Boolean);

    return allStops
      .filter((s) => {
        const name = String(s.bus_stop_name || "").toLowerCase();
        const code = String(s.bus_stop_code || "").toLowerCase();
        const nameClean = cleanText(name);

        const tokenMatch = tokens.every(
          (t) => name.includes(t) || code.includes(t)
        );
        const cleanMatch = qClean && nameClean.includes(qClean);
        return tokenMatch || cleanMatch;
      })
      .slice(0, 10);
  };

  const sourceMatches = filterStops(sourceText);
  const destMatches = filterStops(destText);

  // =========================================================
  // 8. JOURNEY PLANNER SEARCH & DIRECTION LOGIC
  // =========================================================
  const handleSwapStops = () => {
    const tmpFrom = fromStop;
    const tmpSrc = sourceText;
    setFromStop(toStop);
    setSourceText(destText);
    setToStop(tmpFrom);
    setDestText(tmpSrc);
    if (routingSearched) {
      findRoutesBetweenStops(toStop, tmpFrom);
    }
  };

  const findRoutesBetweenStops = async (origin, dest) => {
    if (!origin || !dest) return;
    try {
      setRoutingLoading(true);
      setRoutingSearched(true);
      setJourneyRoutes([]);
      setConnectingJourneys([]);
      setExpandedRouteKey(null);
      setRoutingMessage("");

      const fromCode = origin.bus_stop_code || origin.bus_stop_id || origin.bus_stop_name;
      const toCode = dest.bus_stop_code || dest.bus_stop_id || dest.bus_stop_name;

      // Call strictly validated backend route matcher
      const res = await fetch(apiUrl("/api/routes-between-stops"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_bus_stop_id: fromCode,
          to_bus_stop_id: toCode,
        }),
      });

      const data = await res.json();
      const validRoutes = Array.isArray(data?.routes) ? data.routes : [];
      const connections = Array.isArray(data?.connecting_journeys) ? data.connecting_journeys : [];

      setJourneyRoutes(validRoutes);
      setConnectingJourneys(connections);
      setRoutingMessage(
        data?.message ||
          (validRoutes.length === 0 && connections.length === 0
            ? "No direct or connecting JCTSL routes found"
            : "")
      );
    } catch (err) {
      console.warn("Routes between stops error:", err);
      setJourneyRoutes([]);
      setConnectingJourneys([]);
      setRoutingMessage("Error connecting to live route verification service.");
    } finally {
      setRoutingLoading(false);
    }
  };

  // =========================================================
  // 9. UNIVERSAL REAL ROUTE SEARCH ALGORITHM
  // Case-insensitive, whitespace-tolerant, hyphen-tolerant
  // Exact Route Distinction: e3 matches E-3, never E-32!
  // =========================================================
  const getUniversalSearchResults = (query) => {
    const raw = String(query || "").trim();
    if (!raw) {
      return { routeGroups: [], busMatches: [], hasQuery: false };
    }

    const qRoute = cleanRouteCode(raw);
    const qClean = cleanText(raw);
    const qNorm = raw.toLowerCase();

    // 1. Route Number Exact Match (e.g. 6a, 6 a, 6-a, e3, e 3, ac7)
    // Distinguishes complete route numbers so e3 does NOT match e32!
    const exactRouteMatches = availableRoutes.filter((r) => {
      const rCode = cleanRouteCode(r.route_orgno);
      const idCode = cleanRouteCode(r.route_id);
      return rCode === qRoute || idCode === qRoute;
    });

    // 2. Keyword / Name / Partial Search
    const matchedRoutes = exactRouteMatches.length > 0
      ? exactRouteMatches
      : availableRoutes.filter((r) => {
        const nameNorm = String(r.route_name || "").toLowerCase();
        const nameClean = cleanText(r.route_name);
        const orgCode = cleanRouteCode(r.route_orgno);

        return (
          orgCode.includes(qRoute) ||
          nameNorm.includes(qNorm) ||
          nameClean.includes(qClean)
        );
      });

    // Group matching routes by clean route org number so BOTH DIRECTIONS are shown together!
    const groupMap = new Map();
    matchedRoutes.forEach((r) => {
      const key = cleanRouteCode(r.route_orgno) || String(r.route_id);
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          route_orgno: r.route_orgno,
          directions: [],
        });
      }
      groupMap.get(key).directions.push(r);
    });

    const routeGroups = Array.from(groupMap.values());

    // 3. Live bus vehicle number matching (e.g. RJ14PE5909 or 5909)
    const busMatches = cityLiveBuses.filter((b) => {
      const vehNo = String(b.vehno || "").toLowerCase();
      const cleanVeh = cleanText(vehNo);
      return vehNo.includes(qNorm) || cleanVeh.includes(qClean);
    });

    return {
      routeGroups,
      busMatches,
      hasQuery: true,
    };
  };

  // =========================================================
  // 10. LOAD UNIVERSAL ROUTE & TIMELINE
  // =========================================================
  const loadUniversalRoute = useCallback(async (route, resetMapView = true) => {
    if (!route) return;
    try {
      if (resetMapView) setUniversalRouteLoading(true);
      setUniversalRouteError("");
      setUniversalRouteSource("unavailable");

      const routeId = String(route.route_id);

      // Fetch route map (stops & polyline) and live route upcoming buses
      const readApiResponse = async (response) => {
        const data = await response.json();
        if (!response.ok || data?.success === false || data?.dataAvailable === false) {
          throw new Error("Route data unavailable");
        }
        return data;
      };
      const [mapRes, liveRes] = await Promise.allSettled([
        fetch(apiUrl("/api/route-map"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ route_no: routeId }),
        }).then(readApiResponse),
        fetch(apiUrl("/api/live-route"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ route_id: routeId }),
        }).then(readApiResponse),
      ]);

      const mapResponse = mapRes.status === "fulfilled" ? mapRes.value : null;
      const liveResponse = liveRes.status === "fulfilled" ? liveRes.value : null;
      const mapData = mapResponse?.respData;
      const liveData = liveResponse?.respData;

      // Extract ordered stops from either mapData or liveData
      let orderedStops = [];
      const mapStops = Array.isArray(mapData)
        ? mapData
        : mapData?.bus_stop_list;
      const liveRouteStops = Array.isArray(liveData?.route)
        ? liveData.route
        : Array.isArray(liveData?.stops)
          ? liveData.stops
          : [];
      const sourceStops = Array.isArray(mapStops) && mapStops.length > 0
        ? mapStops
        : liveRouteStops;
      if (sourceStops.length > 0) {
        orderedStops = sourceStops.map((s, idx) => ({
          ...s,
          bus_stop: s.bus_stop || s.bus_stop_name || s.stop_name || s.stopName || s.busStopName || s.name || s.stopname,
          route_order: s.route_order || s.bus_stop_order || s.order || String(idx + 1),
        })).filter((stop) => Boolean(stop.bus_stop));
      }

      if ((mapRes.status === "rejected" && liveRes.status === "rejected") ||
          orderedStops.length === 0) {
        setUniversalRouteMap(null);
        setUniversalLiveBuses([]);
        setUniversalRouteSource("unavailable");
        setUniversalRouteError("Route information is temporarily unavailable.");
        return;
      }

      setUniversalRouteMap({
        ...(mapData && !Array.isArray(mapData) ? mapData : {}),
        bus_stop_list: orderedStops,
      });

      // Cache stops for this route
      routeStopsCacheRef.current[routeId] = orderedStops;

      // Extract ALL live buses for this direction
      const busesMap = new Map();
      if (!liveResponse?.isFallback && Array.isArray(liveData?.route)) {
        liveData.route.forEach((st) => {
          if (Array.isArray(st.upcomingbuses)) {
            st.upcomingbuses.forEach((b) => {
              const vNo = String(
                b.vehicel_no || b.vehicle_no || b.vehNo || ""
              ).trim();
              const vehicleKey = vNo.toUpperCase();
              if (vNo && !busesMap.has(vehicleKey)) {
                const lat = Number(b.latitude);
                const lng = Number(b.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
                    lat < 25 || lat > 29 || lng < 74 || lng > 78) return;
                const stopCtx = findBusStopContext(lat, lng, orderedStops);

                busesMap.set(vehicleKey, {
                  vehicle_number: vNo,
                  latitude: lat,
                  longitude: lng,
                  eta: b.eta && b.eta !== vNo ? b.eta : null,
                  veh_msg: b.veh_msg || "Moving",
                  veh_color: b.veh_color || "#16a34a",
                  speed: b.speed || null,
                  nearestIndex: stopCtx.nearestIndex,
                  nearestStop: stopCtx.nearestStop,
                  nextStop: stopCtx.nextStop,
                  distanceKm: stopCtx.distanceKm,
                  explicitStop: st.stop_name || null,
                });
              }
            });
          }
        });
      }
      if (!liveResponse?.isFallback && Array.isArray(liveData?.buses)) {
        liveData.buses.forEach((bus) => {
          const vNo = String(bus.vehicle_number || bus.vehno || bus.vehicle_no || "").trim();
          const vehicleKey = vNo.toUpperCase();
          const lat = Number(bus.latitude ?? bus.curlat);
          const lng = Number(bus.longitude ?? bus.curlong);
          if (!vNo || busesMap.has(vehicleKey) || !Number.isFinite(lat) ||
              !Number.isFinite(lng) || lat < 25 || lat > 29 || lng < 74 || lng > 78) {
            return;
          }
          const stopCtx = findBusStopContext(lat, lng, orderedStops);
          busesMap.set(vehicleKey, {
            vehicle_number: vNo,
            latitude: lat,
            longitude: lng,
            eta: bus.eta || null,
            veh_msg: bus.veh_msg || "Live",
            veh_color: bus.veh_color || "#16a34a",
            speed: bus.speed ?? null,
            nearestIndex: stopCtx.nearestIndex,
            nearestStop: stopCtx.nearestStop,
            nextStop: stopCtx.nextStop,
            distanceKm: stopCtx.distanceKm,
            explicitStop: null,
          });
        });
      }

      // Also check cityLiveBuses if they match route number
      const cleanRNo = cleanRouteCode(route.route_orgno);
      if (["live", "cached"].includes(cityLiveBusesSource)) {
        cityLiveBuses.forEach((b) => {
          const busRNo = cleanRouteCode(b.rno);
          const vNo = String(b.vehno || "").trim();
          const vehicleKey = vNo.toUpperCase();
          const lat = Number(b.curlat);
          const lng = Number(b.curlong);
          if (!vNo || busRNo !== cleanRNo || busesMap.has(vehicleKey) ||
              !Number.isFinite(lat) || !Number.isFinite(lng) ||
              lat < 25 || lat > 29 || lng < 74 || lng > 78) {
            return;
          }
          const stopCtx = findBusStopContext(lat, lng, orderedStops);

          busesMap.set(vehicleKey, {
            vehicle_number: vNo,
            latitude: lat,
            longitude: lng,
            eta: null,
            veh_msg: "Live",
            veh_color: "#16a34a",
            speed: null,
            nearestIndex: stopCtx.nearestIndex,
            nearestStop: stopCtx.nearestStop,
            nextStop: stopCtx.nextStop,
            distanceKm: stopCtx.distanceKm,
            explicitStop: null,
          });
        });
      }

      const activeBuses = Array.from(busesMap.values());
      setUniversalLiveBuses(activeBuses);
      const hasProviderRouteData = liveResponse?.upstreamReachable === true &&
        !liveResponse?.isCached &&
        !liveResponse?.isFallback;
      const hasCityLiveData = activeBuses.length > 0 &&
        ["live", "cached"].includes(cityLiveBusesSource);
      setUniversalRouteSource(
        hasProviderRouteData
          ? "live"
          : hasCityLiveData
            ? cityLiveBusesSource
            : liveResponse?.isCached
              ? "cached"
              : liveResponse?.isFallback
                ? "fallback"
                : "unavailable"
      );
      const updatedAt = liveResponse?.cacheTimestamp ||
        liveResponse?.summary?.lastUpdated ||
        liveResponse?.timestamp;
      const updatedDate = updatedAt ? new Date(updatedAt) : null;
      setLastTelemetryUpdate(
        updatedDate && Number.isFinite(updatedDate.getTime())
          ? updatedDate.toISOString()
          : ""
      );
    } catch (err) {
      console.warn("Load universal route error:", err);
      setUniversalRouteMap(null);
      setUniversalLiveBuses([]);
      setUniversalRouteSource("unavailable");
      setUniversalRouteError("JCTSL route service temporarily unavailable");
    } finally {
      setUniversalRouteLoading(false);
    }
  }, [cityLiveBuses, cityLiveBusesSource]);

  // Re-fetch selected route live telemetry when city buses update.
  useEffect(() => {
    if (!selectedUniversalRoute || currentView !== "routeSearch") return;
    const refreshTimer = setTimeout(
      () => loadUniversalRoute(selectedUniversalRoute, false),
      0
    );
    return () => clearTimeout(refreshTimer);
  }, [cityLiveBuses, currentView, loadUniversalRoute, selectedUniversalRoute]);

  const handleSelectRouteDirection = async (route) => {
    if (!route) return;
    setSelectedUniversalRoute(route);
    setShowUniversalDropdown(false);
    setUniversalSearchQuery(route.route_orgno || route.route_id);
    await loadUniversalRoute(route, true);
  };

  const openRouteSearch = (routeToSelect = null) => {
    setCurrentView("routeSearch");
    if (routeToSelect) {
      handleSelectRouteDirection(routeToSelect);
    } else {
      setShowUniversalDropdown(true);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const backToHome = () => {
    setCurrentView("home");
    setTimeout(() => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
      }
    }, 50);
  };

  // Find all available directions for the currently selected route org number
  const routeDirections = useMemo(() => {
    if (!selectedUniversalRoute) return [];
    const org = cleanRouteCode(selectedUniversalRoute.route_orgno);
    return availableRoutes.filter((r) => cleanRouteCode(r.route_orgno) === org);
  }, [selectedUniversalRoute, availableRoutes]);
  const telemetryStatusLabel = cityLiveBusesSource === "live"
    ? "LIVE"
    : cityLiveBusesSource === "cached"
      ? "CACHED"
      : cityLiveBusesSource === "fallback"
        ? "FALLBACK"
        : "OFFLINE";
  const telemetryStatusTone = cityLiveBusesSource === "live"
    ? "emerald"
    : cityLiveBusesSource === "cached"
      ? "amber"
      : "rose";
  const telemetryTimeLabel = lastTelemetryUpdate
    ? new Date(lastTelemetryUpdate).toLocaleTimeString()
    : "unknown";

  // =========================================================
  // RENDER UI
  // =========================================================
  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-rose-100 selection:text-rose-900 overflow-x-hidden">
      {/* ========================================================= */}
      {/* 1. TOP HEADER (PREMIUM 3D ELEVATION & DEPTH)              */}
      {/* ========================================================= */}
      {appMode !== "metro" && (
        <header className="sticky top-0 z-[500] flex h-14 w-full items-center justify-between header-3d px-4 max-w-md mx-auto">
        {/* Left Hamburger Icon (3D Tactile Button) */}
        <button
          type="button"
          onClick={() => setShowInfoDrawer(true)}
          className="btn-3d btn-3d-light flex flex-col justify-center items-center gap-1.5 h-11 w-11 min-h-[44px] min-w-[44px] rounded-xl shadow-xs"
          title="About Jaipur Bus Live"
          aria-label="About Jaipur Bus Live navigation menu"
        >
          <span className="block h-[2.5px] w-5 rounded-full bg-slate-900"></span>
          <span className="block h-[2.5px] w-5 rounded-full bg-slate-900"></span>
          <span className="block h-[2.5px] w-5 rounded-full bg-slate-900"></span>
        </button>

        {/* Center: Branding (Bus / Metro / Emergency / Support) */}
        <div
          onClick={() => {
            navigateToMode("bus");
            backToHome();
          }}
          className="flex items-center gap-2.5 select-none cursor-pointer group"
          title="Jaipur Bus Live (JBL)"
        >
          {appMode === "bus" ? (
            <>
              {/* Bus 3D Logo Mark */}
              <div className="card-3d-dark relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md border border-slate-700/80 group-hover:scale-105 transition-transform duration-150">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect
                    x="4"
                    y="3"
                    width="16"
                    height="15"
                    rx="3.5"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M6 7.5h12v4.5a1 1 0 01-1 1H7a1 1 0 01-1-1v-4.5z"
                    fill="#38bdf8"
                    fillOpacity="0.3"
                    stroke="#ffffff"
                    strokeWidth="1.3"
                  />
                  <circle cx="7.5" cy="15.2" r="1.2" fill="#ef4444" />
                  <circle cx="16.5" cy="15.2" r="1.2" fill="#ef4444" />
                  <line
                    x1="10.5"
                    y1="15.2"
                    x2="13.5"
                    y2="15.2"
                    stroke="#ffffff"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                  <path
                    d="M6 18v2a1 1 0 001 1h1a1 1 0 001-1v-2M15 18v2a1 1 0 001 1h1a1 1 0 001-1v-2"
                    stroke="#ffffff"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                  <circle cx="18.5" cy="4.5" r="2" fill="#ef4444" />
                </svg>
              </div>

              {/* Bus Typography Lockup */}
              <div className="flex flex-col leading-none">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-black tracking-tight text-slate-900 font-sans">
                    JAIPUR BUS LIVE
                  </span>
                  <span className="btn-3d-red rounded px-1.5 py-0.5 text-[8.5px] font-black text-white tracking-wider">
                    JBL
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-[9.5px] font-bold tracking-wider text-slate-500 uppercase">
                    JCTSL LIVE TRACKER
                  </span>
                </div>
              </div>
            </>
          ) : appMode === "metro" ? (
            <>
              {/* Metro 3D Logo Mark */}
              <div className="btn-3d-metro relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md border border-rose-500/80 group-hover:scale-105 transition-transform duration-150">
                <span className="text-lg">🚇</span>
              </div>

              {/* Metro Typography Lockup */}
              <div className="flex flex-col leading-none">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-black tracking-tight text-slate-900 font-sans">
                    JAIPUR METRO
                  </span>
                  <span className="btn-3d-metro rounded px-1.5 py-0.5 text-[8.5px] font-black text-white tracking-wider">
                    JMRC
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                  <span className="text-[9.5px] font-bold tracking-wider text-rose-600 uppercase">
                    PINK LINE TRANSIT
                  </span>
                </div>
              </div>
            </>
          ) : appMode === "emergency" ? (
            <>
              {/* Emergency 3D Logo Mark */}
              <div className="btn-3d-red relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md border border-red-500/80 group-hover:scale-105 transition-transform duration-150">
                <span className="text-lg">🚨</span>
              </div>

              {/* Emergency Typography */}
              <div className="flex flex-col leading-none">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-black tracking-tight text-rose-950 font-sans">
                    JAIPUR EMERGENCY
                  </span>
                  <span className="btn-3d-red rounded px-1.5 py-0.5 text-[8.5px] font-black text-white tracking-wider">
                    SOS
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-600 animate-ping"></span>
                  <span className="text-[9.5px] font-bold tracking-wider text-rose-600 uppercase">
                    24×7 QUICK RESPONSE
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Support 3D Logo Mark */}
              <div className="card-3d-dark relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md border border-slate-700/80 group-hover:scale-105 transition-transform duration-150">
                <span className="text-lg">❤¤ï¸</span>
              </div>

              {/* Support Typography */}
              <div className="flex flex-col leading-none">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-black tracking-tight text-slate-900 font-sans">
                    SUPPORT JBL
                  </span>
                  <span className="btn-3d-dark rounded px-1.5 py-0.5 text-[8.5px] font-black text-white tracking-wider">
                    COMMUNITY
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                  <span className="text-[9.5px] font-bold tracking-wider text-slate-500 uppercase">
                    HELP MAKE JBL BETTER
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: Heart Icon / Favorites (3D Tactile Button) */}
        <button
          type="button"
          onClick={() => setShowFavoritesModal(true)}
          className="btn-3d btn-3d-light flex items-center justify-center h-11 w-11 min-h-[44px] min-w-[44px] rounded-xl shadow-xs text-red-600"
          title="Saved Favorite Routes"
          aria-label="Saved Favorite Routes"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill={favorites.length > 0 ? "#dc2626" : "none"}
            stroke={favorites.length > 0 ? "#dc2626" : "currentColor"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </header>
      )}
      {/* HOME TRANSPORT NAVIGATION */}
      {appMode !== "metro" && (
        <div
          className={`mx-auto grid w-full max-w-md ${
            appMode === "metro" ? "grid-cols-2" : "grid-cols-3"
          } gap-2 px-4 pt-3 pb-2`}
        >
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigateToMode("bus");
            backToHome();
          }}
          aria-label="Switch to Jaipur Bus tracking"
          className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-3 min-h-[48px] text-sm font-extrabold shadow-sm transition active:scale-95 ${
            appMode === "bus"
              ? "border-rose-600 bg-rose-600 text-white shadow-rose-200"
              : "border-slate-200 bg-white text-slate-700 hover:border-rose-300"
          }`}
        >
          <span>🚌</span>
          <span>Bus</span>
        </a>

        <a
          href="/metro"
          onMouseEnter={() => { import("./metro/MetroHome"); }}
          onTouchStart={() => { import("./metro/MetroHome"); }}
          onClick={(e) => {
            e.preventDefault();
            navigateToMode("metro");
            window.scrollTo(0, 0);
          }}
          aria-label="Switch to Jaipur Metro guide"
          className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-3 min-h-[48px] text-sm font-extrabold shadow-sm transition active:scale-95 ${
            appMode === "metro"
              ? "border-pink-600 bg-pink-600 text-white shadow-pink-200"
              : "border-slate-200 bg-white text-slate-700 hover:border-pink-300"
          }`}
        >
          <span>🚇</span>
          <span>Metro</span>
        </a>

        {appMode !== "metro" && (
          <button
            type="button"
            onClick={() => setAppMode("emergency")}
            aria-label="Switch to Emergency SOS helplines"
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-3 min-h-[48px] text-sm font-extrabold shadow-sm transition active:scale-95 ${
              appMode === "emergency"
                ? "border-red-600 bg-red-600 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-red-300"
            }`}
          >
            <span>🚨</span>
            <span>SOS</span>
          </button>
        )}
      </div>
      )}

      {/* MAIN ROUTE SEARCH */}
      {appMode !== "metro" && (
        <div className="w-full max-w-md mx-auto px-4 pt-2.5 pb-3">
        <button
          type="button"
          onClick={() => openRouteSearch()}
          aria-label="Open Route Search with Live Bus"
          className="card-3d-interactive flex w-full items-center gap-3 rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 min-h-[52px] text-left shadow-md transition hover:border-slate-300"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 28 28"
            fill="none"
            className="shrink-0"
          >
            <path d="M6 4v16" stroke="#e11d48" strokeWidth="2" strokeLinecap="round" />
            <path d="M6 5h8l-1.5 3.5L14 12H6z" fill="#e11d48" />
            <path d="M7 17c3 2 6 3 10 1" stroke="#94a3b8" strokeWidth="2" strokeDasharray="2 3" strokeLinecap="round" />
            <circle cx="20" cy="18" r="3.5" fill="#e11d48" />
            <circle cx="20" cy="18" r="1.5" fill="white" />
          </svg>
          <span className="text-sm font-bold text-slate-600">
            Route Search with Live Bus
          </span>
          <span className="ml-auto text-lg text-slate-400">›</span>
        </button>
      </div>
      )}


      {/* ========================================================= */}
      {/* 2. MAP VIEW CONTAINER (Preserved in DOM for Leaflet)      */}
      {/* ========================================================= */}
      <div
        className={`relative w-full max-w-md mx-auto ${
          appMode === "bus" && currentView === "home" ? "block" : "hidden"
        }`}
      >
        <div className="relative h-[46vh] min-h-[340px] w-full map-container-relative bg-slate-100 rounded-3xl overflow-hidden border border-slate-200/90 shadow-md">
          {/* Permanent Hero SVG - Renders immediately with App Shell and is NEVER unmounted */}
          <img
            src="/assets/hero/hero-bus-hawa-mahal.svg"
            alt="Jaipur Bus Live Transit Map"
            width="520"
            height="320"
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none z-0"
          />

          <Suspense
            fallback={
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-t from-slate-900/60 via-slate-900/20 to-transparent text-white pointer-events-none">
                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/95 border border-rose-200/80 shadow-sm text-xs font-bold text-slate-800 backdrop-blur-xs">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Connecting Jaipur Live Map...</span>
                </div>
              </div>
            }
          >
            <LiveBusMap
              location={location}
              hasUserLocation={hasUserLocation}
              cityLiveBuses={cityLiveBuses}
              cityLiveBusesLoading={cityLiveBusesLoading}
              cityLiveBusesSource={cityLiveBusesSource}
              liveBusLastPollSucceeded={liveBusLastPollSucceeded}
              selectedBusNumber={selectedBusNumber}
              onSelectBusNumber={setSelectedBusNumber}
              followSelectedBus={followSelectedBus}
              onToggleFollowSelectedBus={setFollowSelectedBus}
              locateMe={locateMe}
              universalLiveBuses={universalLiveBuses}
              focusedStop={focusedStop}
              mapInstanceRef={mapInstance}
            />
          </Suspense>
        </div>
      </div>

      {/* ========================================================= */}
      {/* JAIPUR METRO MODULE (JMRC PINK LINE)                      */}
      {/* ========================================================= */}
      {appMode === "metro" && (
        <MetroErrorBoundary onBackToBus={() => navigateToMode("bus")}>
          <Suspense fallback={<MetroSuspenseSkeleton />}>
            <div className="w-full flex-1">
              <MetroHome onBackToBus={() => navigateToMode("bus")} />
            </div>
          </Suspense>
        </MetroErrorBoundary>
      )}

      {/* ========================================================= */}
      {/* EMERGENCY & SOS MODULE                                    */}
      {/* ========================================================= */}
      {appMode === "emergency" && (
        <EmergencyErrorBoundary onBackToBus={() => setAppMode("bus")}>
          <Suspense fallback={<div className="w-full flex-1 max-w-4xl mx-auto px-4 pt-12 pb-16 text-center text-sm font-bold text-slate-500">Loading Jaipur Emergency SOS...</div>}>
            <div className="w-full flex-1">
              <EmergencyView userPos={hasUserLocation ? location : null} onBackToBus={() => setAppMode("bus")} />
            </div>
          </Suspense>
        </EmergencyErrorBoundary>
      )}

      {/* ========================================================= */}
      {/* SUPPORT JBL MODULE                                        */}
      {/* ========================================================= */}
      {appMode === "support" && (
        <Suspense fallback={<div className="w-full flex-1 max-w-3xl mx-auto px-4 pt-12 pb-16 text-center text-sm font-bold text-slate-500">Loading Support...</div>}>
          <div className="w-full flex-1 max-w-3xl mx-auto px-4 py-6 pb-24 lg:pb-12">
            <SupportView onBackToBus={() => setAppMode("bus")} />
          </div>
        </Suspense>
      )}

      {/* ========================================================= */}
      {/* 3. HOME VIEW: BELOW MAP CONTENT (SCREENSHOT 1)            */}
      {/* ========================================================= */}
      {appMode === "bus" && currentView === "home" && (
        <main className="w-full flex-1 bg-white px-4 pt-3 pb-8 max-w-md mx-auto">
          {/* LIVE TELEMETRY STATUS BAR (3D SURFACE) */}
          <div className="card-3d flex items-center justify-between border border-slate-200/90 rounded-2xl px-3.5 py-2.5 mb-3.5 text-xs shadow-xs">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="flex h-2.5 w-2.5 relative shrink-0">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    cityLiveBusesSource === "live" ? "animate-ping" : ""
                  } ${
                    telemetryStatusTone === "emerald"
                      ? "bg-emerald-400"
                      : telemetryStatusTone === "amber"
                        ? "bg-amber-400"
                        : "bg-rose-400"
                  }`}
                ></span>
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    telemetryStatusTone === "emerald"
                      ? "bg-emerald-600"
                      : telemetryStatusTone === "amber"
                        ? "bg-amber-500"
                        : "bg-rose-600"
                  }`}
                ></span>
              </span>
              <span className="text-slate-900 font-black tracking-wide shrink-0">
                {telemetryStatusLabel}
              </span>
              <span className="text-slate-700 font-bold text-[11px] truncate">
                {cityLiveBusesLoading && cityLiveBuses.length === 0
                  ? "Loading live data..."
                  : cityLiveBusesError
                    ? "Unable to fetch live data"
                    : cityLiveBusesSource === "live"
                      ? `${cityLiveBuses.length} live buses • Updated ${telemetryTimeLabel}`
                      : cityLiveBusesSource === "cached"
                        ? `${cityLiveBuses.length} cached buses • Last updated ${telemetryTimeLabel}`
                        : cityLiveBusesSource === "fallback"
                          ? `${cityLiveBuses.length} fallback buses`
                          : "Live bus data unavailable"}
              </span>
            </div>

            {cityLiveBusesError ? (
              <button
                type="button"
                onClick={fetchCityLiveBuses}
                className="btn-3d btn-3d-red px-2.5 py-1 rounded-lg text-[10px] font-black uppercase text-white shrink-0"
              >
                Retry
              </button>
            ) : (
              <button
                type="button"
                onClick={fetchCityLiveBuses}
                disabled={cityLiveBusesLoading}
                className="btn-3d btn-3d-light px-3.5 py-2 min-h-[40px] rounded-lg text-xs text-slate-700 font-bold disabled:opacity-40 shrink-0 flex items-center justify-center"
                title="Refresh live telemetry now"
                aria-label="Refresh live telemetry now"
              >
                🔄 Refresh
              </button>
            )}
          </div>

          {/* REAL-TIME DYNAMIC JCTSL DASHBOARD STATS (3D INTERACTIVE TILES) */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div
              onClick={() => setCurrentView("nearbyStops")}
              className="card-3d-interactive cursor-pointer p-2.5 text-center select-none"
              title="Click to view all Official JCTSL Bus Stops"
            >
              <div className="text-base font-black text-slate-900 tracking-tight">
                {stopsLoading && allStops.length === 0 ? "..." : allStops.length}
              </div>
              <div className="text-[9.5px] font-bold text-slate-500 leading-tight mt-0.5 uppercase tracking-wide">
                Official JCTSL Bus Stops
              </div>
            </div>

            <div
              onClick={() => openRouteSearch()}
              className="card-3d-interactive cursor-pointer p-2.5 text-center select-none"
              title="Click to view City Routes"
            >
              <div className="text-base font-black text-slate-900 tracking-tight">
                {routesLoading && availableRoutes.length === 0 ? "..." : availableRoutes.length}
              </div>
              <div className="text-[9.5px] font-bold text-slate-500 leading-tight mt-0.5 uppercase tracking-wide">
                City Routes
              </div>
            </div>

            <div
              onClick={() => setCurrentView("nearbyBuses")}
              className="card-3d-interactive cursor-pointer p-2.5 text-center select-none"
              title="Click to view Active GPS Transmitting Buses"
            >
              <div className="flex items-center justify-center gap-1 text-base font-black text-slate-900 tracking-tight">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                {cityLiveBusesLoading && cityLiveBuses.length === 0 ? "..." : cityLiveBuses.length}
              </div>
              <div className="text-[9.5px] font-bold text-slate-500 leading-tight mt-0.5 uppercase tracking-wide">
                Active GPS Transmitting Buses
              </div>
            </div>
          </div>

          {/* Header Row: Nearby stops and Nearby Buses */}
          <div className="flex items-center justify-between mb-2 px-0.5">
            <button
              type="button"
              onClick={() => setCurrentView("nearbyStops")}
              aria-label="View all nearby stops"
              className="text-sm font-semibold text-slate-800 hover:text-red-600 transition flex items-center gap-1 min-h-[44px] py-1"
            >
              <span>📍 Nearby stops</span>
              <span className="text-xs text-slate-400">({allStops.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setCurrentView("nearbyBuses")}
              aria-label="View nearby live buses"
              className="text-sm font-bold text-slate-900 hover:text-red-600 transition flex items-center gap-1 min-h-[44px] py-1"
            >
              <span>Nearby Buses &gt;</span>
              <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
            </button>
          </div>

          {/* Soft Pink Container Card (Screenshot 1: small preview) */}
          <div className="card-3d-emergency p-3 mb-4 rounded-2xl">
            <div className="flex flex-wrap gap-2">
              {nearbyStops.length > 0 ? (
                nearbyStops.slice(0, 6).map((stop, index) => (
                  <button
                    key={stop.bus_stop_code || index}
                    type="button"
                    onClick={() => {
                      setFromStop(stop);
                      setSourceText(stop.bus_stop_name);
                    }}
                    className="btn-3d btn-3d-light rounded-full border border-rose-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-800 hover:bg-rose-50 shadow-xs"
                    title={`Distance: ${formatDistance(stop.distanceKm)}`}
                  >
                    {index + 1}. {stop.bus_stop_name}
                  </button>
                ))
              ) : (
                <div className="text-xs text-slate-500 py-1">
                  Loading nearby stops...
                </div>
              )}
            </div>
          </div>

          {/* ======================================================= */}
          {/* FROM / TO JOURNEY PLANNER (3D LAYERED CARD)             */}
          {/* ======================================================= */}
          <section className="card-3d p-4 shadow-sm mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">
                Plan Your Bus Journey
              </h2>
              {hasUserLocation && (
                <span className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                  GPS Active
                </span>
              )}
            </div>

            <div className="space-y-3">
              {/* FROM INPUT (3D SUNKEN CONTAINER) */}
              <div className="relative">
                <div className="card-3d-sunken flex items-center gap-2.5 px-3 py-2.5 focus-within:border-red-500 focus-within:bg-white transition">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-[10px] font-black text-white shadow-xs">
                    A
                  </div>
                  <input
                    type="text"
                    value={sourceText}
                    aria-label="Starting bus stop"
                    onChange={(e) => {
                      setSourceText(e.target.value);
                      setShowSourceDropdown(true);
                      if (fromStop && e.target.value !== fromStop.bus_stop_name) {
                        setFromStop(null);
                      }
                    }}
                    onFocus={() => setShowSourceDropdown(true)}
                    placeholder="From: Search bus stop (e.g. Airport)"
                    className="w-full bg-transparent text-xs font-bold text-slate-900 outline-none placeholder:text-slate-400"
                  />
                  {sourceText && (
                    <button
                      type="button"
                      onClick={() => {
                        setSourceText("");
                        setFromStop(null);
                        setShowSourceDropdown(false);
                      }}
                      aria-label="Clear starting stop"
                      title="Clear starting stop"
                      className="flex h-9 w-9 items-center justify-center rounded-full text-xs text-slate-400 hover:text-black font-bold p-1 shrink-0"
                    >
                      ✖
                    </button>
                  )}
                </div>

                {/* FROM AUTOCOMPLETE */}
                {showSourceDropdown && sourceMatches.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl z-[450] max-h-56 overflow-y-auto">
                    {sourceMatches.map((st) => (
                      <div
                        key={st.bus_stop_code || st.bus_stop_id}
                        onClick={() => {
                          setFromStop(st);
                          setSourceText(st.bus_stop_name);
                          setShowSourceDropdown(false);
                        }}
                        className="flex items-center justify-between p-2 hover:bg-rose-50 rounded-xl cursor-pointer text-xs"
                      >
                        <span className="font-bold text-slate-900">
                          {st.bus_stop_name}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {st.bus_stop_code}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SWAP BUTTON (3D TACTILE CIRCLE) */}
              <div className="flex justify-center -my-1">
                <button
                  type="button"
                  onClick={handleSwapStops}
                  className="btn-3d btn-3d-light flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-sm font-bold text-slate-700 shadow-xs"
                  title="Swap starting stop and destination stop"
                  aria-label="Swap starting stop and destination stop"
                >
                  ⇄
                </button>
              </div>

              {/* TO INPUT (3D SUNKEN CONTAINER) */}
              <div className="relative">
                <div className="card-3d-sunken flex items-center gap-2.5 px-3 py-2.5 focus-within:border-red-500 focus-within:bg-white transition">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-black text-white shadow-xs">
                    B
                  </div>
                  <input
                    type="text"
                    value={destText}
                    aria-label="Destination bus stop"
                    onChange={(e) => {
                      setDestText(e.target.value);
                      setShowDestDropdown(true);
                      if (toStop && e.target.value !== toStop.bus_stop_name) {
                        setToStop(null);
                      }
                    }}
                    onFocus={() => setShowDestDropdown(true)}
                    placeholder="To: Search destination (e.g. Khirni Phatak)"
                    className="w-full bg-transparent text-xs font-bold text-slate-900 outline-none placeholder:text-slate-400"
                  />
                  {destText && (
                    <button
                      type="button"
                      onClick={() => {
                        setDestText("");
                        setToStop(null);
                        setShowDestDropdown(false);
                      }}
                      aria-label="Clear destination stop"
                      title="Clear destination stop"
                      className="flex h-9 w-9 items-center justify-center rounded-full text-xs text-slate-400 hover:text-black font-bold p-1 shrink-0"
                    >
                      ✖
                    </button>
                  )}
                </div>

                {/* TO AUTOCOMPLETE */}
                {showDestDropdown && destMatches.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl z-[450] max-h-56 overflow-y-auto">
                    {destMatches.map((st) => (
                      <div
                        key={st.bus_stop_code || st.bus_stop_id}
                        onClick={() => {
                          setToStop(st);
                          setDestText(st.bus_stop_name);
                          setShowDestDropdown(false);
                        }}
                        className="flex items-center justify-between p-2 hover:bg-rose-50 rounded-xl cursor-pointer text-xs"
                      >
                        <span className="font-bold text-slate-900">
                          {st.bus_stop_name}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {st.bus_stop_code}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SEARCH ROUTES BUTTON (3D ELEVATED) */}
              <button
                type="button"
                onClick={() => findRoutesBetweenStops(fromStop, toStop)}
                disabled={!fromStop || !toStop || routingLoading}
                className="w-full btn-3d btn-3d-red py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider text-white disabled:opacity-40 shadow-md"
              >
                {routingLoading ? "Searching real routes..." : "Find Connecting Buses"}
              </button>
            </div>

            {/* JOURNEY PLANNER RESULTS */}
            {routingSearched && (
              <div className="mt-4 pt-3 border-t border-slate-100">
                {/* DIRECT ROUTES RESULTS */}
                {routingLoading ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-100 bg-red-50/60 px-4 py-8 text-center">
                    <div className="relative flex h-14 w-full max-w-xs items-center overflow-hidden rounded-full bg-white shadow-inner">
                      <div className="absolute inset-y-0 left-0 w-full animate-pulse rounded-full bg-red-50"></div>
                      <span className="relative z-10 inline-block text-3xl" style={{ animation: "jblBusTravel 1.8s ease-in-out infinite alternate" }}>🚌</span>
                      <span className="absolute right-3 text-lg animate-pulse">📍</span>
                    </div>
                    <p className="text-xs font-black uppercase tracking-wider text-red-700">Searching Bus Routes...</p>
                    <p className="text-[10px] font-medium text-slate-500">Checking direct buses and connecting journeys</p>
                    <style>{`@keyframes jblBusTravel { from { transform: translateX(0); } to { transform: translateX(180px); } }`}</style>
                  </div>
                ) : journeyRoutes.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                        Direct JCTSL Routes ({journeyRoutes.length}):
                      </p>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        Verified Order
                      </span>
                    </div>
                    {journeyRoutes.map((r, idx) => {
                      const isExpanded = expandedRouteKey === (r.route_id || idx);
                      return (
                        <div
                          key={r.route_id || idx}
                          className="card-3d p-3.5 rounded-2xl border border-slate-200 shadow-xs space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="rounded-md bg-red-600 px-2.5 py-0.5 text-xs font-black text-white shrink-0 shadow-2xs">
                                  {r.route_orgno || r.route_id}
                                </span>
                                <span className="font-bold text-xs text-slate-900 line-clamp-1">
                                  {r.route_name}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-600 mt-1 font-medium flex items-center flex-wrap gap-1">
                                <span className="text-slate-900 font-bold">{r.from_stop_matched}</span>
                                <span className="text-slate-400">→</span>
                                <span className="text-slate-900 font-bold">{r.to_stop_matched}</span>
                                <span className="text-slate-400">•</span>
                                <span className="font-semibold text-slate-500">{r.intermediate_stops_count} stops</span>
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => openRouteSearch(r)}
                              className="btn-3d btn-3d-red px-3 py-1.5 rounded-xl text-xs font-black text-white shrink-0 shadow-xs"
                            >
                              Track ›
                            </button>
                          </div>

                          {/* LIVE BUS TELEMETRY & VEHICLE NUMBERS */}
                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between flex-wrap gap-1.5">
                            {r.live_buses_count > 0 ? (
                              <div className="flex items-center flex-wrap gap-1.5">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                  {r.live_buses_count} Active Bus{r.live_buses_count > 1 ? "es" : ""}:
                                </span>
                                {r.live_buses.map((b) => (
                                  <span
                                    key={b.vehicle_number}
                                    className="text-[10px] font-black text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200"
                                  >
                                    {b.vehicle_number}
                                    {typeof b.speed === "number" && b.speed > 0 ? (
                                      <span className="text-emerald-600 font-bold ml-1">({Math.round(b.speed)} km/h)</span>
                                    ) : null}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] font-medium text-slate-400">
                                ⚪ 0 live GPS transmitting (Route verified in schedule)
                              </span>
                            )}

                            {Array.isArray(r.traversal_stops) && r.traversal_stops.length > 2 && (
                              <button
                                type="button"
                                onClick={() => setExpandedRouteKey(isExpanded ? null : (r.route_id || idx))}
                                className="text-[10px] font-bold text-rose-600 hover:text-rose-700 ml-auto"
                              >
                                {isExpanded ? "Hide stops ▲" : `View ${r.intermediate_stops_count} stops ▼`}
                              </button>
                            )}
                          </div>

                          {/* EXPANDABLE INTERMEDIATE STOPS TIMELINE */}
                          {isExpanded && Array.isArray(r.traversal_stops) && (
                            <div className="mt-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[10px] space-y-1.5 max-h-48 overflow-y-auto">
                              <p className="font-bold text-slate-700 uppercase tracking-wider text-[9px]">
                                Stop Sequence ({r.traversal_stops.length} stops):
                              </p>
                              <div className="space-y-1 pl-1">
                                {r.traversal_stops.map((st, stIdx) => {
                                  const isFirst = stIdx === 0;
                                  const isLast = stIdx === r.traversal_stops.length - 1;
                                  return (
                                    <div key={stIdx} className="flex items-center gap-2">
                                      <span className={`w-2 h-2 rounded-full shrink-0 ${isFirst ? "bg-emerald-500" : isLast ? "bg-rose-500" : "bg-slate-300"}`}></span>
                                      <span className={`${isFirst || isLast ? "font-bold text-slate-900" : "text-slate-600"}`}>
                                        {st.name || st.bus_stop}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : connectingJourneys.length > 0 ? (
                  /* CONNECTING JOURNEYS RESULTS (1 TRANSFER) */
                  <div className="space-y-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-wider text-amber-700">
                        Connecting Journeys ({connectingJourneys.length}) — 1 Transfer:
                      </p>
                      <p className="text-[10px] text-slate-500 font-medium">
                        No direct bus found. Travel via a verified interchange stop:
                      </p>
                    </div>
                    {connectingJourneys.map((c, idx) => {
                      return (
                        <div
                          key={idx}
                          className="card-3d p-3.5 rounded-2xl border border-amber-200 bg-amber-50/20 shadow-xs space-y-3"
                        >
                          {/* TRANSFER SUMMARY HEADER */}
                          <div className="flex items-center justify-between pb-2 border-b border-amber-100">
                            <span className="text-[10px] font-black uppercase text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-300">
                              🔄 Transfer at {c.transfer_stop.name}
                            </span>
                            <span className="text-[10px] font-bold text-slate-500">
                              {c.total_stops_count} Total Stops
                              {c.total_live_buses_count > 0 && (
                                <span className="text-emerald-600 font-bold ml-1">
                                  • {c.total_live_buses_count} Live Bus{c.total_live_buses_count > 1 ? "es" : ""}
                                </span>
                              )}
                            </span>
                          </div>

                          {/* LEG 1 */}
                          <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded">
                                  Leg 1: {c.leg1.route_orgno}
                                </span>
                                <span className="text-xs font-bold text-slate-900 line-clamp-1">
                                  {c.leg1.route_name}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => openRouteSearch({ route_id: c.leg1.route_id, route_orgno: c.leg1.route_orgno, route_name: c.leg1.route_name })}
                                className="text-[10px] font-bold text-rose-600 hover:text-rose-700"
                              >
                                View Leg 1 ›
                              </button>
                            </div>
                            <p className="text-[10px] text-slate-600 font-medium">
                              <span className="font-bold text-slate-800">{c.leg1.from_stop}</span>
                              {" → "}
                              <span className="font-bold text-amber-800">{c.leg1.transfer_stop}</span>
                              <span className="text-slate-400"> ({c.leg1.intermediate_stops_count} stops)</span>
                            </p>
                            {c.leg1.live_buses_count > 0 && (
                              <div className="flex items-center flex-wrap gap-1 text-[9px] text-emerald-700 font-semibold">
                                <span>🟢 {c.leg1.live_buses_count} live:</span>
                                {c.leg1.live_buses.map((b) => (
                                  <span key={b.vehicle_number} className="bg-emerald-50 px-1 rounded border border-emerald-200">
                                    {b.vehicle_number}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* TRANSFER INDICATOR */}
                          <div className="text-center text-[10px] font-bold text-amber-700 py-0.5">
                            ↓ Change buses at {c.transfer_stop.name}
                          </div>

                          {/* LEG 2 */}
                          <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="bg-blue-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded">
                                  Leg 2: {c.leg2.route_orgno}
                                </span>
                                <span className="text-xs font-bold text-slate-900 line-clamp-1">
                                  {c.leg2.route_name}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => openRouteSearch({ route_id: c.leg2.route_id, route_orgno: c.leg2.route_orgno, route_name: c.leg2.route_name })}
                                className="text-[10px] font-bold text-blue-600 hover:text-blue-700"
                              >
                                View Leg 2 ›
                              </button>
                            </div>
                            <p className="text-[10px] text-slate-600 font-medium">
                              <span className="font-bold text-amber-800">{c.leg2.transfer_stop}</span>
                              {" → "}
                              <span className="font-bold text-slate-800">{c.leg2.to_stop}</span>
                              <span className="text-slate-400"> ({c.leg2.intermediate_stops_count} stops)</span>
                            </p>
                            {c.leg2.live_buses_count > 0 && (
                              <div className="flex items-center flex-wrap gap-1 text-[9px] text-emerald-700 font-semibold">
                                <span>🟢 {c.leg2.live_buses_count} live:</span>
                                {c.leg2.live_buses.map((b) => (
                                  <span key={b.vehicle_number} className="bg-emerald-50 px-1 rounded border border-emerald-200">
                                    {b.vehicle_number}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* NO DIRECT OR CONNECTING ROUTES FOUND */
                  <div className="p-4 text-center rounded-2xl bg-slate-50 border border-slate-200">
                    <p className="text-xs font-bold text-slate-700">
                      {routingMessage || "No direct or connecting JCTSL routes found"}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Neither a single bus nor a 1-transfer connection connects these two stops in this direction in the JCTSL network.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ========================================================= */}
          {/* QUICK EMERGENCY BAR (HOME ACCESS)                         */}
          {/* ========================================================= */}
          <section className="mt-5 card-3d-emergency p-4">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-lg">🚨</span>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-rose-950">
                    Emergency Helplines (Jaipur)
                  </h3>
                  <p className="text-[10px] text-rose-700 font-bold">
                    Official 24×7 Emergency Dispatch Response
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAppMode("emergency")}
                aria-label="Open Emergency SOS Hub"
                className="text-xs font-black text-rose-600 hover:underline min-h-[44px] inline-flex items-center px-2 py-1"
              >
                SOS Hub ›
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <a
                href="tel:112"
                aria-label="Call 112 Police Emergency SOS"
                className="btn-3d btn-3d-red py-3 px-2 min-h-[48px] rounded-xl text-center text-xs font-black flex flex-col items-center justify-center no-underline"
              >
                <span>🚨 112</span>
                <span className="text-[9px] font-bold text-rose-100 mt-0.5">Police SOS</span>
              </a>
              <a
                href="tel:108"
                aria-label="Call 108 Ambulance Emergency"
                className="btn-3d btn-3d-emerald py-3 px-2 min-h-[48px] rounded-xl text-center text-xs font-black flex flex-col items-center justify-center no-underline"
              >
                <span>🚑 108</span>
                <span className="text-[9px] font-bold text-emerald-100 mt-0.5">Ambulance</span>
              </a>
              <a
                href="tel:101"
                aria-label="Call 101 Fire Emergency"
                className="btn-3d btn-3d-orange py-3 px-2 min-h-[48px] rounded-xl text-center text-xs font-black flex flex-col items-center justify-center no-underline"
              >
                <span>🚒 101</span>
                <span className="text-[9px] font-bold text-orange-100 mt-0.5">Fire</span>
              </a>
            </div>
          </section>

          {/* ========================================================= */}
          {/* JBL SUPPORT SECTION (PREMIUM 3D)                          */}
          {/* ========================================================= */}

        </main>
      )}

      {/* ========================================================= */}
      {/* 4. VIEW: NEARBY STOPS (ALL 366 REAL JCTSL STOPS)          */}
      {/* ========================================================= */}
      {appMode === "bus" && currentView === "nearbyStops" && (
        <Suspense
          fallback={
            <div className="w-full flex-1 bg-white p-8 text-center text-sm font-bold text-slate-500">
              Loading Nearby Stops...
            </div>
          }
        >
          <NearbyStopsView
            backToHome={backToHome}
            allStops={allStops}
            stopsSearchQuery={stopsSearchQuery}
            setStopsSearchQuery={setStopsSearchQuery}
            hasUserLocation={hasUserLocation}
            location={location}
            openStopDetails={openStopDetails}
          />
        </Suspense>
      )}

      {/* ========================================================= */}
      {/* 5. VIEW: NEARBY LIVE BUSES                                */}
      {/* ========================================================= */}
      {appMode === "bus" && currentView === "nearbyBuses" && (
        <Suspense
          fallback={
            <div className="w-full flex-1 bg-white p-8 text-center text-sm font-bold text-slate-500">
              Loading Nearby Live Buses...
            </div>
          }
        >
          <NearbyBusesView
            backToHome={backToHome}
            cityLiveBuses={cityLiveBuses}
            busesSearchQuery={busesSearchQuery}
            setBusesSearchQuery={setBusesSearchQuery}
            allStops={allStops}
            mapInstance={mapInstance}
            setSelectedBusNumber={setSelectedBusNumber}
            setFollowSelectedBus={setFollowSelectedBus}
            setCurrentView={setCurrentView}
            followSelectedBus={followSelectedBus}
            availableRoutes={availableRoutes}
            openRouteSearch={openRouteSearch}
          />
        </Suspense>
      )}

      {/* ========================================================= */}
      {/* 6. VIEW: ROUTE SEARCH & TIMELINE (MATCHES SCREENSHOT 2)    */}
      {/* ========================================================= */}
      {appMode === "bus" && currentView === "routeSearch" && (
        <Suspense
          fallback={
            <div className="w-full flex-1 bg-white p-8 text-center text-sm font-bold text-slate-500">
              Loading Route Search...
            </div>
          }
        >
          <RouteSearchView
            backToHome={backToHome}
            selectedUniversalRoute={selectedUniversalRoute}
            setSelectedUniversalRoute={setSelectedUniversalRoute}
            universalSearchQuery={universalSearchQuery}
            setUniversalSearchQuery={setUniversalSearchQuery}
            showUniversalDropdown={showUniversalDropdown}
            setShowUniversalDropdown={setShowUniversalDropdown}
            availableRoutes={availableRoutes}
            universalRouteLoading={universalRouteLoading}
            universalRouteError={universalRouteError}
            universalRouteMap={universalRouteMap}
            setUniversalRouteMap={setUniversalRouteMap}
            universalLiveBuses={universalLiveBuses}
            setUniversalLiveBuses={setUniversalLiveBuses}
            universalRouteSource={universalRouteSource}
            routeDirections={routeDirections}
            getUniversalSearchResults={getUniversalSearchResults}
            handleSelectRouteDirection={handleSelectRouteDirection}
            mapInstance={mapInstance}
            setCurrentView={setCurrentView}
            setSelectedBusNumber={setSelectedBusNumber}
            setFollowSelectedBus={setFollowSelectedBus}
            lastTelemetryUpdate={lastTelemetryUpdate}
            loadUniversalRoute={loadUniversalRoute}
          />
        </Suspense>
      )}

      {/* ========================================================= */}

{/* JAIPUR BUS LIVE — FOOTER */}
{/* ========================================================= */}
<footer className="mt-auto border-t border-pink-200 bg-white text-slate-700">
  <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 text-center">
    <a
      href="/"
      className="inline-flex items-center justify-center gap-2 text-base font-black tracking-wide text-slate-900 min-h-[44px]"
      aria-label="Jaipur Bus Live Home"
    >
      <span aria-hidden="true"></span>
      <span>JAIPUR BUS LIVE (JBL)</span>
    </a>

    <p className="mt-1 text-sm text-slate-600">
      Your City. Your Bus. Your Journey.
    </p>

    <nav
      aria-label="Footer navigation"
      className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm"
    >
      <a href="/" className="px-3.5 py-2.5 min-h-[44px] inline-flex items-center transition-colors hover:text-pink-600" aria-label="Jaipur Bus Live Home page">Home</a>

      <a
        href="/metro"
        onMouseEnter={() => { import("./metro/MetroHome"); }}
        onTouchStart={() => { import("./metro/MetroHome"); }}
        onClick={(e) => {
          e.preventDefault();
          navigateToMode("metro");
          window.scrollTo(0, 0);
        }}
        className="px-3.5 py-2.5 min-h-[44px] inline-flex items-center transition-colors hover:text-pink-600 font-semibold"
        aria-label="Jaipur Metro Pink Line Guide"
      >
        <span>🚇</span>
        <span className="ml-1">Jaipur Metro Guide</span>
      </a>

      <button
        type="button"
        onClick={() => setShowInfoDrawer(true)}
        className="px-3.5 py-2.5 min-h-[44px] inline-flex items-center transition-colors hover:text-pink-600"
        aria-label="About Jaipur Bus Live details"
      >
        About JBL
      </button>
    </nav>

    <p className="mt-3 text-sm font-medium text-emerald-700">
      Jaipur Public Transport Information
    </p>

    <p className="mt-2 text-xs text-slate-600">
      Built with <span className="text-pink-600">♥</span> by <span className="font-black text-slate-900">Gumshuda</span>
      <span aria-hidden="true"> | </span>
      Jaipur, Rajasthan
    </p>

    <p className="mt-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
      © {new Date().getFullYear()} Jaipur Bus Live. All rights reserved.
    </p>
  </div>
</footer>
      {/* 7. STOP DETAILS MODAL                                     */}
      {/* ========================================================= */}
      {stopDetailsOpen && selectedStop && (
        <div className="fixed inset-0 z-[600] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 animate-fadeIn">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
              <div>
                <h3 className="text-base font-black text-black">
                  {selectedStop.bus_stop_name}
                </h3>
                <p className="text-xs text-slate-500">
                  Code: <b>{selectedStop.bus_stop_code || "—"}</b> • ID: {selectedStop.bus_stop_id || "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStopDetailsOpen(false)}
                aria-label="Close stop details modal"
                className="h-10 w-10 min-h-[40px] min-w-[40px] rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-200"
              >
                ✖
              </button>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => showStopOnMap(selectedStop)}
                className="flex-1 rounded-xl bg-slate-100 py-2 text-xs font-bold text-slate-800 hover:bg-slate-200 transition"
              >
                Show on Map
              </button>
              <button
                type="button"
                onClick={() => {
                  setFromStop(selectedStop);
                  setSourceText(selectedStop.bus_stop_name);
                  setStopDetailsOpen(false);
                  setCurrentView("home");
                }}
                className="flex-1 rounded-xl bg-red-50 border border-red-200 py-2 text-xs font-bold text-red-600 hover:bg-red-100 transition"
              >
                Set as From
              </button>
              <button
                type="button"
                onClick={() => {
                  setToStop(selectedStop);
                  setDestText(selectedStop.bus_stop_name);
                  setStopDetailsOpen(false);
                  setCurrentView("home");
                }}
                className="flex-1 rounded-xl bg-slate-900 py-2 text-xs font-bold text-white hover:bg-black transition"
              >
                Set as To
              </button>
            </div>

            {/* Approaching Live Buses */}
            <div>
              <p className="text-xs font-black uppercase text-slate-400 mb-2">
                Live Buses at this Stop:
              </p>
              {stopBusesLoading ? (
                <div className="py-6 text-center text-xs font-bold text-slate-400">
                  Checking approaching live buses...
                </div>
              ) : stopBusesError ? (
                <div className="py-6 text-center text-xs font-bold text-amber-700 bg-amber-50 rounded-2xl">
                  Live arrivals are temporarily unavailable. Please try again.
                </div>
              ) : stopBuses.length > 0 ? (
                <div className="space-y-2">
                  {stopBuses.map((b, idx) => (
                    <div
                      key={b.vehicel_no || b.vehicle_no || idx}
                      className="rounded-xl border border-slate-200 p-3 bg-slate-50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-black text-xs text-black">
                          🚌 {b.vehicel_no || b.vehicle_no || b.vehNo}
                        </span>
                        {b.eta && (
                          <span className="rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-[10px] font-black">
                            ETA: {b.eta}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Route: <b>{b.route_no || "—"}</b> • Next: {b.destination_stop_name || b.destination || "—"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-xs font-bold text-slate-500 bg-slate-50 rounded-2xl">
                  No live buses currently approaching this stop.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 8. INFO DRAWER (FROM HAMBURGER MENU)                      */}
      {/* ========================================================= */}
      {showInfoDrawer && (
        <div className="fixed inset-0 z-[600] flex bg-black/50 animate-fadeIn">
          <div className="w-4/5 max-w-xs bg-white h-full p-5 shadow-2xl flex flex-col justify-between overflow-y-auto">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <div className="flex items-center gap-2 select-none">
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <rect
                        x="4"
                        y="3"
                        width="16"
                        height="15"
                        rx="3.5"
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="1.8"
                      />
                      <path
                        d="M6 7.5h12v4.5a1 1 0 01-1 1H7a1 1 0 01-1-1v-4.5z"
                        fill="#38bdf8"
                        fillOpacity="0.25"
                        stroke="#ffffff"
                        strokeWidth="1.3"
                      />
                      <circle cx="7.5" cy="15.2" r="1.2" fill="#ef4444" />
                      <circle cx="16.5" cy="15.2" r="1.2" fill="#ef4444" />
                    </svg>
                  </div>
                  <div className="flex flex-col leading-none">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black tracking-tight text-slate-900">
                        JAIPUR BUS LIVE
                      </span>
                      <span className="rounded bg-red-600 px-1 py-0.2 text-[8px] font-black text-white">
                        JBL
                      </span>
                    </div>
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">
                      JCTSL LIVE TRACKER
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInfoDrawer(false)}
                  aria-label="Close navigation menu"
                  className="h-10 w-10 min-h-[40px] min-w-[40px] rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-200"
                >
                  ✖
                </button>
              </div>

              {/* TRANSIT MODE SELECTION (3D TACTILE BUTTONS) */}
              <div className="card-3d p-2 space-y-1.5 mb-3">
                <p className="text-[10px] font-black uppercase text-slate-400 px-2 py-0.5">
                  Select Application Mode:
                </p>
                <a
                  href="/"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateToMode("bus");
                    setShowInfoDrawer(false);
                  }}
                  className={`w-full btn-3d p-2.5 rounded-xl text-xs font-black transition flex items-center justify-between ${
                    appMode === "bus"
                      ? "btn-3d-dark"
                      : "btn-3d-light"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>🚌</span> Jaipur Bus (JCTSL)
                  </span>
                  {appMode === "bus" && (
                    <span className="text-[10px] text-emerald-400 font-bold">🟢 Active</span>
                  )}
                </a>

                <a
                  href="/metro"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateToMode("metro");
                    setShowInfoDrawer(false);
                  }}
                  className={`w-full btn-3d p-2.5 rounded-xl text-xs font-black transition flex items-center justify-between ${
                    appMode === "metro"
                      ? "btn-3d-metro"
                      : "btn-3d-light"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>🚇</span> Jaipur Metro (Pink Line)
                  </span>
                  {appMode === "metro" && (
                    <span className="text-[10px] text-rose-200 font-bold">🟢 Active</span>
                  )}
                </a>

                {appMode !== "metro" && (
                  <button
                    type="button"
                    onClick={() => {
                      setAppMode("emergency");
                      setShowInfoDrawer(false);
                    }}
                  className={`w-full btn-3d p-2.5 rounded-xl text-xs font-black transition flex items-center justify-between ${
                    appMode === "emergency"
                      ? "btn-3d-red"
                      : "btn-3d-light"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>🚨</span> Emergency & SOS (112)
                  </span>
                  {appMode === "emergency" && (
                    <span className="text-[10px] text-white font-bold">🟢 Active</span>
                  )}
                </button>
                )}


              </div>

              <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
                <p>
                  <b>Jaipur Bus Live (JBL)</b> is a real-time public transit tracking application for the Jaipur City Transport Services (JCTSL) bus network.
                </p>
                <div className="rounded-2xl bg-slate-50 p-3 border border-slate-200 space-y-2">
                  <p className="font-black text-[11px] text-slate-400 uppercase tracking-wider">
                    Live Transit Stats:
                  </p>
                  <div className="space-y-1.5 text-xs text-slate-800 font-bold">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 font-semibold">Official JCTSL Bus Stops:</span>
                      <span className="font-black text-black">
                        {stopsLoading && allStops.length === 0 ? "..." : allStops.length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 font-semibold">City Routes:</span>
                      <span className="font-black text-black">
                        {routesLoading && availableRoutes.length === 0 ? "..." : availableRoutes.length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 font-semibold">Active GPS Transmitting Buses:</span>
                      <span className="font-black text-green-700 flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        {cityLiveBusesLoading && cityLiveBuses.length === 0 ? "..." : cityLiveBuses.length}
                      </span>
                    </div>
                  </div>
                </div>
                <p>
                  Telemetry automatically updates every 25 seconds directly from live GPS sensors.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 text-[10px] text-slate-400 text-center font-bold">
              JAIPUR BUS LIVE (JBL) • JCTSL LIVE TRACKER
            </div>
          </div>
          <div className="flex-1" onClick={() => setShowInfoDrawer(false)} />
        </div>
      )}

      {/* ========================================================= */}
      {/* 9. FAVORITES MODAL                                        */}
      {/* ========================================================= */}
      {showFavoritesModal && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/50 p-4 animate-fadeIn">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
              <h3 className="text-base font-black text-black">
                Favorite Routes
              </h3>
              <button
                type="button"
                onClick={() => setShowFavoritesModal(false)}
                aria-label="Close favorites modal"
                className="h-10 w-10 min-h-[40px] min-w-[40px] rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-200"
              >
                ✖
              </button>
            </div>

            {favorites.length > 0 ? (
              <div className="space-y-2">
                {favorites.map((fav) => {
                  const r = availableRoutes.find(
                    (route) => route.route_orgno === fav
                  );
                  return (
                    <div
                      key={fav}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-slate-50"
                    >
                      <div>
                        <span className="font-black text-xs text-black">
                          Route {fav}
                        </span>
                        {r && (
                          <p className="text-[10px] text-slate-500 truncate max-w-[180px]">
                            {r.route_name}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (r) openRouteSearch(r);
                            setShowFavoritesModal(false);
                          }}
                          className="rounded-lg bg-black px-2.5 py-1 text-xs font-bold text-white hover:bg-slate-800"
                        >
                          Track
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleFavorite(fav)}
                          className="text-xs text-slate-400 hover:text-red-600 font-bold px-1"
                        >
                          ✖
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs font-bold text-slate-400">
                No favorite routes saved yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
