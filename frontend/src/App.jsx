import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import MetroHome from "./metro/MetroHome";
import EmergencyView from "./components/EmergencyView";
import SupportView from "./components/SupportView";


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

function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== "string") return [];
  const poly = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    poly.push([lat / 1e5, lng / 1e5]);
  }
  return poly;
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
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const userMarker = useRef(null);
  const stopMarkers = useRef({});
  const busMarkers = useRef({});
  const routePolyline = useRef(null);
  const routeStopMarkers = useRef([]);
  const routeLiveBusMarkers = useRef([]);
  const hasFittedBounds = useRef(false);

  // =========================================================
  // App State
  // =========================================================
  const [appMode, setAppMode] = useState("bus"); // "bus" | "metro"
  const [currentView, setCurrentView] = useState("home"); // "home" | "routeSearch" | "nearbyStops" | "nearbyBuses"
  const [location, setLocation] = useState({ lat: 26.9124, lng: 75.7873 });
  const [hasUserLocation, setHasUserLocation] = useState(false);
  const [locationError, setLocationError] = useState("");

  // Real JCTSL Stops & Routes Data
  const [allStops, setAllStops] = useState([]);
  const [stopsLoading, setStopsLoading] = useState(true);
  const [availableRoutes, setAvailableRoutes] = useState([]);
  const [routesLoading, setRoutesLoading] = useState(true);

  // Real City Live Buses Telemetry
  const [cityLiveBuses, setCityLiveBuses] = useState([]);
  const [cityLiveBusesLoading, setCityLiveBusesLoading] = useState(false);
  const [cityLiveBusesError, setCityLiveBusesError] = useState("");
  const [lastTelemetryUpdate, setLastTelemetryUpdate] = useState("");
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);

  // Selected Stop Details (for Nearby Stops view)
  const [selectedStop, setSelectedStop] = useState(null);
  const [stopBuses, setStopBuses] = useState([]);
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
  const [routingMessage, setRoutingMessage] = useState("");

  // Universal Route Search View
  const [universalSearchQuery, setUniversalSearchQuery] = useState("");
  const [showUniversalDropdown, setShowUniversalDropdown] = useState(false);
  const [selectedUniversalRoute, setSelectedUniversalRoute] = useState(null);
  const [universalRouteMap, setUniversalRouteMap] = useState(null);
  const [universalLiveBuses, setUniversalLiveBuses] = useState([]);
  const [universalRouteLoading, setUniversalRouteLoading] = useState(false);
  const [universalRouteError, setUniversalRouteError] = useState("");
  const [showRouteMapToggle, setShowRouteMapToggle] = useState(false);

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

  // =========================================================
  // 2. INITIAL DATA LOAD & REFRESH INTERVAL
  // =========================================================
  useEffect(() => {
    // 1. Fetch real stops
    fetchBusStops();
    // 2. Fetch available routes
    fetchAvailableRoutes();
    // 3. Fetch city live buses
    fetchCityLiveBuses();

    // 4. Geolocation request
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setLocation({ lat, lng });
          setHasUserLocation(true);
        },
        (err) => {
          console.warn("GPS notice:", err.message);
          setLocationError(
            "Location permission is unavailable. You can still search stops and routes manually."
          );
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }

    // 5. Polling interval for live telemetry (25 seconds)
    const refreshInterval = setInterval(() => {
      fetchCityLiveBuses();
    }, 25000);

    // 6. Seconds counter for live update badge
    const timerInterval = setInterval(() => {
      setSecondsSinceUpdate((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(timerInterval);
    };
  }, []);

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

  // Re-fetch selected route live telemetry when city buses update
  useEffect(() => {
    if (selectedUniversalRoute && currentView === "routeSearch") {
      loadUniversalRoute(selectedUniversalRoute, false);
    }
  }, [cityLiveBuses]);

  // =========================================================
  // 3. API FETCH FUNCTIONS (Backend proxy to real JCTSL)
  // =========================================================
  const fetchBusStops = async () => {
    try {
      setStopsLoading(true);
      const res = await fetch("http://localhost:11000/api/bus-stops");
      const data = await res.json();
      if (Array.isArray(data?.respData)) {
        setAllStops(data.respData);
      }
    } catch (err) {
      console.warn("Bus stops error:", err);
    } finally {
      setStopsLoading(false);
    }
  };

  const fetchAvailableRoutes = async () => {
    try {
      setRoutesLoading(true);
      const res = await fetch("http://localhost:11000/api/routes");
      const data = await res.json();
      if (Array.isArray(data?.respData)) {
        setAvailableRoutes(data.respData);
      }
    } catch (err) {
      console.warn("Routes error:", err);
    } finally {
      setRoutesLoading(false);
    }
  };

  const fetchCityLiveBuses = async () => {
    try {
      setCityLiveBusesLoading(true);
      setCityLiveBusesError("");
      const res = await fetch("http://localhost:11000/api/live-buses");
      const data = await res.json();
      const buses = Array.isArray(data?.respData)
        ? data.respData
        : Array.isArray(data)
        ? data
        : [];

      console.log("LIVE BUS COUNT:", buses.length);
      console.log(
        "LIVE BUS NUMBERS:",
        buses.map((b) => b.vehicleNumber || b.vehno || b.vehicle_number)
      );

      if (buses.length > 0 || data?.respCode === "200") {
        setCityLiveBuses(buses);
        setLastTelemetryUpdate(new Date().toLocaleTimeString());
        setSecondsSinceUpdate(0);
      } else {
        setCityLiveBusesError("Unable to fetch live data");
      }
    } catch (err) {
      console.warn("City live buses error:", err);
      setCityLiveBusesError("Unable to fetch live data");
    } finally {
      setCityLiveBusesLoading(false);
    }
  };

  const fetchBusesNearStop = async (stop) => {
    if (!stop) return;
    const stopCode = stop.bus_stop_code || stop.stop_code || stop.bus_stop_cd;
    if (!stopCode) return;

    try {
      setStopBusesLoading(true);
      const res = await fetch(
        `http://localhost:11000/api/buses-near-stop/${encodeURIComponent(stopCode)}`
      );
      const data = await res.json();
      const list = Array.isArray(data?.respData)
        ? data.respData
        : Array.isArray(data?.respData?.buses)
        ? data.respData.buses
        : [];
      setStopBuses(list);
    } catch (err) {
      console.warn("Buses near stop error:", err);
      setStopBuses([]);
    } finally {
      setStopBusesLoading(false);
    }
  };

  // =========================================================
  // 4. SORTED NEARBY STOPS (Computed with Haversine)
  // =========================================================
  const nearbyStops = useMemo(() => {
    if (!allStops.length) return [];
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
  }, [allStops, location]);

  // =========================================================
  // 5. LEAFLET MAP INITIALIZATION & UPDATES
  // =========================================================
  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstance.current) {
      const map = L.map(mapRef.current, {
        center: [location.lat, location.lng],
        zoom: 13,
        zoomControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors | JCTSL",
        maxZoom: 19,
      }).addTo(map);

      mapInstance.current = map;
    }

    // Update user marker
    const map = mapInstance.current;
    if (hasUserLocation) {
      const userIcon = L.divIcon({
        className: "",
        html: `
          <div style="
            width: 20px;
            height: 20px;
            background: #2563eb;
            border: 3px solid #ffffff;
            border-radius: 50%;
            box-shadow: 0 0 0 6px rgba(37,99,235,0.25);
          "></div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      if (userMarker.current) {
        userMarker.current.setLatLng([location.lat, location.lng]);
      } else {
        userMarker.current = L.marker([location.lat, location.lng], {
          icon: userIcon,
        })
          .addTo(map)
          .bindPopup("<b>Your Current Location</b>");
      }
    }
  }, [location, hasUserLocation]);

  // Update Live Bus Markers on Home Map
  useEffect(() => {
    if (!mapInstance.current) return;
    const map = mapInstance.current;
    const activeVehicles = new Set();

    cityLiveBuses.forEach((b) => {
      const lat = parseFloat(b.currentLatitude || b.curlat || b.latitude);
      const lng = parseFloat(b.currentLongitude || b.curlong || b.longitude);
      const vNo = String(
        b.vehicleNumber || b.vehno || b.vehicle_number || ""
      ).trim();
      const rNo = String(
        b.routeNumber || b.rno || b.route_number || b.route || ""
      ).trim();

      if (
        isNaN(lat) ||
        isNaN(lng) ||
        lat === 0 ||
        lng === 0 ||
        !vNo ||
        b.status === "GPS INVALID"
      ) {
        return;
      }

      activeVehicles.add(vNo);

      const busIcon = L.divIcon({
        className: "",
        html: `
          <div style="
            width: 32px;
            height: 32px;
            background: #ffffff;
            border: 2px solid #dc2626;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(220,38,38,0.3);
            font-size: 16px;
          ">
            🚌
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const busStatus =
        b.status ||
        b.telemetryStatus ||
        (b.speed && b.speed >= 3 ? "LIVE · MOVING" : "LIVE · STOPPED");
      const isMoving = busStatus.includes("MOVING");
      const isStopped = busStatus.includes("STOPPED");

      const statusBadge = isMoving
        ? `<span style="background: #dcfce7; color: #166534; font-size: 9px; font-weight: 900; padding: 2px 6px; border-radius: 9999px;">● LIVE · MOVING</span>`
        : isStopped
        ? `<span style="background: #e0f2fe; color: #0369a1; font-size: 9px; font-weight: 900; padding: 2px 6px; border-radius: 9999px;">● LIVE · STOPPED</span>`
        : `<span style="background: #f1f5f9; color: #64748b; font-size: 9px; font-weight: 900; padding: 2px 6px; border-radius: 9999px;">○ GPS STALE</span>`;

      const timeFormatted = b.telemetryTimestamp
        ? new Date(b.telemetryTimestamp).toLocaleTimeString()
        : b.currentTimestamp
        ? new Date(b.currentTimestamp).toLocaleTimeString()
        : "Just now";

      const popupContent = `
        <div style="font-family: system-ui, sans-serif; font-size: 12px; line-height: 1.4; min-width: 175px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; gap: 6px;">
            <span style="font-weight: 900; font-size: 13px; color: #0f172a;">🚌 ${vNo}</span>
            ${statusBadge}
          </div>
          ${
            rNo
              ? `<div style="font-size: 11px; margin-bottom: 3px;">Route: <b style="background: #dc2626; color: #fff; padding: 1px 5px; border-radius: 4px;">${rNo}</b></div>`
              : `<div style="font-size: 10px; color: #94a3b8; margin-bottom: 3px;">Route: JCTSL City Bus</div>`
          }
          <div style="color: #64748b; font-size: 10px; margin-top: 2px;">
            GPS: <b>${lat.toFixed(5)}, ${lng.toFixed(5)}</b>
          </div>
          ${
            b.speed !== null && b.speed !== undefined && b.speed > 0
              ? `<div style="color: #64748b; font-size: 10px;">Speed: <b>${b.speed} km/h</b></div>`
              : `<div style="color: #94a3b8; font-size: 10px;">Speed: <b>0 km/h (Stationary)</b></div>`
          }
          <div style="color: #94a3b8; font-size: 9px; margin-top: 3px;">
            Last GPS update: <b>${timeFormatted}</b>
          </div>
        </div>
      `;

      if (busMarkers.current[vNo]) {
        busMarkers.current[vNo].setLatLng([lat, lng]);
        busMarkers.current[vNo].setPopupContent(popupContent);
      } else {
        const marker = L.marker([lat, lng], { icon: busIcon })
          .addTo(map)
          .bindPopup(popupContent);
        busMarkers.current[vNo] = marker;
      }
    });

    // Cleanup absent markers
    Object.keys(busMarkers.current).forEach((vNo) => {
      if (!activeVehicles.has(vNo)) {
        map.removeLayer(busMarkers.current[vNo]);
        delete busMarkers.current[vNo];
      }
    });

    // Auto-fit map bounds on first load so all active transmitting buses are immediately visible
    if (activeVehicles.size > 0 && !hasFittedBounds.current) {
      hasFittedBounds.current = true;
      const markersList = Object.values(busMarkers.current);
      if (markersList.length > 0) {
        const group = L.featureGroup(markersList);
        map.fitBounds(group.getBounds().pad(0.08));
      }
    }
  }, [cityLiveBuses]);

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
      setTimeout(() => {
        if (mapInstance.current) {
          mapInstance.current.setView([lat, lng], 16);
          const stopIcon = L.divIcon({
            className: "",
            html: `
              <div style="
                width: 24px;
                height: 24px;
                background: #e11d48;
                border: 2px solid #ffffff;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #ffffff;
                font-size: 11px;
                font-weight: 900;
                box-shadow: 0 4px 10px rgba(0,0,0,0.3);
              ">●</div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });

          L.marker([lat, lng], { icon: stopIcon })
            .addTo(mapInstance.current)
            .bindPopup(`<b>${stop.bus_stop_name}</b><br>Code: ${stop.bus_stop_code || "—"}`)
            .openPopup();
        }
      }, 100);
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
      setRoutingMessage("");

      const fromCode = origin.bus_stop_code || origin.bus_stop_id || origin.bus_stop_name;
      const toCode = dest.bus_stop_code || dest.bus_stop_id || dest.bus_stop_name;

      // Call strictly validated backend route matcher
      const res = await fetch("http://localhost:11000/api/routes-between-stops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_bus_stop_id: fromCode,
          to_bus_stop_id: toCode,
        }),
      });

      const data = await res.json();
      const validRoutes = Array.isArray(data?.routes) ? data.routes : [];
      setJourneyRoutes(validRoutes);
      setRoutingMessage(
        data?.message ||
          (validRoutes.length === 0 ? "No direct JCTSL route found" : "")
      );
    } catch (err) {
      console.warn("Routes between stops error:", err);
      setJourneyRoutes([]);
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

    let matchedRoutes = [];
    if (exactRouteMatches.length > 0) {
      matchedRoutes = exactRouteMatches;
    } else {
      // 2. Keyword / Name / Partial Search
      matchedRoutes = availableRoutes.filter((r) => {
        const nameNorm = String(r.route_name || "").toLowerCase();
        const nameClean = cleanText(r.route_name);
        const orgCode = cleanRouteCode(r.route_orgno);

        return (
          orgCode.includes(qRoute) ||
          nameNorm.includes(qNorm) ||
          nameClean.includes(qClean)
        );
      });
    }

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
  const loadUniversalRoute = async (route, resetMapView = true) => {
    if (!route) return;
    try {
      if (resetMapView) setUniversalRouteLoading(true);
      setUniversalRouteError("");

      const routeId = String(route.route_id);

      // Fetch route map (stops & polyline) and live route upcoming buses
      const [mapRes, liveRes] = await Promise.allSettled([
        fetch("http://localhost:11000/api/route-map", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ route_no: routeId }),
        }).then((r) => r.json()),
        fetch("http://localhost:11000/api/live-route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ route_id: routeId }),
        }).then((r) => r.json()),
      ]);

      const mapData = mapRes.status === "fulfilled" ? mapRes.value?.respData : null;
      const liveData = liveRes.status === "fulfilled" ? liveRes.value?.respData : null;

      // Extract ordered stops from either mapData or liveData
      let orderedStops = [];
      if (Array.isArray(mapData?.bus_stop_list) && mapData.bus_stop_list.length > 0) {
        orderedStops = mapData.bus_stop_list.map((s, idx) => ({
          ...s,
          bus_stop: s.bus_stop || s.bus_stop_name || s.stop_name,
          route_order: s.route_order || String(idx + 1),
        }));
      } else if (Array.isArray(liveData?.route) && liveData.route.length > 0) {
        orderedStops = liveData.route.map((s, idx) => ({
          bus_stop: s.stop_name || s.bus_stop_name,
          bus_stop_code: s.stop_code,
          latitude: s.latitude,
          longitude: s.longitude,
          route_order: String(idx + 1),
        }));
      }

      setUniversalRouteMap({
        ...mapData,
        bus_stop_list: orderedStops,
      });

      // Cache stops for this route
      routeStopsCacheRef.current[routeId] = orderedStops;

      // Extract ALL live buses for this direction
      const busesMap = new Map();
      if (Array.isArray(liveData?.route)) {
        liveData.route.forEach((st) => {
          if (Array.isArray(st.upcomingbuses)) {
            st.upcomingbuses.forEach((b) => {
              const vNo = String(
                b.vehicel_no || b.vehicle_no || b.vehNo || ""
              ).trim();
              if (vNo && !busesMap.has(vNo)) {
                const lat = parseFloat(b.latitude);
                const lng = parseFloat(b.longitude);
                const stopCtx = findBusStopContext(lat, lng, orderedStops);

                busesMap.set(vNo, {
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

      // Also check cityLiveBuses if they match route number
      const cleanRNo = cleanRouteCode(route.route_orgno);
      cityLiveBuses.forEach((b) => {
        const busRNo = cleanRouteCode(b.rno);
        const vNo = String(b.vehno || "").trim();
        if (vNo && busRNo === cleanRNo && !busesMap.has(vNo)) {
          const lat = parseFloat(b.curlat);
          const lng = parseFloat(b.curlong);
          const stopCtx = findBusStopContext(lat, lng, orderedStops);

          busesMap.set(vNo, {
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
        }
      });

      const activeBuses = Array.from(busesMap.values());
      setUniversalLiveBuses(activeBuses);
      setLastTelemetryUpdate(new Date().toLocaleTimeString());
      setSecondsSinceUpdate(0);
    } catch (err) {
      console.warn("Load universal route error:", err);
      setUniversalRouteError("JCTSL route service temporarily unavailable");
    } finally {
      setUniversalRouteLoading(false);
    }
  };

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

  // =========================================================
  // RENDER UI
  // =========================================================
  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-rose-100 selection:text-rose-900 overflow-x-hidden">
      {/* ========================================================= */}
      {/* 1. TOP HEADER (PREMIUM 3D ELEVATION & DEPTH)              */}
      {/* ========================================================= */}
      <header className="sticky top-0 z-[500] flex h-14 w-full items-center justify-between header-3d px-4 max-w-md mx-auto">
        {/* Left Hamburger Icon (3D Tactile Button) */}
        <button
          type="button"
          onClick={() => setShowInfoDrawer(true)}
          className="btn-3d btn-3d-light flex flex-col justify-center items-center gap-1.5 h-9 w-9 rounded-xl shadow-xs"
          title="About Jaipur Bus Live"
        >
          <span className="block h-[2.5px] w-5 rounded-full bg-slate-900"></span>
          <span className="block h-[2.5px] w-5 rounded-full bg-slate-900"></span>
          <span className="block h-[2.5px] w-5 rounded-full bg-slate-900"></span>
        </button>

        {/* Center: Branding (Bus / Metro / Emergency / Support) */}
        <div
          onClick={() => {
            setAppMode("bus");
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
                <span className="text-lg">❤️</span>
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
          className="btn-3d btn-3d-light flex items-center justify-center h-9 w-9 rounded-xl shadow-xs"
          title="Saved Favorite Routes"
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

      {/* ========================================================= */}
      {/* MAIN TRANSIT MODE SELECTOR (BUS / METRO / EMERGENCY / SUPPORT) */}
      {/* ========================================================= */}
      <div className="w-full max-w-md mx-auto px-4 pt-2.5 pb-1">
        <div className="grid grid-cols-4 gap-1.5 card-3d-sunken p-1.5 rounded-2xl">
          <button
            type="button"
            onClick={() => {
              setAppMode("bus");
              backToHome();
            }}
            className={`btn-3d py-2 px-1 rounded-xl text-[11px] sm:text-xs font-black transition flex flex-col sm:flex-row items-center justify-center gap-1 ${
              appMode === "bus"
                ? "btn-3d-dark shadow-md"
                : "text-slate-700 hover:text-black hover:bg-white/70"
            }`}
          >
            <span className="text-sm">🚌</span>
            <span>Bus</span>
          </button>
          <button
            type="button"
            onClick={() => setAppMode("metro")}
            className={`btn-3d py-2 px-1 rounded-xl text-[11px] sm:text-xs font-black transition flex flex-col sm:flex-row items-center justify-center gap-1 ${
              appMode === "metro"
                ? "btn-3d-metro shadow-md"
                : "text-slate-700 hover:text-rose-700 hover:bg-white/70"
            }`}
          >
            <span className="text-sm">🚇</span>
            <span>Metro</span>
          </button>
          <button
            type="button"
            onClick={() => setAppMode("emergency")}
            className={`btn-3d py-2 px-1 rounded-xl text-[11px] sm:text-xs font-black transition flex flex-col sm:flex-row items-center justify-center gap-1 ${
              appMode === "emergency"
                ? "btn-3d-red shadow-md"
                : "text-slate-700 hover:text-rose-700 hover:bg-white/70"
            }`}
          >
            <span className="text-sm">🚨</span>
            <span>SOS</span>
          </button>
          <button
            type="button"
            onClick={() => setAppMode("support")}
            className={`btn-3d py-2 px-1 rounded-xl text-[11px] sm:text-xs font-black transition flex flex-col sm:flex-row items-center justify-center gap-1 ${
              appMode === "support"
                ? "btn-3d-dark shadow-md"
                : "text-slate-700 hover:text-black hover:bg-white/70"
            }`}
          >
            <span className="text-sm">❤️</span>
            <span>Support</span>
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 2. MAP VIEW CONTAINER (Preserved in DOM for Leaflet)      */}
      {/* ========================================================= */}
      <div
        className={`relative w-full max-w-md mx-auto ${
          appMode === "bus" && currentView === "home" ? "block" : "hidden"
        }`}
      >
        <div className="relative h-[46vh] min-h-[340px] w-full map-container-relative">
          <div ref={mapRef} className="absolute inset-0 w-full h-full z-0" />

          {/* Floating Search Bar over Map (3D Interactive Surface) */}
          <div className="absolute left-4 right-4 top-3 z-[400]">
            <div
              onClick={() => openRouteSearch()}
              className="card-3d-interactive flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 shadow-md hover:border-slate-300 transition"
            >
              {/* Route Flag-Pin SVG */}
              <svg
                width="24"
                height="24"
                viewBox="0 0 28 28"
                fill="none"
                className="shrink-0"
              >
                <path
                  d="M6 4v16"
                  stroke="#e11d48"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path d="M6 5h8l-1.5 3.5L14 12H6z" fill="#e11d48" />
                <path
                  d="M7 17c3 2 6 3 10 1"
                  stroke="#94a3b8"
                  strokeWidth="2"
                  strokeDasharray="2 3"
                  strokeLinecap="round"
                />
                <circle cx="20" cy="18" r="3.5" fill="#e11d48" />
                <circle cx="20" cy="18" r="1.5" fill="white" />
              </svg>
              <span className="text-sm font-bold text-slate-500">
                Route Search with Live Bus
              </span>
            </div>
          </div>

          {/* Floating Live Buses Fleet Counter on Map (3D Tactile Pill — bottom left) */}
          <button
            type="button"
            onClick={() => {
              const markersList = Object.values(busMarkers.current);
              if (mapInstance.current && markersList.length > 0) {
                const group = L.featureGroup(markersList);
                mapInstance.current.fitBounds(group.getBounds().pad(0.08));
              }
            }}
            className="floating-pill-3d btn-3d btn-3d-light map-btn-bottom-left flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-black text-slate-900 active:scale-95 transition"
            title="Click to frame all active transmitting buses on map"
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>
              {cityLiveBusesLoading && cityLiveBuses.length === 0
                ? "Connecting GPS..."
                : `${cityLiveBuses.length} buses receiving GPS`}
            </span>
          </button>

          {/* Floating Locate Button at bottom right (3D Tactile Circle — bottom right) */}
          <button
            type="button"
            onClick={locateMe}
            className="btn-3d btn-3d-light map-btn-bottom-right flex h-11 w-11 items-center justify-center rounded-full text-black shadow-md active:scale-95 transition"
            title="Center on my location"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="7" />
              <line x1="12" y1="2" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="22" y2="12" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* JAIPUR METRO MODULE (JMRC PINK LINE)                      */}
      {/* ========================================================= */}
      {appMode === "metro" && (
        <main className="w-full flex-1 max-w-md mx-auto px-4 pt-2">
          <MetroHome onBackToBus={() => setAppMode("bus")} />
        </main>
      )}

      {/* ========================================================= */}
      {/* EMERGENCY & SOS MODULE                                    */}
      {/* ========================================================= */}
      {appMode === "emergency" && (
        <main className="w-full flex-1 max-w-md mx-auto px-4 pt-2">
          <EmergencyView userPos={hasUserLocation ? location : null} onBackToBus={() => setAppMode("bus")} />
        </main>
      )}

      {/* ========================================================= */}
      {/* SUPPORT JBL MODULE                                        */}
      {/* ========================================================= */}
      {appMode === "support" && (
        <main className="w-full flex-1 max-w-md mx-auto px-4 pt-2">
          <SupportView onBackToBus={() => setAppMode("bus")} />
        </main>
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
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    cityLiveBusesError ? "bg-amber-400" : "bg-emerald-400"
                  }`}
                ></span>
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    cityLiveBusesError ? "bg-amber-500" : "bg-emerald-600"
                  }`}
                ></span>
              </span>
              <span className="text-slate-900 font-black tracking-wide shrink-0">
                ● LIVE
              </span>
              <span className="text-slate-700 font-bold text-[11px] truncate">
                {cityLiveBusesLoading && cityLiveBuses.length === 0
                  ? "Loading live data..."
                  : cityLiveBusesError
                  ? "Unable to fetch live data"
                  : `${cityLiveBuses.length} buses receiving GPS • Updated ${lastTelemetryUpdate || "recently"}`}
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
                className="btn-3d btn-3d-light px-2.5 py-1 rounded-lg text-[10px] text-slate-700 font-bold disabled:opacity-40 shrink-0"
                title="Refresh live telemetry now"
              >
                ↻ Refresh
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
              className="text-sm font-semibold text-slate-800 hover:text-red-600 transition flex items-center gap-1"
            >
              <span>🚏 Nearby stops</span>
              <span className="text-xs text-slate-400">({allStops.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setCurrentView("nearbyBuses")}
              className="text-sm font-bold text-slate-900 hover:text-red-600 transition flex items-center gap-1"
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
                      className="text-xs text-slate-400 hover:text-black font-bold px-1"
                    >
                      ✕
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
                  className="btn-3d btn-3d-light flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-slate-700 shadow-xs"
                  title="Swap From and To"
                >
                  ⇅
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
                      className="text-xs text-slate-400 hover:text-black font-bold px-1"
                    >
                      ✕
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
                {journeyRoutes.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[11px] font-black uppercase text-slate-400">
                      Direct JCTSL Routes ({journeyRoutes.length}):
                    </p>
                    {journeyRoutes.map((r, idx) => (
                      <div
                        key={r.route_id || idx}
                        onClick={() => openRouteSearch(r)}
                        className="card-3d-interactive flex items-center justify-between p-3.5 rounded-2xl border border-slate-200 shadow-xs"
                      >
                        <div className="flex-1 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-black text-white shrink-0 shadow-2xs">
                              {r.route_orgno || r.route_id}
                            </span>
                            <span className="font-bold text-xs text-slate-900 line-clamp-1">
                              {r.route_name}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1 font-medium">
                            {r.from_stop_matched && r.to_stop_matched ? (
                              <>
                                <span className="text-slate-800 font-bold">{r.from_stop_matched}</span>
                                {" → "}
                                <span className="text-slate-800 font-bold">{r.to_stop_matched}</span>
                                <span> • {r.intermediate_stops_count} stops</span>
                              </>
                            ) : (
                              "Direction verified in JCTSL sequence"
                            )}
                            {r.live_buses_count > 0 ? (
                              <span className="ml-1 text-emerald-600 font-bold">
                                • {r.live_buses_count} Live Bus{r.live_buses_count > 1 ? "es" : ""}
                              </span>
                            ) : (
                              <span className="ml-1 text-slate-400">• 0 live GPS transmitting</span>
                            )}
                          </p>
                        </div>
                        <span className="btn-3d btn-3d-red px-3 py-1 rounded-lg text-xs font-black text-white shrink-0">
                          Track ›
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center rounded-2xl bg-slate-50 border border-slate-200">
                    <p className="text-xs font-bold text-slate-700">
                      {routingMessage || "No direct JCTSL route found"}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      No single JCTSL bus connects these two stops in this direction.
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
                className="text-[10px] font-black text-rose-600 hover:underline"
              >
                SOS Hub ›
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <a
                href="tel:112"
                className="btn-3d btn-3d-red py-2.5 px-2 rounded-xl text-center text-xs font-black flex flex-col items-center justify-center no-underline"
              >
                <span>🚨 112</span>
                <span className="text-[9px] font-bold text-rose-100 mt-0.5">Police SOS</span>
              </a>
              <a
                href="tel:108"
                className="btn-3d btn-3d-emerald py-2.5 px-2 rounded-xl text-center text-xs font-black flex flex-col items-center justify-center no-underline"
              >
                <span>🚑 108</span>
                <span className="text-[9px] font-bold text-emerald-100 mt-0.5">Ambulance</span>
              </a>
              <a
                href="tel:101"
                className="btn-3d btn-3d-orange py-2.5 px-2 rounded-xl text-center text-xs font-black flex flex-col items-center justify-center no-underline"
              >
                <span>🚒 101</span>
                <span className="text-[9px] font-bold text-orange-100 mt-0.5">Fire</span>
              </a>
            </div>
          </section>

          {/* ========================================================= */}
          {/* JBL SUPPORT SECTION (PREMIUM 3D)                          */}
          {/* ========================================================= */}
          <section className="mt-5 card-3d p-5 text-center space-y-3">
            <div className="flex items-center justify-center gap-1.5">
              <span className="text-base select-none">❤️</span>
              <h2 className="text-sm font-black text-slate-900 tracking-tight">
                Help Us Make JBL Better
              </h2>
            </div>
            <p className="text-xs font-semibold text-slate-600">
              Scan the QR code to support JBL.
            </p>

            <div className="flex justify-center py-1">
              <div className="card-3d-dark p-3 rounded-2xl shadow-xl inline-block border border-slate-700/80">
                <img
                  src="/assets/jbl-support-qr.png"
                  alt="Support JBL QR Code"
                  width="200"
                  height="200"
                  className="w-48 h-48 sm:w-52 sm:h-52 object-contain rounded-xl block select-none"
                  loading="lazy"
                />
              </div>
            </div>

            <div className="inline-block px-3.5 py-1 rounded-full bg-rose-50 border border-rose-200 text-xs font-black text-rose-700 shadow-2xs">
              Even ₹1 helps.
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={() => setAppMode("support")}
                className="btn-3d btn-3d-dark py-2.5 px-5 rounded-xl text-xs font-black"
              >
                ❤️ Support JBL
              </button>
            </div>
          </section>
        </main>
      )}

      {/* ========================================================= */}
      {/* 4. VIEW: NEARBY STOPS (ALL 366 REAL JCTSL STOPS)          */}
      {/* ========================================================= */}
      {appMode === "bus" && currentView === "nearbyStops" && (
        <div className="w-full flex-1 bg-white max-w-md mx-auto px-4 py-3">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-slate-100 pb-3 mb-3">
            <button
              type="button"
              onClick={backToHome}
              className="text-2xl font-bold text-black hover:opacity-70 leading-none"
            >
              ‹
            </button>
            <h1 className="text-base font-black text-black">
              Nearby Bus Stops ({allStops.length})
            </h1>
          </div>

          {/* Search Stops Input */}
          <div className="relative mb-3">
            <input
              type="text"
              value={stopsSearchQuery}
              onChange={(e) => setStopsSearchQuery(e.target.value)}
              placeholder="Search stops by name or code (e.g. Kelgiri, Airport)"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-black outline-none focus:border-red-500 focus:bg-white"
              autoFocus
            />
            {stopsSearchQuery && (
              <button
                type="button"
                onClick={() => setStopsSearchQuery("")}
                className="absolute right-3 top-2.5 text-xs font-bold text-slate-400 hover:text-black"
              >
                ✕
              </button>
            )}
          </div>

          {/* Stops List */}
          <div className="space-y-2 pb-16">
            {(() => {
              const q = stopsSearchQuery.trim().toLowerCase();
              const filtered = allStops.filter((s) => {
                if (!q) return true;
                const name = (s.bus_stop_name || "").toLowerCase();
                const code = (s.bus_stop_code || "").toLowerCase();
                return name.includes(q) || code.includes(q);
              });

              if (filtered.length === 0) {
                return (
                  <div className="py-8 text-center text-xs font-bold text-slate-500">
                    No matching JCTSL bus stop found.
                  </div>
                );
              }

              return filtered.map((stop, idx) => {
                const distKm = hasUserLocation
                  ? calculateDistanceKm(
                      location.lat,
                      location.lng,
                      parseFloat(stop.latitude),
                      parseFloat(stop.longitude)
                    )
                  : null;

                return (
                  <div
                    key={stop.bus_stop_code || idx}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 p-3 hover:border-slate-300 bg-slate-50/50 transition"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900 truncate">
                          {stop.bus_stop_name}
                        </span>
                        {stop.bus_stop_code && (
                          <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 shrink-0">
                            {stop.bus_stop_code}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {distKm !== null ? `${formatDistance(distKm)} away` : `Stop #${idx + 1}`} • Lat: {stop.latitude?.slice(0, 7)}, Lng: {stop.longitude?.slice(0, 7)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => openStopDetails(stop)}
                      className="rounded-xl bg-black px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 shrink-0 transition"
                    >
                      View Live
                    </button>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 5. VIEW: NEARBY LIVE BUSES                                */}
      {/* ========================================================= */}
      {appMode === "bus" && currentView === "nearbyBuses" && (
        <div className="w-full flex-1 bg-white max-w-md mx-auto px-4 py-3">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={backToHome}
                className="text-2xl font-bold text-black hover:opacity-70 leading-none"
              >
                ‹
              </button>
              <h1 className="text-base font-black text-black">
                Nearby Live Buses ({cityLiveBuses.length})
              </h1>
            </div>
            <span className="text-[10px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
              ● LIVE
            </span>
          </div>

          {/* Search Filter */}
          <div className="relative mb-3">
            <input
              type="text"
              value={busesSearchQuery}
              onChange={(e) => setBusesSearchQuery(e.target.value)}
              placeholder="Search by registration (e.g. RJ14) or route (e.g. 6A)"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-black outline-none focus:border-red-500 focus:bg-white"
            />
            {busesSearchQuery && (
              <button
                type="button"
                onClick={() => setBusesSearchQuery("")}
                className="absolute right-3 top-2.5 text-xs font-bold text-slate-400 hover:text-black"
              >
                ✕
              </button>
            )}
          </div>

          {/* Live Buses Cards */}
          <div className="space-y-2 pb-16">
            {(() => {
              const q = busesSearchQuery.trim().toLowerCase();
              const filtered = cityLiveBuses.filter((b) => {
                if (!q) return true;
                const v = (b.vehno || "").toLowerCase();
                const r = (b.rno || "").toLowerCase();
                return v.includes(q) || r.includes(q);
              });

              if (filtered.length === 0) {
                return (
                  <div className="py-8 text-center text-xs font-bold text-slate-500">
                    No live buses matching query.
                  </div>
                );
              }

              return filtered.map((bus, idx) => {
                const lat = parseFloat(bus.curlat);
                const lng = parseFloat(bus.curlong);
                const nearestCtx = findBusStopContext(lat, lng, allStops);

                return (
                  <div
                    key={bus.vehno || idx}
                    className="rounded-2xl border border-slate-200 p-3 bg-slate-50/60 shadow-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🚌</span>
                        <span className="font-black text-xs text-black">
                          {bus.vehno}
                        </span>
                        {bus.rno && (
                          <span className="rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                            Route {bus.rno}
                          </span>
                        )}
                      </div>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                        (bus.status || "").includes("MOVING")
                          ? "text-emerald-700 bg-emerald-100"
                          : (bus.status || "").includes("STOPPED")
                          ? "text-sky-700 bg-sky-100"
                          : "text-slate-600 bg-slate-100"
                      }`}>
                        {bus.status || "LIVE · STOPPED"}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 space-y-0.5 mt-2">
                      <p>
                        Current / Nearby: <b>{nearestCtx.nearestStop}</b> ({formatDistance(nearestCtx.distanceKm)})
                      </p>
                      {nearestCtx.nextStop && (
                        <p>
                          Next Stop: <b>{nearestCtx.nextStop}</b>
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentView("home");
                          setTimeout(() => {
                            if (mapInstance.current && !isNaN(lat) && !isNaN(lng)) {
                              mapInstance.current.setView([lat, lng], 16);
                            }
                          }, 100);
                        }}
                        className="flex-1 rounded-xl bg-white border border-slate-200 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100 transition text-center"
                      >
                        Locate on Map
                      </button>
                      {bus.rno && (
                        <button
                          type="button"
                          onClick={() => {
                            const rMatch = availableRoutes.find(
                              (r) => cleanRouteCode(r.route_orgno) === cleanRouteCode(bus.rno)
                            );
                            if (rMatch) openRouteSearch(rMatch);
                          }}
                          className="flex-1 rounded-xl bg-black py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition text-center"
                        >
                          View Route
                        </button>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 6. VIEW: ROUTE SEARCH & TIMELINE (MATCHES SCREENSHOT 2)    */}
      {/* ========================================================= */}
      {appMode === "bus" && currentView === "routeSearch" && (
        <div className="w-full flex-1 bg-white text-slate-900 max-w-md mx-auto">
          {/* TOP HEADER MATCHING SCREENSHOT 2 */}
          <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-100">
            <button
              type="button"
              onClick={backToHome}
              className="p-1 text-black font-bold text-2xl hover:opacity-70 active:scale-95 transition flex items-center justify-center leading-none"
              title="Back to Home"
            >
              ‹
            </button>
            <h1 className="text-lg font-black text-black tracking-tight">
              Route Search with Live Bus
            </h1>
          </div>

          {/* SEARCH INPUT BAR */}
          <div className="px-4 pt-3 pb-2 relative">
            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-xs">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {/* Route Flag-Pin SVG */}
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 28 28"
                  fill="none"
                  className="shrink-0"
                >
                  <path
                    d="M6 4v16"
                    stroke="#e11d48"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path d="M6 5h8l-1.5 3.5L14 12H6z" fill="#e11d48" />
                  <path
                    d="M7 17c3 2 6 3 10 1"
                    stroke="#94a3b8"
                    strokeWidth="2"
                    strokeDasharray="2 3"
                    strokeLinecap="round"
                  />
                  <circle cx="20" cy="18" r="3.5" fill="#e11d48" />
                  <circle cx="20" cy="18" r="1.5" fill="white" />
                </svg>
                <span className="text-red-600 font-black text-base select-none">
                  |
                </span>

                {selectedUniversalRoute ? (
                  <span className="text-sm font-black uppercase text-black truncate tracking-wide">
                    {selectedUniversalRoute.route_orgno || selectedUniversalRoute.route_id} -{" "}
                    {selectedUniversalRoute.route_name}
                  </span>
                ) : (
                  <input
                    type="text"
                    value={universalSearchQuery}
                    onChange={(e) => {
                      setUniversalSearchQuery(e.target.value);
                      setShowUniversalDropdown(true);
                    }}
                    onFocus={() => setShowUniversalDropdown(true)}
                    placeholder="Search route (6a, ac7, e3, airport)"
                    className="w-full bg-transparent text-sm font-bold text-black outline-none placeholder:text-slate-400"
                    autoFocus
                  />
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedUniversalRoute(null);
                  setUniversalRouteMap(null);
                  setUniversalLiveBuses([]);
                  setUniversalSearchQuery("");
                  setShowUniversalDropdown(true);
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-white text-[10px] font-black hover:opacity-80 transition ml-2"
                title="Clear route"
              >
                ✕
              </button>
            </div>

            {/* SEARCH AUTOCOMPLETE DROPDOWN */}
            {showUniversalDropdown && !selectedUniversalRoute && (
              <div className="absolute left-4 right-4 top-full mt-1.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl z-[500] max-h-80 overflow-y-auto">
                {(() => {
                  const results = getUniversalSearchResults(universalSearchQuery);

                  if (!results.hasQuery) {
                    const distinctRouteOrgs = [
                      ...new Set(availableRoutes.map((r) => r.route_orgno).filter(Boolean)),
                    ];

                    return (
                      <div className="p-1">
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">
                          Available JCTSL Routes ({distinctRouteOrgs.length}):
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {distinctRouteOrgs.map((orgNo) => {
                            const sampleRoute = availableRoutes.find(
                              (r) => r.route_orgno === orgNo
                            );
                            return (
                              <button
                                key={orgNo}
                                type="button"
                                onClick={() => handleSelectRouteDirection(sampleRoute)}
                                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-800 hover:border-red-500 hover:bg-red-50 hover:text-red-700 transition"
                              >
                                Route {orgNo}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  const hasRoutes = results.routeGroups.length > 0;
                  const hasBuses = results.busMatches.length > 0;

                  if (!hasRoutes && !hasBuses) {
                    return (
                      <div className="p-4 text-center text-xs font-bold text-slate-500">
                        No matching JCTSL route or bus found.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {hasRoutes && (
                        <div>
                          <p className="text-[10px] font-black uppercase text-red-600 mb-1.5">
                            Matching Routes ({results.routeGroups.length}):
                          </p>
                          <div className="space-y-2">
                            {results.routeGroups.map((grp) => (
                              <div
                                key={grp.route_orgno}
                                className="rounded-xl border border-slate-200 p-2.5 bg-slate-50/50"
                              >
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-black text-white">
                                    Route {grp.route_orgno}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-bold">
                                    {grp.directions.length} Direction{grp.directions.length === 1 ? "" : "s"}
                                  </span>
                                </div>

                                {/* Both available directions shown separately! */}
                                <div className="space-y-1">
                                  {grp.directions.map((dirRoute) => (
                                    <div
                                      key={dirRoute.route_id}
                                      onClick={() => handleSelectRouteDirection(dirRoute)}
                                      className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200/80 hover:border-red-500 hover:bg-red-50 cursor-pointer transition text-xs"
                                    >
                                      <span className="font-bold text-slate-900 truncate pr-2">
                                        {dirRoute.route_name}
                                      </span>
                                      <span className="font-black text-red-600 shrink-0">
                                        Select ›
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {hasBuses && (
                        <div>
                          <p className="text-[10px] font-black uppercase text-green-700 mb-1.5">
                            Live Vehicles:
                          </p>
                          {results.busMatches.map((bus, idx) => (
                            <div
                              key={bus.vehno || idx}
                              onClick={() => {
                                const rMatch = availableRoutes.find(
                                  (r) => cleanRouteCode(r.route_orgno) === cleanRouteCode(bus.rno)
                                );
                                if (rMatch) handleSelectRouteDirection(rMatch);
                              }}
                              className="flex items-center justify-between p-2 hover:bg-green-50 rounded-xl cursor-pointer text-xs"
                            >
                              <span className="font-bold text-slate-900">
                                🚌 {bus.vehno} {bus.rno ? `(Route ${bus.rno})` : ""}
                              </span>
                              <span className="font-bold text-green-700">Track ›</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* ======================================================= */}
          {/* DIRECTION SWITCHER BAR (SEPARATE DIRECTIONS SELECTOR)   */}
          {/* ======================================================= */}
          {selectedUniversalRoute && routeDirections.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 border-y border-slate-200">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
                Available Directions:
              </p>
              <div className="flex flex-col gap-1.5">
                {routeDirections.map((dirRoute) => {
                  const isActive =
                    String(dirRoute.route_id) === String(selectedUniversalRoute.route_id);
                  return (
                    <button
                      key={dirRoute.route_id}
                      type="button"
                      onClick={() => handleSelectRouteDirection(dirRoute)}
                      className={`btn-3d w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-bold transition text-left ${
                        isActive
                          ? "btn-3d-red text-white shadow-xs"
                          : "btn-3d-light text-slate-800"
                      }`}
                    >
                      <span className="truncate pr-2">
                        {dirRoute.route_name}
                      </span>
                      <span
                        className={`text-[10px] font-black shrink-0 ${
                          isActive ? "text-white" : "text-red-600"
                        }`}
                      >
                        {isActive ? "● Active" : "Switch ⇅"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Status Banner */}
              <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-200/80 text-[11px] font-bold text-slate-600">
                <span>
                  {universalRouteMap?.bus_stop_list?.length || 0} stops •{" "}
                  {universalLiveBuses.length > 0 ? (
                    <span className="text-emerald-700 font-extrabold">
                      {universalLiveBuses.length} active live bus{universalLiveBuses.length === 1 ? "" : "es"}
                    </span>
                  ) : (
                    <span className="text-slate-500 font-medium">
                      0 active live buses (Live bus unavailable right now)
                    </span>
                  )}
                </span>
                <span className="text-green-700 font-bold">
                  ● LIVE • {secondsSinceUpdate < 5 ? "Just now" : `${secondsSinceUpdate}s ago`}
                </span>
              </div>

              {universalLiveBuses.length === 0 && (
                <div className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50/90 border border-amber-200/70 px-3 py-1.5 text-[11px] text-amber-900">
                  <span className="text-sm">ℹ️</span>
                  <span>No live buses are currently transmitting GPS for this route (off-peak / depot). Showing verified JCTSL route stops.</span>
                </div>
              )}
            </div>
          )}

          {/* ======================================================= */}
          {/* ROUTE TIMELINE (SCREENSHOT 2: PERFECT STRAIGHT LINE)    */}
          {/* ======================================================= */}
          {universalRouteLoading ? (
            <div className="py-20 text-center text-slate-500">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-3 border-blue-600 border-t-transparent"></div>
              <p className="mt-3 text-sm font-bold">Loading route stops & live buses...</p>
            </div>
          ) : universalRouteMap?.bus_stop_list?.length > 0 ? (
            <div className="timeline-full-container">
              {/* Continuous 3px straight vertical line */}
              <div className="timeline-vertical-line" />

              {(() => {
                const orderedStops = universalRouteMap.bus_stop_list;
                const totalStops = orderedStops.length;

                // Group live buses by their nearest stop index along this straight route
                const busesByStop = {};
                universalLiveBuses.forEach((bus) => {
                  let idx = bus.nearestIndex;
                  if (idx === undefined || idx === null || idx < 0 || idx >= totalStops) {
                    const ctx = findBusStopContext(
                      bus.latitude,
                      bus.longitude,
                      orderedStops
                    );
                    idx = ctx.nearestIndex;
                  }
                  if (idx >= 0 && idx < totalStops) {
                    if (!busesByStop[idx]) busesByStop[idx] = [];
                    busesByStop[idx].push(bus);
                  }
                });

                return orderedStops.map((st, idx) => {
                  const isStart = idx === 0;
                  const isEnd = idx === totalStops - 1;
                  const stopBusesAtNode = busesByStop[idx] || [];

                  return (
                    <div key={`stop-${idx}`} className="w-full">
                      {/* Stop Node on the Line */}
                      <div
                        onClick={() => {
                          if (mapInstance.current) {
                            const lat = parseFloat(st.latitude);
                            const lng = parseFloat(st.longitude);
                            if (!isNaN(lat) && !isNaN(lng) && lat !== 0) {
                              mapInstance.current.setView([lat, lng], 16);
                            }
                          }
                        }}
                        className="timeline-stop-item"
                      >
                        <div className="timeline-marker-anchor">
                          {isStart ? (
                            <div className="timeline-marker-start" />
                          ) : isEnd ? (
                            <div className="timeline-marker-end" />
                          ) : (
                            <div className="timeline-marker-intermediate">↓</div>
                          )}
                        </div>

                        <span className="text-sm font-bold uppercase tracking-tight text-black select-none truncate">
                          {st.bus_stop || st.bus_stop_name || st.stop_name}
                        </span>
                      </div>

                      {/* Live Buses along this stop */}
                      {stopBusesAtNode.map((bus, bIdx) => (
                        <div
                          key={`bus-${bus.vehicle_number || bIdx}`}
                          className="timeline-bus-item"
                        >
                          <div className="timeline-marker-anchor">
                            <div
                              className="timeline-bus-marker"
                              style={{
                                borderColor: bus.veh_color || "#16a34a",
                                color: bus.veh_color || "#16a34a",
                              }}
                            >
                              🚌
                            </div>
                          </div>

                          <div
                            onClick={() => {
                              if (mapInstance.current && !isNaN(bus.latitude) && !isNaN(bus.longitude)) {
                                setCurrentView("home");
                                setTimeout(() => {
                                  if (mapInstance.current) {
                                    mapInstance.current.setView([bus.latitude, bus.longitude], 16);
                                  }
                                }, 100);
                              }
                            }}
                            className="flex flex-col sm:flex-row sm:items-center justify-between w-full bg-slate-50 border border-slate-200/90 hover:border-green-500 rounded-xl px-3 py-2 ml-2 shadow-xs cursor-pointer transition"
                            title="Click to view live bus on map"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-black text-slate-900">
                                  🚌 {bus.vehicle_number}
                                </span>
                                <span className={`rounded text-[9px] font-black px-1.5 py-0.5 ${
                                  (bus.status || "").includes("MOVING")
                                    ? "bg-emerald-100 text-emerald-800"
                                    : (bus.status || "").includes("STOPPED")
                                    ? "bg-sky-100 text-sky-800"
                                    : "bg-slate-100 text-slate-600"
                                }`}>
                                  ● {bus.status || (bus.speed && bus.speed >= 3 ? "LIVE · MOVING" : "LIVE · STOPPED")}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 font-medium mt-0.5 space-x-1.5">
                                <span>
                                  {bus.speed ? `${bus.speed} km/h` : (bus.status || "").includes("MOVING") ? "Moving" : "Stopped"}
                                </span>
                                <span>•</span>
                                <span className="font-mono text-slate-600">
                                  GPS: {bus.latitude?.toFixed(4)}, {bus.longitude?.toFixed(4)}
                                </span>
                              </div>
                              {(bus.next_stop || bus.nextStop) && (
                                <p className="text-[10px] text-slate-600 font-bold mt-0.5">
                                  Next: {bus.next_stop || bus.nextStop}
                                </p>
                              )}
                            </div>

                            <div className="mt-1 sm:mt-0 flex items-center gap-1.5">
                              {bus.eta && bus.eta !== bus.vehicle_number ? (
                                <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-black">
                                  ETA: {bus.eta}
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium text-slate-400">
                                  In Transit
                                </span>
                              )}
                              <span className="text-xs font-bold text-slate-400">›</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()}
            </div>
          ) : universalRouteError ? (
            <div className="py-16 px-4 text-center">
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 max-w-xs mx-auto space-y-2.5">
                <span className="text-2xl block">⚠️</span>
                <p className="text-xs font-bold text-red-700">
                  {universalRouteError}
                </p>
                <button
                  type="button"
                  onClick={() => loadUniversalRoute(selectedUniversalRoute, true)}
                  className="rounded-xl bg-red-600 px-4 py-2 text-xs font-black text-white hover:bg-red-700 transition"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <div className="py-20 text-center text-xs font-bold text-slate-500">
              No stops available for this route.
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* GLOBAL FOOTER / BRANDING                                  */}
      {/* ========================================================= */}
      <footer className="w-full mt-auto border-t border-slate-200/90 bg-white py-5 px-4 text-center select-none shadow-2xs">
        <div className="max-w-md mx-auto flex flex-col items-center justify-center text-center space-y-1">
          <p className="text-xs sm:text-sm font-bold text-slate-800 flex items-center justify-center gap-1.5 flex-wrap leading-tight">
            <span>Made with</span>
            <span className="text-red-500 inline-block animate-pulse text-sm" role="img" aria-label="love">❤️</span>
            <span>in Jaipur by Gaurav</span>
          </p>
          <p className="text-[11px] sm:text-xs font-medium text-slate-500 tracking-tight leading-tight">
            Real-time mobility, made simple.
          </p>
          <p className="text-[10px] sm:text-[11px] font-semibold text-slate-400 pt-0.5 leading-tight">
            © 2026 Jaipur Bus Live (JBL) · All Rights Reserved
          </p>
        </div>
      </footer>

      {/* ========================================================= */}
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
                className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-200"
              >
                ✕
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
                  className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-200"
                >
                  ✕
                </button>
              </div>

              {/* TRANSIT MODE SELECTION (3D TACTILE BUTTONS) */}
              <div className="card-3d p-2 space-y-1.5 mb-3">
                <p className="text-[10px] font-black uppercase text-slate-400 px-2 py-0.5">
                  Select Application Mode:
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setAppMode("bus");
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
                    <span className="text-[10px] text-emerald-400 font-bold">● Active</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAppMode("metro");
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
                    <span className="text-[10px] text-rose-200 font-bold">● Active</span>
                  )}
                </button>

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
                    <span className="text-[10px] text-white font-bold">● Active</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAppMode("support");
                    setShowInfoDrawer(false);
                  }}
                  className={`w-full btn-3d p-2.5 rounded-xl text-xs font-black transition flex items-center justify-between ${
                    appMode === "support"
                      ? "btn-3d-dark"
                      : "btn-3d-light"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>❤️</span> Support JBL
                  </span>
                  {appMode === "support" && (
                    <span className="text-[10px] text-rose-400 font-bold">● Active</span>
                  )}
                </button>
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

                {/* JBL SUPPORT SECTION IN DRAWER */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-center mt-3 space-y-1.5">
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="text-sm select-none">❤️</span>
                    <p className="text-xs font-black text-slate-900">
                      Help Us Make JBL Better
                    </p>
                  </div>
                  <p className="text-[11px] font-semibold text-slate-600">
                    Scan the QR code to support JBL.
                  </p>
                  <div className="flex justify-center py-1">
                    <div className="p-2 bg-slate-900 rounded-xl border border-slate-800 shadow-sm inline-block">
                      <img
                        src="/assets/jbl-support-qr.png"
                        alt="Support JBL QR Code"
                        width="160"
                        height="160"
                        className="w-36 h-36 object-contain rounded-lg block select-none"
                        loading="lazy"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] font-bold text-slate-700">
                    Even ₹1 helps.
                  </p>
                </div>
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
                className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-200"
              >
                ✕
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
                          ✕
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