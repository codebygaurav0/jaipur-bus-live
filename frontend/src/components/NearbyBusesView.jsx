import {
  getBusStatus,
  getBusStatusClasses,
} from "../markerAnimation";

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
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

const cleanRouteCode = (str) =>
  String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[-\s]/g, "");

function formatDistance(distKm) {
  if (distKm === null || distKm === undefined || isNaN(distKm)) return "—";
  if (distKm < 1) return `${Math.round(distKm * 1000)} m`;
  return `${distKm.toFixed(1)} km`;
}

export default function NearbyBusesView({
  backToHome,
  cityLiveBuses,
  busesSearchQuery,
  setBusesSearchQuery,
  allStops,
  mapInstance,
  setSelectedBusNumber,
  setFollowSelectedBus,
  setCurrentView,
  selectedBusNumber,
  followSelectedBus,
  availableRoutes = [],
  openRouteSearch,
}) {
  return (
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
              🟢 LIVE
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
                ✖
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
                const busStatus = getBusStatus(bus);

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
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${getBusStatusClasses(busStatus)}`}>
                        {busStatus}
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
                      <button
                        type="button"
                        disabled={!busStatus.startsWith("LIVE ·")}
                        onClick={() => {
                          const vehicleNumber = String(bus.vehno || "").trim();
                          setSelectedBusNumber(vehicleNumber);
                          setFollowSelectedBus((following) =>
                            following && selectedBusNumber === vehicleNumber
                              ? false
                              : true
                          );
                          setCurrentView("home");
                        }}
                        className="flex-1 rounded-xl border border-blue-200 bg-blue-50 py-1.5 text-xs font-bold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {followSelectedBus &&
                        selectedBusNumber === String(bus.vehno || "").trim()
                          ? "Stop Following"
                          : "Follow Bus"}
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
  );
}
