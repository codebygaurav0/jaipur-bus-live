import React, { useState } from "react";

export default function MetroSearch({
  stations = [],
  selectedStation,
  onSelectStation,
  onSetFromStation,
  onSetToStation,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedStationId, setExpandedStationId] = useState(null);

  const clean = (s) =>
    String(s || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, "");

  const filteredStations = stations.filter((s) => {
    if (!searchQuery) return true;
    const q = clean(searchQuery);
    const qRaw = searchQuery.toLowerCase();
    const nameMatch = clean(s.name).includes(q) || s.name.toLowerCase().includes(qRaw);
    const hindiMatch = (s.hindi_name || "").includes(searchQuery);
    const codeMatch = (s.code || "").toLowerCase().includes(qRaw);
    return nameMatch || hindiMatch || codeMatch;
  });

  return (
    <div className="space-y-3">
      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search metro station (e.g. Sindhi Camp, Chandpole, मानसरोवर)"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-xs font-bold text-black outline-none focus:border-rose-500 card-3d-sunken transition"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-black"
          >
            ✕
          </button>
        )}
      </div>

      {/* Stations List Header */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
          Pink Line Stations ({filteredStations.length} of {stations.length})
        </span>
        <span className="text-[10px] font-bold text-slate-400">
          Mansarovar ↔ Badi Chaupar
        </span>
      </div>

      {/* Stations Cards */}
      <div className="space-y-2">
        {filteredStations.map((st) => {
          const isSelected = selectedStation?.station_id === st.station_id;
          const isExpanded = expandedStationId === st.station_id;

          return (
            <div
              key={st.station_id}
              className={`rounded-2xl border bg-white p-3.5 transition ${
                isSelected
                  ? "border-rose-500 ring-2 ring-rose-200 card-3d"
                  : "border-slate-200 hover:border-slate-300 card-3d-interactive"
              }`}
            >
              <div className="flex items-start justify-between">
                <div
                  className="cursor-pointer flex-1"
                  onClick={() => {
                    if (onSelectStation) onSelectStation(st);
                    setExpandedStationId(isExpanded ? null : st.station_id);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-black text-white shrink-0">
                      #{st.order}
                    </span>
                    <h4 className="font-bold text-xs text-slate-900">{st.name}</h4>
                    <span className="text-[11px] text-slate-400 font-medium">
                      {st.hindi_name}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                        st.structure === "Underground"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {st.structure}
                    </span>
                  </div>

                  {st.interchange !== "None" && (
                    <p className="text-[10px] text-blue-600 font-bold mt-1.5 flex items-center gap-1">
                      <span>🔄</span> {st.interchange}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setExpandedStationId(isExpanded ? null : st.station_id)
                  }
                  className="text-xs text-slate-400 hover:text-black font-bold px-2 py-1"
                >
                  {isExpanded ? "▲" : "▼"}
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    if (onSelectStation) onSelectStation(st);
                  }}
                  className="flex-1 rounded-xl py-2 text-[10px] font-black uppercase transition btn-3d btn-3d-light"
                >
                  📍 Pin On Map
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onSetFromStation) onSetFromStation(st);
                  }}
                  className="flex-1 rounded-xl py-2 text-[10px] font-black uppercase transition btn-3d btn-3d-dark"
                >
                  Set From
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onSetToStation) onSetToStation(st);
                  }}
                  className="flex-1 rounded-xl py-2 text-[10px] font-black uppercase transition btn-3d btn-3d-metro"
                >
                  Set To
                </button>
              </div>

              {/* Expandable Details Card */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-slate-100 bg-slate-50/70 -mx-3.5 -mb-3.5 p-3.5 rounded-b-2xl space-y-2.5">
                  {/* First / Last Train Schedule */}
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 card-3d">
                      <span className="font-black text-rose-600 block uppercase text-[9px]">
                        Towards Badi Chaupar
                      </span>
                      <p className="mt-0.5 text-slate-700">
                        First: <span className="font-bold">{st.first_train?.towards_badi_chaupar}</span>
                      </p>
                      <p className="text-slate-700">
                        Last: <span className="font-bold">{st.last_train?.towards_badi_chaupar}</span>
                      </p>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 card-3d">
                      <span className="font-black text-rose-600 block uppercase text-[9px]">
                        Towards Mansarovar
                      </span>
                      <p className="mt-0.5 text-slate-700">
                        First: <span className="font-bold">{st.first_train?.towards_mansarovar}</span>
                      </p>
                      <p className="text-slate-700">
                        Last: <span className="font-bold">{st.last_train?.towards_mansarovar}</span>
                      </p>
                    </div>
                  </div>

                  {/* Facilities */}
                  {Array.isArray(st.facilities) && st.facilities.length > 0 && (
                    <div>
                      <span className="text-[9px] font-black uppercase text-slate-400 block mb-1">
                        Station Facilities
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {st.facilities.map((fac, i) => (
                          <span
                            key={i}
                            className="rounded-lg bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                          >
                            ✓ {fac}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Coordinates */}
                  <div className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>GPS: {st.latitude.toFixed(5)}, {st.longitude.toFixed(5)}</span>
                    <span>Distance from Start: {st.distance_km} km</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

