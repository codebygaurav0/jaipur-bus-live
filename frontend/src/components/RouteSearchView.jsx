import {
  getBusStatus,
  getBusStatusClasses,
  getBusSpeedLabel,
} from "../markerAnimation";
import TelemetryLiveAgeBadge from "./TelemetryLiveAgeBadge";

const cleanRouteCode = (str) =>
  String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[-\s]/g, "");

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

export default function RouteSearchView({
  backToHome,
  selectedUniversalRoute,
  setSelectedUniversalRoute,
  universalSearchQuery,
  setUniversalSearchQuery,
  showUniversalDropdown,
  setShowUniversalDropdown,
  availableRoutes,
  universalRouteLoading,
  universalRouteError,
  universalRouteMap,
  setUniversalRouteMap,
  universalLiveBuses,
  setUniversalLiveBuses,
  universalRouteSource = "unavailable",
  routeDirections,
  getUniversalSearchResults,
  handleSelectRouteDirection,
  mapInstance,
  setCurrentView,
  setSelectedBusNumber,
  setFollowSelectedBus,
  lastTelemetryUpdate = "",
  loadUniversalRoute,
}) {
  return (
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
                ✖
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
                        {isActive ? "🟢 Active" : "Switch ⇄"}
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
                      {universalLiveBuses.length} {universalRouteSource === "cached" ? "cached" : "active"} bus{universalLiveBuses.length === 1 ? "" : "es"}
                    </span>
                  ) : universalRouteSource === "live" ? (
                    <span className="text-slate-500 font-medium">
                      0 active live buses
                    </span>
                  ) : (
                    <span className="text-slate-500 font-medium">
                      Bus locations unavailable
                    </span>
                  )}
                </span>
                <span className={`font-bold ${
                  universalRouteSource === "live"
                    ? "text-green-700"
                    : universalRouteSource === "cached"
                      ? "text-amber-700"
                      : "text-slate-500"
                }`}>
                  {universalRouteSource === "live"
                    ? <>🟢 LIVE{lastTelemetryUpdate && <> • <TelemetryLiveAgeBadge timestamp={lastTelemetryUpdate} /></>}</>
                    : universalRouteSource === "cached"
                      ? <>CACHED{lastTelemetryUpdate && <> • <TelemetryLiveAgeBadge timestamp={lastTelemetryUpdate} /></>}</>
                      : universalRouteSource === "fallback"
                        ? "FALLBACK"
                        : "UNAVAILABLE"}
                </span>
              </div>

              {(universalLiveBuses.length === 0 || universalRouteSource !== "live") && (
                <div className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50/90 border border-amber-200/70 px-3 py-1.5 text-[11px] text-amber-900">
                  <span className="text-sm">ℹ️</span>
                  <span>
                    {universalRouteSource === "live"
                      ? "No buses are currently reporting GPS for this route. Showing verified JCTSL route stops."
                      : universalRouteSource === "cached"
                        ? universalLiveBuses.length > 0
                          ? "Showing cached bus locations; they may not reflect current positions."
                          : "No buses appear in the cached snapshot. Showing verified JCTSL route stops."
                        : universalRouteSource === "fallback"
                          ? "Live bus service is unavailable. Showing verified route stops."
                          : "Live bus status could not be retrieved. Showing verified route stops."}
                  </span>
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

                        <span className="text-sm font-bold uppercase tracking-tight text-black select-none whitespace-normal break-words">
                          {st.bus_stop || st.bus_stop_name || st.stop_name || st.stopName || st.busStopName || st.name || st.stopname || "Stop name unavailable"}
                        </span>
                      </div>

                      {/* Live Buses along this stop */}
                      {stopBusesAtNode.length > 0 && (
                        <div className="timeline-stop-item">
                          <div className="timeline-marker-anchor">
                            <div className="timeline-marker-intermediate">↓</div>
                          </div>
                          <span className="text-sm font-bold uppercase tracking-tight text-black whitespace-normal break-words">
                            {st.bus_stop || st.bus_stop_name || st.stop_name || st.stopName || st.busStopName || st.name || st.stopname || "Stop name unavailable"}
                          </span>
                        </div>
                      )}
                      {stopBusesAtNode.map((bus, bIdx) => {
                        const busStatus = getBusStatus(bus);
                        const speedLabel = getBusSpeedLabel(bus);
                        return (
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
                                const busLat = Number(bus.latitude);
                                const busLng = Number(bus.longitude);
                                const busNumber = String(
                                  bus.vehicle_number || bus.vehno || bus.vehicleNumber || ""
                                ).trim();

                                if (
                                  busNumber &&
                                  Number.isFinite(busLat) &&
                                  Number.isFinite(busLng) &&
                                  busLat >= 26 &&
                                  busLat <= 30 &&
                                  busLng >= 74 &&
                                  busLng <= 78
                                ) {
                                  setSelectedBusNumber(busNumber);
                                  setFollowSelectedBus(false);
                                  setCurrentView("home");

                                  setTimeout(() => {
                                    if (mapInstance.current) {
                                      mapInstance.current.setView(
                                        [busLat, busLng],
                                        16,
                                        { animate: true }
                                      );
                                    }
                                  }, 250);
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
                                  <span className={`rounded text-[9px] font-black px-1.5 py-0.5 ${getBusStatusClasses(busStatus)}`}>
                                    🟢 {busStatus}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-medium mt-0.5 space-x-1.5">
                                  <span>{speedLabel}</span>
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
                        );
                      })}
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
  );
}
