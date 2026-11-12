import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  calculateBearingDegrees,
  createMarkerAnimator,
  getBusStatus,
  getBusStatusClasses,
  getBusSpeedLabel,
  getBusStatusStyle,
  smoothBearingDegrees,
} from "../markerAnimation";

const BUS_MARKER_STALE_AFTER_MS = 60_000;
const BUS_MARKER_EXPIRY_MS = 900_000;

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
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

function createBusMarkerIcon(
  status,
  bearing = 0,
  vehicleNumber = "",
  selected = false
) {
  const colors = getBusStatusStyle(status);
  const roundedBearing = Math.round(((bearing % 360) + 360) % 360);
  const selectionStyle = selected
    ? "filter: drop-shadow(0 0 6px rgba(14, 165, 233, 0.95)) drop-shadow(0 0 10px rgba(14, 165, 233, 0.6));"
    : "filter: drop-shadow(0 2px 5px rgba(15, 23, 42, 0.35));";

  return L.divIcon({
    className: "jbl-bus-marker",
    html: `
      <div role="img" aria-label="JCTSL bus ${vehicleNumber}" style="
        width: 26px;
        height: 46px;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: rotate(${roundedBearing}deg);
        transform-origin: 13px 23px;
        cursor: pointer;
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        ${selectionStyle}
      ">
        <svg width="26" height="46" viewBox="0 0 26 46" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <!-- Outer Wheels / Tires (4 tires) -->
          <rect x="0.5" y="7" width="2.5" height="7" rx="1.2" fill="#1e293b"/>
          <rect x="23" y="7" width="2.5" height="7" rx="1.2" fill="#1e293b"/>
          <rect x="0.5" y="30" width="2.5" height="7" rx="1.2" fill="#1e293b"/>
          <rect x="23" y="30" width="2.5" height="7" rx="1.2" fill="#1e293b"/>

          <!-- Side Mirrors -->
          <path d="M2.5 9L0.5 7.5" stroke="#334155" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M23.5 9L25.5 7.5" stroke="#334155" stroke-width="1.2" stroke-linecap="round"/>

          <!-- Main Aerodynamic Coach Body (with subtle metallic gradient) -->
          <rect x="2.5" y="2" width="21" height="42" rx="5" fill="${colors.background}" stroke="${colors.stroke}" stroke-width="1.4"/>

          <!-- Roof Air Conditioner Pod (Pink City Transit style) -->
          <rect x="6.5" y="16" width="13" height="13" rx="2.5" fill="#f8fafc" stroke="#cbd5e1" stroke-width="0.8"/>
          <line x1="8.5" y1="19.5" x2="17.5" y2="19.5" stroke="#94a3b8" stroke-width="0.75" stroke-linecap="round"/>
          <line x1="8.5" y1="22.5" x2="17.5" y2="22.5" stroke="#94a3b8" stroke-width="0.75" stroke-linecap="round"/>
          <line x1="8.5" y1="25.5" x2="17.5" y2="25.5" stroke="#94a3b8" stroke-width="0.75" stroke-linecap="round"/>

          <!-- Front Panoramic Windshield -->
          <path d="M4.5 4.5C4.5 3.5 5.5 2.5 6.5 2.5H19.5C20.5 2.5 21.5 3.5 21.5 4.5V11.5H4.5V4.5Z" fill="#0f172a"/>
          <!-- Windshield Glare / Reflection Accent -->
          <path d="M6 3.5L11 3.5L8.5 10.5H5L6 3.5Z" fill="white" fill-opacity="0.22"/>

          <!-- Front Destination LED Sign Board -->
          <rect x="7" y="3.5" width="12" height="2.2" rx="0.8" fill="#f59e0b" fill-opacity="0.95"/>

          <!-- Dual Headlights (Front Glowing Bulbs) -->
          <circle cx="5" cy="3.5" r="1.1" fill="#fef08a"/>
          <circle cx="21" cy="3.5" r="1.1" fill="#fef08a"/>

          <!-- Front Directional Heading Arrow Indicator (Crisp navigation pointer) -->
          <path d="M13 6.5L16 10H10L13 6.5Z" fill="#38bdf8"/>

          <!-- Rear Tail Lights (Red safety indicators) -->
          <rect x="4.5" y="42" width="3.2" height="1.4" rx="0.6" fill="#ef4444"/>
          <rect x="18.3" y="42" width="3.2" height="1.4" rx="0.6" fill="#ef4444"/>

          <!-- Rear Back Glass -->
          <rect x="5.5" y="38" width="15" height="3" rx="1" fill="#334155"/>
        </svg>
      </div>
    `,
    iconSize: [26, 46],
    iconAnchor: [13, 23],
    popupAnchor: [0, -22],
  });
}

