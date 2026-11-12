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

function formatDistance(distKm) {
  if (distKm === null || distKm === undefined || isNaN(distKm)) return "—";
  if (distKm < 1) return `${Math.round(distKm * 1000)} m`;
  return `${distKm.toFixed(1)} km`;
}

export default function NearbyStopsView({
  backToHome,
  allStops,
  stopsSearchQuery,
  setStopsSearchQuery,
  hasUserLocation,
  location,
  openStopDetails,
}) {
  return (
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
                ✖
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
                        {distKm !== null ? `${formatDistance(distKm)} away` : `Stop #${idx + 1}`} • Lat: {String(stop.latitude ?? "").slice(0, 7)}, Lng: {String(stop.longitude ?? "").slice(0, 7)}
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
  );
}
