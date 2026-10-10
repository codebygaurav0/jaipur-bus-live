import React, { useState } from "react";

export default function MetroJourney({
  stations = [],
  fromStation,
  toStation,
  setFromStation,
  setToStation,
  onJourneyCalculated,
}) {
  const [loading, setLoading] = useState(false);
  const [journeyResult, setJourneyResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);

  const handleSwap = () => {
    const tmp = fromStation;
    setFromStation(toStation);
    setToStation(tmp);
    if (toStation && tmp) {
      calculateJourney(toStation.code, tmp.code);
    }
  };

  const calculateJourney = async (fromCode, toCode) => {
    if (!fromCode || !toCode) return;
    if (fromCode === toCode) {
      setErrorMsg("Origin and destination stations cannot be the same.");
      setJourneyResult(null);
      return;
    }

    try {
      setLoading(true);
      setErrorMsg("");
      const res = await fetch(
        `https://jaipur-bus-live-5nvg.vercel.app/api/metro/journey?from=${encodeURIComponent(
          fromCode
        )}&to=${encodeURIComponent(toCode)}`
      );
      const data = await res.json();

      if (!data.success) {
        setErrorMsg(data.message || "Failed to calculate metro journey.");
        setJourneyResult(null);
        if (onJourneyCalculated) onJourneyCalculated([]);
        return;
      }

      setJourneyResult(data);
      if (onJourneyCalculated) onJourneyCalculated(data.stations || []);
    } catch (err) {
      console.warn("Metro journey error:", err);
      setErrorMsg("Unable to connect to Metro journey service.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* FROM / TO SELECTION CARD */}
      <div className="rounded-3xl border border-slate-200 bg-white p-4.5 card-3d space-y-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black uppercase tracking-wider text-rose-600 flex items-center gap-1.5">
            <span>🚇</span> Pink Line Journey Planner
          </span>
          <span className="text-[10px] font-bold text-slate-400">
            JMRC Official Slabs
          </span>
        </div>

        {/* FROM STATION INPUT */}
        <div className="relative">
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">
            From Station
          </label>
          <div
            onClick={() => setShowFromDropdown(!showFromDropdown)}
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 cursor-pointer hover:border-rose-400 transition card-3d-sunken"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></span>
              <span className="text-xs font-bold text-slate-900 truncate">
                {fromStation
                  ? `${fromStation.name} (${fromStation.hindi_name})`
                  : "Select boarding metro station"}
              </span>
            </div>
            {fromStation ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFromStation(null);
                  setJourneyResult(null);
                }}
                className="text-xs text-slate-400 hover:text-black font-bold p-1"
              >
                ✕
              </button>
            ) : (
              <span className="text-xs text-slate-400">▾</span>
            )}
          </div>

          {showFromDropdown && (
            <div className="absolute left-0 right-0 top-full mt-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl z-50 max-h-56 overflow-y-auto">
              {stations.map((s) => (
                <div
                  key={s.station_id}
                  onClick={() => {
                    setFromStation(s);
                    setShowFromDropdown(false);
                  }}
                  className="flex items-center justify-between p-2.5 hover:bg-rose-50 rounded-xl cursor-pointer text-xs transition"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-rose-100 text-rose-700 px-1.5 py-0.5 text-[10px] font-black">
                      #{s.order}
                    </span>
                    <span className="font-bold text-slate-900">{s.name}</span>
                    <span className="text-[10px] text-slate-400">
                      {s.hindi_name}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {s.structure}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SWAP BUTTON */}
        <div className="flex justify-center -my-1">
          <button
            type="button"
            onClick={handleSwap}
            disabled={!fromStation && !toStation}
            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-black text-slate-700 disabled:opacity-40 transition btn-3d btn-3d-light"
          >
            <span>⇅</span> Swap Stations
          </button>
        </div>

        {/* TO STATION INPUT */}
        <div className="relative">
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">
            To Station
          </label>
          <div
            onClick={() => setShowToDropdown(!showToDropdown)}
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 cursor-pointer hover:border-rose-400 transition card-3d-sunken"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0"></span>
              <span className="text-xs font-bold text-slate-900 truncate">
                {toStation
                  ? `${toStation.name} (${toStation.hindi_name})`
                  : "Select destination metro station"}
              </span>
            </div>
            {toStation ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setToStation(null);
                  setJourneyResult(null);
                }}
                className="text-xs text-slate-400 hover:text-black font-bold p-1"
              >
                ✕
              </button>
            ) : (
              <span className="text-xs text-slate-400">▾</span>
            )}
          </div>

          {showToDropdown && (
            <div className="absolute left-0 right-0 top-full mt-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl z-50 max-h-56 overflow-y-auto">
              {stations.map((s) => (
                <div
                  key={s.station_id}
                  onClick={() => {
                    setToStation(s);
                    setShowToDropdown(false);
                  }}
                  className="flex items-center justify-between p-2.5 hover:bg-rose-50 rounded-xl cursor-pointer text-xs transition"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-rose-100 text-rose-700 px-1.5 py-0.5 text-[10px] font-black">
                      #{s.order}
                    </span>
                    <span className="font-bold text-slate-900">{s.name}</span>
                    <span className="text-[10px] text-slate-400">
                      {s.hindi_name}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {s.structure}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SEARCH BUTTON */}
        <button
          type="button"
          onClick={() =>
            calculateJourney(fromStation?.code, toStation?.code)
          }
          disabled={!fromStation || !toStation || loading}
          className="w-full rounded-2xl py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-40 transition btn-3d btn-3d-metro"
        >
          {loading ? "Calculating Route..." : "Plan Metro Journey"}
        </button>

        {errorMsg && (
          <p className="text-xs font-bold text-red-600 text-center">{errorMsg}</p>
        )}
      </div>

      {/* JOURNEY RESULTS CARD */}
      {journeyResult && (
        <div className="rounded-3xl border border-slate-200 bg-white p-4.5 card-3d space-y-4">
          {/* Header Summary */}
          <div className="flex items-start justify-between border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-black text-white">
                  Pink Line
                </span>
                <span className="text-xs font-bold text-slate-900">
                  {journeyResult.direction}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium mt-1">
                {journeyResult.total_stops} stations • ~
                {journeyResult.estimated_travel_time_mins} mins •{" "}
                {journeyResult.distance_km} km
              </p>
            </div>
            <div className="text-right">
              <span className="text-base font-black text-rose-600">
                ₹{journeyResult.fare?.token_fare}
              </span>
              <p className="text-[9px] text-slate-400 font-bold uppercase">
                Single Token
              </p>
            </div>
          </div>

          {/* Fare Details */}
          <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-2xl border border-slate-100 card-3d-sunken">
            <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-xs card-3d">
              <span className="text-[9px] font-black uppercase text-slate-400 block">
                Standard Token
              </span>
              <span className="text-sm font-black text-slate-900">
                ₹{journeyResult.fare?.token_fare}
              </span>
              <p className="text-[9px] text-slate-500 mt-0.5">Cash / Counter</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200/80 shadow-xs card-3d">
              <span className="text-[9px] font-black uppercase text-emerald-700 block">
                Smart Card (10% Off)
              </span>
              <span className="text-sm font-black text-emerald-700">
                ₹{journeyResult.fare?.smart_card_fare}
              </span>
              <p className="text-[9px] text-emerald-600 mt-0.5">JMRC Metro Card</p>
            </div>
          </div>

          {/* Operating Timings */}
          <div className="flex items-center justify-between text-[11px] bg-rose-50/70 p-3 rounded-2xl border border-rose-200/80 text-rose-950 font-bold card-3d">
            <div>
              <span className="text-[9px] uppercase text-rose-600 block">
                First Train
              </span>
              <span>{journeyResult.operating_hours?.first_train}</span>
            </div>
            <div>
              <span className="text-[9px] uppercase text-rose-600 block">
                Last Train
              </span>
              <span>{journeyResult.operating_hours?.last_train}</span>
            </div>
            <div>
              <span className="text-[9px] uppercase text-rose-600 block">
                Headway
              </span>
              <span>Every {journeyResult.operating_hours?.frequency_mins}m</span>
            </div>
          </div>

          {/* Straight Vertical Station Timeline */}
          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Station Sequence ({journeyResult.stations?.length} stops)
            </p>
            <div className="relative pl-6 space-y-3">
              {/* Vertical straight line */}
              <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-rose-200"></div>

              {journeyResult.stations?.map((st, idx) => {
                const isStart = idx === 0;
                const isEnd = idx === journeyResult.stations.length - 1;

                return (
                  <div key={st.station_id} className="relative flex items-start gap-3">
                    {/* Circle Node */}
                    <div
                      className={`absolute -left-6 top-1 w-3 h-3 rounded-full border-2 border-white shadow-xs z-10 ${
                        isStart
                          ? "bg-emerald-500 ring-2 ring-emerald-200"
                          : isEnd
                          ? "bg-rose-600 ring-2 ring-rose-200"
                          : "bg-slate-400"
                      }`}
                    />

                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-900">
                          {st.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {st.hindi_name}
                        </span>
                        <span className="rounded text-[9px] bg-slate-100 text-slate-600 px-1 py-0.2 font-semibold">
                          {st.structure}
                        </span>
                      </div>
                      {st.interchange !== "None" && (
                        <p className="text-[10px] text-blue-600 font-bold mt-0.5">
                          🔄 {st.interchange}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Genuine Data Notice */}
          <div className="rounded-2xl bg-slate-50 p-2.5 border border-slate-200 text-slate-500 text-[10px] leading-relaxed">
            <span className="font-bold text-slate-700">Notice: </span>
            {journeyResult.live_telemetry_notice}
          </div>
        </div>
      )}
    </div>
  );
}