function createBusPopupContent({
  vehicleNumber,
  routeNumber,
  status,
  latitude,
  longitude,
  speed,
  timestamp,
}) {
  const colors = getBusStatusStyle(status);
  const formattedTime = timestamp
    ? (() => {
        const parsed = new Date(timestamp);
        return Number.isNaN(parsed.getTime())
          ? ""
          : parsed.toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
      })()
    : "";

  return `
    <div style="font-family:system-ui,sans-serif;font-size:12px;line-height:1.4;min-width:175px;">
      <div style="display:flex;items-center;justify-content:space-between;margin-bottom:4px;gap:6px;">
        <span style="font-weight:900;font-size:13px;color:#0f172a;">🚌 ${vehicleNumber}</span>
        <span style="background:${colors.background};color:${colors.foreground};font-size:9px;font-weight:900;padding:2px 6px;border-radius:9999px;">🟢  ${status}</span>
      </div>
      <div style="font-size:11px;margin-bottom:3px;">Route: <b>${routeNumber || "JCTSL City Bus"}</b></div>
      <div style="color:#64748b;font-size:10px;margin-top:2px;">GPS: <b>${latitude.toFixed(5)}, ${longitude.toFixed(5)}</b></div>
      ${
        speed != null
          ? `<div style="color:#0f172a;font-size:10px;margin-top:2px;">Speed: <b>${speed} km/h</b></div>`
          : ""
      }
      ${
        formattedTime
          ? `<div style="color:#64748b;font-size:9px;margin-top:3px;">Updated: ${formattedTime}</div>`
          : ""
      }
    </div>
  `;
}

