import { useEffect, useRef, useState } from "react";
import L from "leaflet";

export default function MetroMap({
  stations = [],
  selectedStation = null,
  onSelectStation,
  onSetFromStation,
  onSetToStation,
  journeyStations = [],
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const polylineRef = useRef(null);
  const journeyPolylineRef = useRef(null);
  const callbacksRef = useRef({ onSelectStation, onSetFromStation, onSetToStation });
  const [mapInView, setMapInView] = useState(
    () => typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    callbacksRef.current = { onSelectStation, onSetFromStation, onSetToStation };
  });

  // Viewport IntersectionObserver: initialize OpenStreetMap tiles only when container is near/in viewport
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setMapInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "250px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapInView || !mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    if (mapContainerRef.current._leaflet_id) {
      delete mapContainerRef.current._leaflet_id;
    }

    // Center on Jaipur Pink Line corridor midpoint (Sindhi Camp / Civil Lines)
    const map = L.map(mapContainerRef.current, {
      center: [26.914, 75.795],
      zoom: 13,
      zoomControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      subdomains: ["a", "b", "c"],
      crossOrigin: "anonymous",
      tileSize: 256,
      keepBuffer: 2,
      updateWhenIdle: true,
      updateWhenZooming: false,
      className: "metro-osm-tile",
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    mapInstanceRef.current = map;

    // Handle container resize & Leaflet tile invalidation
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    const handleResize = () => {
      map.invalidateSize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [mapInView]);

  // Update Stations & Polylines
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !Array.isArray(stations) || stations.length === 0) return;

    // Invalidate size in case tab just switched
    map.invalidateSize();

    // Clear old markers
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];

    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }
    if (journeyPolylineRef.current) {
      map.removeLayer(journeyPolylineRef.current);
      journeyPolylineRef.current = null;
    }

    // 1. Full Pink Line Track Polyline
    const trackLatLngs = stations.map((s) => [s.latitude, s.longitude]);
    const trackPolyline = L.polyline(trackLatLngs, {
      color: "#e11d48", // Pink Line Official Color
      weight: 6,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);
    polylineRef.current = trackPolyline;

    // 2. Journey Highlight Polyline (if journey is active)
    if (Array.isArray(journeyStations) && journeyStations.length > 1) {
      const journeyLatLngs = journeyStations.map((s) => [
        s.latitude,
        s.longitude,
      ]);
      const journeyPoly = L.polyline(journeyLatLngs, {
        color: "#059669", // Emerald Green for active journey
        weight: 8,
        opacity: 0.95,
        dashArray: "8, 6",
        lineCap: "round",
      }).addTo(map);
      journeyPolylineRef.current = journeyPoly;
    }

    // 3. Station Markers
    stations.forEach((s) => {
      const isSelected = selectedStation?.station_id === s.station_id;
      const isJourneyStop = journeyStations.some(
        (js) => js.station_id === s.station_id
      );
      const isTerminal = s.order === 1 || s.order === stations.length;
      const isUnderground = s.structure?.toLowerCase().includes("underground");

      // Dynamic marker styling
      let bgGrad = isJourneyStop
        ? "linear-gradient(135deg, #059669 0%, #10b981 100%)"
        : isSelected
        ? "linear-gradient(135deg, #022c22 0%, #064e3b 100%)"
        : isTerminal
        ? "linear-gradient(135deg, #be185d 0%, #e11d48 100%)"
        : "linear-gradient(135deg, #e11d48 0%, #f43f5e 100%)";

      const borderStyle = isJourneyStop
        ? "3px solid #ffffff"
        : isSelected
        ? "3px solid #fde68a"
        : isUnderground
        ? "3px solid #f3e8ff"
        : "3px solid #ffffff";

      const shadow = isSelected
        ? "0 0 0 4px rgba(225,29,72,0.35), 0 6px 14px rgba(0,0,0,0.3)"
        : "0 4px 10px rgba(0,0,0,0.25)";

      const iconHtml = `
        <div style="
          width: 30px;
          height: 30px;
          background: ${bgGrad};
          border: ${borderStyle};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-size: 11.5px;
          font-weight: 900;
          box-shadow: ${shadow};
          cursor: pointer;
          transform: ${isSelected ? "scale(1.2)" : "scale(1)"};
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          font-family: inherit;
        ">
          ${s.order}
        </div>
      `;

      const stationIcon = L.divIcon({
        className: "custom-metro-marker",
        html: iconHtml,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -18],
      });

      const marker = L.marker([s.latitude, s.longitude], { icon: stationIcon })
        .addTo(map)
        .on("click", () => {
          callbacksRef.current.onSelectStation?.(s);
        });

      // Professional Popup
      const popupContent = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-width: 190px; padding: 2px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <span style="background: #e11d48; color: #ffffff; font-size: 10px; font-weight: 900; padding: 2px 7px; border-radius: 6px;">
              Stop #${s.order}
            </span>
            <span style="font-size: 9.5px; font-weight: 800; color: ${isUnderground ? '#7e22ce' : '#0369a1'}; background: ${isUnderground ? '#f3e8ff' : '#e0f2fe'}; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">
              ${s.structure || 'Elevated'}
            </span>
          </div>

          <h4 style="margin: 0; font-size: 14px; font-weight: 850; color: #064e3b; letter-spacing: -0.01em;">
            ${s.name}
          </h4>
          <p style="margin: 2px 0 6px; font-size: 11.5px; color: #64748b; font-weight: 600;">
            ${s.hindi_name || ''}
          </p>

          ${
            s.interchange && s.interchange !== "None"
              ? `<div style="font-size: 10.5px; color: #0369a1; font-weight: 700; margin-bottom: 8px; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 4px 7px; border-radius: 6px;">
                  🔄 ${s.interchange}
                </div>`
              : ""
          }

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0;">
            <button id="btn-from-${s.station_id}" style="
              background: #064e3b;
              color: #ffffff;
              border: none;
              border-radius: 6px;
              padding: 6px 8px;
              font-size: 10.5px;
              font-weight: 850;
              cursor: pointer;
            ">Board Here</button>
            <button id="btn-to-${s.station_id}" style="
              background: #e11d48;
              color: #ffffff;
              border: none;
              border-radius: 6px;
              padding: 6px 8px;
              font-size: 10.5px;
              font-weight: 850;
              cursor: pointer;
            ">Alight Here</button>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on("popupopen", () => {
        const btnFrom = document.getElementById(`btn-from-${s.station_id}`);
        const btnTo = document.getElementById(`btn-to-${s.station_id}`);
        if (btnFrom) {
          btnFrom.onclick = () => {
            callbacksRef.current.onSetFromStation?.(s);
            marker.closePopup();
          };
        }
        if (btnTo) {
          btnTo.onclick = () => {
            callbacksRef.current.onSetToStation?.(s);
            marker.closePopup();
          };
        }
      });

      marker._stationId = s.station_id;
      markersRef.current.push(marker);
    });
  }, [stations, selectedStation, journeyStations]);

  // Recenter on selected station and reveal popup
  useEffect(() => {
    if (!selectedStation || !mapInstanceRef.current) return;
    mapInstanceRef.current.setView(
      [selectedStation.latitude, selectedStation.longitude],
      15,
      { animate: true }
    );
    const m = markersRef.current.find(
      (item) => item._stationId === selectedStation.station_id
    );
    if (m) {
      m.openPopup();
    }
  }, [mapInView, selectedStation]);

  // Fit bounds when journey is planned
  useEffect(() => {
    if (
      !journeyStations ||
      journeyStations.length === 0 ||
      !mapInstanceRef.current
    )
      return;
    const bounds = L.latLngBounds(
      journeyStations.map((s) => [s.latitude, s.longitude])
    );
    mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
  }, [journeyStations]);

  const handleResetCorridor = () => {
    if (!mapInstanceRef.current || stations.length === 0) return;
    const bounds = L.latLngBounds(
      stations.map((s) => [s.latitude, s.longitude])
    );
    mapInstanceRef.current.fitBounds(bounds, { padding: [30, 30] });
  };

  return (
    <div className="w-full">
      <div className="metro-map-container">
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* Floating Corridor Tag & Controls */}
        <div className="metro-map-floating-overlay">
          <div className="metro-map-tag">
            <span className="metro-status-dot" style={{ background: "#e11d48" }}></span>
            <span>Pink Line Track (11.97 km)</span>
          </div>

          <button
            type="button"
            onClick={handleResetCorridor}
            className="metro-map-tag"
            style={{ cursor: "pointer", background: "rgba(255,255,255,0.9)", minHeight: "44px", padding: "10px 14px" }}
            title="Fit complete corridor view"
          >
            <span>⛶ Reset View</span>
          </button>
        </div>
      </div>

      {/* Map Legend Bar */}
      <div className="metro-map-legend-bar">
        <span className="metro-legend-item">
          <span className="metro-legend-chip" style={{ background: "#e11d48" }}></span>
          Pink Line
        </span>
        <span className="metro-legend-item">
          <span className="metro-legend-chip" style={{ background: "#059669" }}></span>
          Active Trip
        </span>
        <span className="metro-legend-item">
          <span className="metro-legend-chip" style={{ background: "#e0f2fe", border: "1px solid #0369a1" }}></span>
          Elevated (8)
        </span>
        <span className="metro-legend-item">
          <span className="metro-legend-chip" style={{ background: "#f3e8ff", border: "1px solid #7e22ce" }}></span>
          Underground (3)
        </span>
      </div>
    </div>
  );
}
