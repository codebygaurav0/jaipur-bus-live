import React, { useEffect, useRef } from "react";
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

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Center on Jaipur Pink Line midpoint (Sindhi Camp / Civil Lines area)
    const map = L.map(mapContainerRef.current, {
      center: [26.905, 75.79],
      zoom: 13,
      zoomControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Stations & Polylines
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !Array.isArray(stations) || stations.length === 0) return;

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
      color: "#e11d48", // Rose-600
      weight: 6,
      opacity: 0.85,
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
        color: "#059669", // Emerald-600
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

      const markerColor = isJourneyStop
        ? "#059669"
        : isSelected
        ? "#000000"
        : isTerminal
        ? "#9f1239"
        : "#e11d48";

      const iconHtml = `
        <div style="
          width: 28px;
          height: 28px;
          background: ${markerColor};
          border: 3px solid #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-size: 11px;
          font-weight: 900;
          box-shadow: 0 4px 12px rgba(0,0,0,0.35);
          cursor: pointer;
          transform: ${isSelected ? "scale(1.25)" : "scale(1)"};
          transition: transform 0.2s ease;
        ">
          ${s.order}
        </div>
      `;

      const stationIcon = L.divIcon({
        className: "custom-metro-marker",
        html: iconHtml,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16],
      });

      const marker = L.marker([s.latitude, s.longitude], { icon: stationIcon })
        .addTo(map)
        .on("click", () => {
          if (onSelectStation) onSelectStation(s);
        });

      // Popup with official details and journey plan triggers
      const popupContent = `
        <div style="font-family: inherit; min-width: 170px;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <span style="background: #e11d48; color: #fff; font-size: 9px; font-weight: 900; padding: 2px 6px; border-radius: 4px;">#${
              s.order
            }</span>
            <span style="font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase;">${
              s.structure
            }</span>
          </div>
          <h4 style="margin: 0; font-size: 13px; font-weight: 800; color: #0f172a;">${
            s.name
          }</h4>
          <p style="margin: 1px 0 6px; font-size: 11px; color: #64748b; font-weight: 600;">${
            s.hindi_name
          }</p>
          ${
            s.interchange !== "None"
              ? `<div style="font-size: 10px; color: #2563eb; font-weight: 700; margin-bottom: 6px; background: #eff6ff; padding: 3px 6px; border-radius: 4px;">🔄 ${s.interchange}</div>`
              : ""
          }
          <div style="display: flex; gap: 4px; margin-top: 6px;">
            <button id="btn-from-${s.station_id}" style="
              flex: 1;
              background: #000;
              color: #fff;
              border: none;
              border-radius: 6px;
              padding: 4px 8px;
              font-size: 10px;
              font-weight: 800;
              cursor: pointer;
            ">Set From</button>
            <button id="btn-to-${s.station_id}" style="
              flex: 1;
              background: #e11d48;
              color: #fff;
              border: none;
              border-radius: 6px;
              padding: 4px 8px;
              font-size: 10px;
              font-weight: 800;
              cursor: pointer;
            ">Set To</button>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on("popupopen", () => {
        const btnFrom = document.getElementById(`btn-from-${s.station_id}`);
        const btnTo = document.getElementById(`btn-to-${s.station_id}`);
        if (btnFrom) {
          btnFrom.onclick = () => {
            if (onSetFromStation) onSetFromStation(s);
            marker.closePopup();
          };
        }
        if (btnTo) {
          btnTo.onclick = () => {
            if (onSetToStation) onSetToStation(s);
            marker.closePopup();
          };
        }
      });

      markersRef.current.push(marker);
    });
  }, [stations, selectedStation, journeyStations]);

  // Recenter on selected station
  useEffect(() => {
    if (!selectedStation || !mapInstanceRef.current) return;
    mapInstanceRef.current.setView(
      [selectedStation.latitude, selectedStation.longitude],
      15,
      { animate: true }
    );
  }, [selectedStation]);

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
    mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
  }, [journeyStations]);

  return (
    <div className="relative w-full h-[320px] rounded-3xl overflow-hidden border border-slate-200/90 shadow-md card-3d">
      <div ref={mapContainerRef} className="w-full h-full z-0" />
      {/* Metro Corridor Tag */}
      <div className="absolute top-3 left-3 z-[400] bg-white/95 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-slate-200 shadow-md flex items-center gap-2 card-3d">
        <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse"></span>
        <span className="text-[11px] font-black tracking-wide text-slate-800 uppercase">
          Pink Line Track (11.97 km)
        </span>
      </div>
    </div>
  );
}