export default function LiveBusMap({
  location = { lat: 26.9124, lng: 75.7873 },
  hasUserLocation = false,
  cityLiveBuses = [],
  cityLiveBusesLoading = false,
  cityLiveBusesSource = "unavailable",
  liveBusLastPollSucceeded = { current: null },
  selectedBusNumber = null,
  onSelectBusNumber,
  followSelectedBus = false,
  onToggleFollowSelectedBus,
  locateMe,
  universalLiveBuses = [],
  focusedStop = null,
  mapInstanceRef,
}) {
  const mapContainerRef = useRef(null);
  const internalMapInstance = useRef(null);
  const userMarkerRef = useRef(null);
  const stopHighlightMarkerRef = useRef(null);
  const busMarkersRef = useRef({});
  const busMarkerMetadataRef = useRef(new Map());
  const busMarkerAnimatorRef = useRef(null);
  const hasFittedBoundsRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  // Initialize Marker Animator
  useEffect(() => {
    busMarkerAnimatorRef.current = createMarkerAnimator();
    const markerMetadata = busMarkerMetadataRef.current;
    return () => {
      busMarkerAnimatorRef.current?.cancelAll();
      if (internalMapInstance.current) {
        Object.values(busMarkersRef.current).forEach((marker) => {
          internalMapInstance.current.removeLayer(marker);
        });
      }
      busMarkersRef.current = {};
      markerMetadata.clear();
      busMarkerAnimatorRef.current = null;
    };
  }, []);

  // Initialize Leaflet Map (Deferred to allow initial UI paint)
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!internalMapInstance.current) {
      const map = L.map(mapContainerRef.current, {
        center: [26.9124, 75.7873],
        zoom: 12,
        zoomControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors | JCTSL",
        maxZoom: 19,
        keepBuffer: 0,
        updateWhenIdle: true,
      }).addTo(map);

      map.whenReady(() => {
        setMapReady(true);
      });

      internalMapInstance.current = map;
      if (mapInstanceRef) {
        mapInstanceRef.current = map;
      }
    }

    // Update user marker
    const map = internalMapInstance.current;
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

      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng([location.lat, location.lng]);
      } else {
        userMarkerRef.current = L.marker([location.lat, location.lng], {
          icon: userIcon,
        })
          .addTo(map)
          .bindPopup("<b>Your Current Location</b>");
      }
    }
  }, [location, hasUserLocation, mapInstanceRef]);

  // Handle focused stop from Nearby Stops
  useEffect(() => {
    if (!focusedStop || !internalMapInstance.current) return;
    const lat = parseFloat(focusedStop.latitude);
    const lng = parseFloat(focusedStop.longitude);
    if (isNaN(lat) || isNaN(lng) || lat === 0) return;

    const map = internalMapInstance.current;
    map.setView([lat, lng], 16);

    if (stopHighlightMarkerRef.current) {
      map.removeLayer(stopHighlightMarkerRef.current);
    }

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
        ">🟢 </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    stopHighlightMarkerRef.current = L.marker([lat, lng], { icon: stopIcon })
      .addTo(map)
      .bindPopup(`<b>${focusedStop.bus_stop_name || focusedStop.stop_name || "Bus Stop"}</b><br>Code: ${focusedStop.bus_stop_code || "—"}`)
      .openPopup();
  }, [focusedStop]);

  // Update Live Bus Markers on Home Map
  useEffect(() => {
    if (!internalMapInstance.current || !mapReady) return;
    const map = internalMapInstance.current;

    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const activeVehicles = new Set();
      const now = Date.now();

    (liveBusLastPollSucceeded?.current === false ? [] : cityLiveBuses).forEach(
      (b) => {
        const lat = Number(b.currentLatitude ?? b.curlat ?? b.latitude);
        const lng = Number(b.currentLongitude ?? b.curlong ?? b.longitude);
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
          lat < 25 ||
          lat > 29 ||
          lng < 74 ||
          lng > 78 ||
          getBusStatus(b) === "GPS INVALID"
        ) {
          return;
        }

        activeVehicles.add(vNo);
        const busStatus = getBusStatus(b);
        const reportedAge = Number(b.telemetryAge);
        const hasReportedAge =
          b.telemetryAge !== null &&
          b.telemetryAge !== undefined &&
          b.telemetryAge !== "";
        const isFresh =
          busStatus.startsWith("LIVE ·") &&
          (!hasReportedAge || reportedAge <= BUS_MARKER_STALE_AFTER_MS / 1000);
        const existingMetadata = busMarkerMetadataRef.current.get(vNo);
        const backendPrevLat = Number(b.previousLatitude);
        const backendPrevLng = Number(b.previousLongitude);
        const hasBackendPreviousGps =
          Number.isFinite(backendPrevLat) &&
          Number.isFinite(backendPrevLng) &&
          backendPrevLat >= 25 &&
          backendPrevLat <= 29 &&
          backendPrevLng >= 74 &&
          backendPrevLng <= 78 &&
          (backendPrevLat !== lat || backendPrevLng !== lng) &&
          calculateDistanceKm(backendPrevLat, backendPrevLng, lat, lng) >= 0.005;

        const hasClientPreviousGps =
          !hasBackendPreviousGps &&
          existingMetadata &&
          Number.isFinite(existingMetadata.latitude) &&
          Number.isFinite(existingMetadata.longitude) &&
          (existingMetadata.latitude !== lat || existingMetadata.longitude !== lng) &&
          calculateDistanceKm(existingMetadata.latitude, existingMetadata.longitude, lat, lng) >= 0.005;

        const prevLatForBearing = hasBackendPreviousGps
          ? backendPrevLat
          : hasClientPreviousGps
          ? existingMetadata.latitude
          : null;
        const prevLngForBearing = hasBackendPreviousGps
          ? backendPrevLng
          : hasClientPreviousGps
          ? existingMetadata.longitude
          : null;

        const bearing =
          prevLatForBearing !== null && prevLngForBearing !== null
            ? (existingMetadata?.bearing !== undefined
                ? smoothBearingDegrees(
                    existingMetadata.bearing,
                    calculateBearingDegrees(
                      prevLatForBearing,
                      prevLngForBearing,
                      lat,
                      lng
                    )
                  )
                : Math.round(
                    calculateBearingDegrees(
                      prevLatForBearing,
                      prevLngForBearing,
                      lat,
                      lng
                    )
                  ))
            : existingMetadata?.bearing || 0;
        const popupContent = createBusPopupContent({
          vehicleNumber: vNo,
          routeNumber: rNo,
          status: busStatus,
          latitude: lat,
          longitude: lng,
          speed:
            b.speed !== null &&
            b.speed !== undefined &&
            b.speed !== "" &&
            Number.isFinite(Number(b.speed))
              ? Number(b.speed)
              : null,
          timestamp: b.currentTimestamp || b.telemetryTimestamp,
        });
        let marker = busMarkersRef.current[vNo];

        if (!marker) {
          marker = L.marker([lat, lng], {
            icon: createBusMarkerIcon(
              busStatus,
              bearing,
              vNo,
              selectedBusNumber === vNo
            ),
            title: vNo,
            alt: `JCTSL bus ${vNo}`,
          })
            .addTo(map)
            .bindPopup(popupContent)
            .bindTooltip(vNo, {
              direction: "top",
              offset: [0, -23],
              opacity: 0.95,
              sticky: true,
            });
          marker.on("click", () => onSelectBusNumber?.(vNo));
          busMarkersRef.current[vNo] = marker;
        } else {
          const currentPosition = marker.getLatLng();
          const hasNewCoordinates =
            currentPosition.lat !== lat || currentPosition.lng !== lng;
          if (
            hasNewCoordinates &&
            isFresh &&
            busMarkerAnimatorRef.current
          ) {
            busMarkerAnimatorRef.current.move(vNo, marker, [lat, lng]);
          }
          const isSelected = selectedBusNumber === vNo;
          if (
            !existingMetadata ||
            existingMetadata.status !== busStatus ||
            existingMetadata.bearing !== bearing ||
            existingMetadata.selected !== isSelected
          ) {
            marker.setIcon(
              createBusMarkerIcon(
                busStatus,
                bearing,
                vNo,
                isSelected
              )
            );
          }
          marker.setPopupContent(popupContent);
        }

        busMarkerMetadataRef.current.set(vNo, {
          bearing,
          latitude: lat,
          longitude: lng,
          routeNumber: rNo,
          status: busStatus,
          selected: selectedBusNumber === vNo,
          speed:
            b.speed !== null &&
            b.speed !== undefined &&
            b.speed !== "" &&
            Number.isFinite(Number(b.speed))
              ? Number(b.speed)
              : null,
          timestamp: b.currentTimestamp || b.telemetryTimestamp,
          lastSeenAt: isFresh
            ? now
            : existingMetadata?.lastSeenAt ||
              (hasReportedAge && Number.isFinite(reportedAge)
                ? now - Math.max(0, reportedAge * 1000)
                : now),
          missedPolls: 0,
        });
      }
    );

    Object.entries(busMarkersRef.current).forEach(([vNo, marker]) => {
      if (activeVehicles.has(vNo)) return;

      const metadata = busMarkerMetadataRef.current.get(vNo);
      if (!metadata) return;
      metadata.missedPolls++;
      const ageMs = now - metadata.lastSeenAt;

      if (
        ageMs > BUS_MARKER_STALE_AFTER_MS &&
        metadata.status !== "GPS INVALID"
      ) {
        metadata.status = "GPS STALE";
        marker.setIcon(
          createBusMarkerIcon(
            metadata.status,
            metadata.bearing,
            vNo,
            selectedBusNumber === vNo
          )
        );
        const position = marker.getLatLng();
        marker.setPopupContent(
          createBusPopupContent({
            vehicleNumber: vNo,
            routeNumber: metadata.routeNumber,
            status: metadata.status,
            latitude: position.lat,
            longitude: position.lng,
            speed: null,
            timestamp: metadata.timestamp,
          })
        );
      }

      if (ageMs > BUS_MARKER_EXPIRY_MS) {
        busMarkerAnimatorRef.current?.cancel(vNo);
        map.removeLayer(marker);
        delete busMarkersRef.current[vNo];
        busMarkerMetadataRef.current.delete(vNo);
        if (selectedBusNumber === vNo) {
          onSelectBusNumber?.(null);
          onToggleFollowSelectedBus?.(false);
        }
      }
    });

    // Mark initial load fitted ref so initial mount does not force layout reflow
    if (activeVehicles.size > 0 && !hasFittedBoundsRef.current) {
      hasFittedBoundsRef.current = true;
    }
  });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [mapReady, cityLiveBuses, selectedBusNumber, onSelectBusNumber, onToggleFollowSelectedBus, liveBusLastPollSucceeded]);

  // Handle follow mode for selected bus
  useEffect(() => {
    if (!followSelectedBus || !selectedBusNumber || !internalMapInstance.current) return;
    const selectedBus = cityLiveBuses.find(
      (bus) =>
        String(bus.vehicleNumber || bus.vehno || bus.vehicle_number || "").trim() ===
        selectedBusNumber
    );
    if (!selectedBus || !getBusStatus(selectedBus).startsWith("LIVE ·")) return;

    const latitude = Number(selectedBus.currentLatitude ?? selectedBus.curlat ?? selectedBus.latitude);
    const longitude = Number(selectedBus.currentLongitude ?? selectedBus.curlong ?? selectedBus.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      internalMapInstance.current.panTo([latitude, longitude], { animate: true });
    }
  }, [cityLiveBuses, followSelectedBus, selectedBusNumber]);

  return (
    <>
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-10" />
      {!mapReady && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-t from-slate-900/60 via-slate-900/20 to-transparent text-white pointer-events-none transition-opacity duration-300">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/95 border border-rose-200/80 shadow-sm text-xs font-bold text-slate-800 backdrop-blur-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Connecting Jaipur Live Map...</span>
          </div>
        </div>
      )}

      {/* Floating Live Buses Fleet Counter on Map (3D Tactile Pill — bottom left) */}
      <button
        type="button"
        onClick={() => {
          const markersList = Object.values(busMarkersRef.current);
          if (internalMapInstance.current && markersList.length > 0) {
            const group = L.featureGroup(markersList);
            internalMapInstance.current.fitBounds(group.getBounds().pad(0.08));
          }
        }}
        className="floating-pill-3d btn-3d btn-3d-light map-btn-bottom-left flex items-center gap-2 rounded-full px-4 py-2.5 min-h-[44px] text-xs font-black text-slate-900 active:scale-95 transition"
        title="Frame the buses currently available on the map"
        aria-label={`Frame ${cityLiveBuses.length} ${cityLiveBusesSource} buses on the map`}
      >
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            cityLiveBusesSource === "live"
              ? "bg-emerald-500 animate-pulse"
              : cityLiveBusesSource === "cached"
                ? "bg-amber-500"
                : cityLiveBusesSource === "fallback"
                  ? "bg-slate-500"
                  : "bg-rose-500"
          }`}
        ></span>
        <span>
          {cityLiveBusesLoading && cityLiveBuses.length === 0
            ? "Checking bus data..."
            : `${cityLiveBuses.length} ${cityLiveBusesSource} buses`}
        </span>
      </button>

      {/* Floating Locate Button at bottom right (3D Tactile Circle — bottom right) */}
      <button
        type="button"
        onClick={locateMe}
        className="btn-3d btn-3d-light map-btn-bottom-right flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-full text-black shadow-md active:scale-95 transition"
        title="Center on my location"
        aria-label="Center map on my current location"
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

      {/* Floating Selected Bus HUD Card over Map */}
      {(() => {
        if (!selectedBusNumber) return null;
        const selBus = cityLiveBuses.find(
          (b) =>
            String(b.vehicleNumber || b.vehno || b.vehicle_number || "").trim() ===
            selectedBusNumber
        );
        const status = selBus ? getBusStatus(selBus) : "GPS UPDATE UNAVAILABLE";
        const speed = selBus ? getBusSpeedLabel(selBus) : "Speed unavailable";
        const routeNo = selBus?.routeNumber || selBus?.rno || "";
        const isLive = status.startsWith("LIVE ·");
        const lastUpdatedRaw =
          selBus?.currentTimestamp ||
          selBus?.telemetryTimestamp ||
          selBus?.timestamp ||
          null;

        const lastUpdatedLabel = lastUpdatedRaw
          ? (() => {
              const parsedTime = new Date(lastUpdatedRaw);
              return Number.isNaN(parsedTime.getTime())
                ? "Time unavailable"
                : parsedTime.toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });
            })()
          : "Time unavailable";

        const selectedRouteData = universalLiveBuses.find((bus) =>
          String(
            bus.vehicle_number || bus.vehicleNumber || bus.vehno || ""
          ).trim() === selectedBusNumber
        );

        const currentStopLabel =
          selectedRouteData?.nearestStop ||
          selectedRouteData?.explicitStop ||
          "Stop information unavailable";

        const nextStopLabel = selectedRouteData?.nextStop || "";

        return (
          <div className="absolute left-3 right-3 bottom-16 z-[400] card-3d rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/95 p-3 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-black text-slate-900 truncate">
                  🚌 {selectedBusNumber}
                </span>
                {routeNo && (
                  <span className="shrink-0 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                    Route {routeNo}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${getBusStatusClasses(
                    status
                  )}`}
                >
                  🟢 {status}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onSelectBusNumber?.(null);
                    onToggleFollowSelectedBus?.(false);
                  }}
                  className="h-8 w-8 min-h-[32px] min-w-[32px] rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xs font-bold transition"
                  title="Deselect bus"
                  aria-label="Deselect bus"
                >
                  ✖
                </button>
              </div>
            </div>

            <div className="mt-2 rounded-xl bg-slate-50 border border-slate-100 px-2.5 py-2 text-[11px] text-slate-600">
              <div>
                📍 Current / Nearby Stop:{" "}
                <b className="text-slate-900">{currentStopLabel}</b>
              </div>
              <div className="mt-1">
                ➡️ Next Stop:{" "}
                <b className="text-slate-900">
                  {nextStopLabel || "Route stop data unavailable"}
                </b>
              </div>
            </div>

            <div className="mt-2 text-[10px] text-slate-500">
              🕒 Last Updated: <b className="text-slate-700">{lastUpdatedLabel}</b>
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600 border-t border-slate-100 pt-2">
              <div>
                Speed: <b className="text-slate-900">{speed}</b>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!isLive}
                  onClick={() => onToggleFollowSelectedBus?.(!followSelectedBus)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    followSelectedBus
                      ? "bg-sky-600 text-white shadow-xs"
                      : "bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <span>{followSelectedBus ? "🎯 Following" : "📍 Follow Bus"}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
