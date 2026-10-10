import React, { useState, useEffect } from "react";
import MetroMap from "./MetroMap";
import MetroJourney from "./MetroJourney";
import MetroSearch from "./MetroSearch";

export default function MetroHome({ onBackToBus }) {
  const [stations, setStations] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("journey"); // "journey" | "stations" | "fares"

  const [fromStation, setFromStation] = useState(null);
  const [toStation, setToStation] = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);
  const [journeyStations, setJourneyStations] = useState([]);

  useEffect(() => {
    fetchMetroData();
  }, []);

  const fetchMetroData = async () => {
    try {
      setLoading(true);
      const [stRes, statusRes] = await Promise.allSettled([
        fetch("https://jaipur-bus-live-5nvg.vercel.app/api/metro/stations").then((r) =>
          r.json()
        ),
        fetch("https://jaipur-bus-live-5nvg.vercel.app/api/metro/status").then((r) => r.json()),
      ]);

      if (stRes.status === "fulfilled" && Array.isArray(stRes.value?.stations)) {
        setStations(stRes.value.stations);
        // Default From/To suggestions: Mansarovar and Badi Chaupar
        if (stRes.value.stations.length >= 2) {
          setFromStation(stRes.value.stations[0]); // Mansarovar
          setToStation(stRes.value.stations[stRes.value.stations.length - 1]); // Badi Chaupar
        }
      }

      if (statusRes.status === "fulfilled" && statusRes.value?.success) {
        setStatus(statusRes.value);
      }
    } catch (err) {
      console.warn("Fetch metro data error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectStation = (st) => {
    setSelectedStation(st);
  };

  const handleSetFromStation = (st) => {
    setFromStation(st);
    setActiveTab("journey");
  };

  const handleSetToStation = (st) => {
    setToStation(st);
    setActiveTab("journey");
  };

  return (
    <div className="space-y-4 pb-12">
      {/* 1. METRO SYSTEM HERO CARD */}
      <div className="rounded-3xl bg-linear-to-br from-rose-600 via-rose-700 to-pink-800 p-4.5 text-white shadow-lg border border-rose-500/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl filter drop-shadow">🚇</span>
            <div>
              <h2 className="text-sm font-black tracking-wide uppercase">
                Jaipur Metro • Pink Line
              </h2>
              <p className="text-[10px] text-rose-200 font-medium">
                Phase 1A & 1B (Mansarovar ↔ Badi Chaupar)
              </p>
            </div>
          </div>
          <span className="rounded-full bg-white/20 backdrop-blur-xs px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-2xs border border-white/20">
            ● Operational
          </span>
        </div>

        {/* Metro Key Stats */}
        <div className="grid grid-cols-3 gap-2 mt-3.5 pt-3 border-t border-rose-500/40 text-center">
          <div className="bg-white/10 rounded-2xl p-2.5 border border-white/10 shadow-inner">
            <span className="text-xs font-black block">11 Stations</span>
            <span className="text-[9px] text-rose-200">11.97 km Route</span>
          </div>
          <div className="bg-white/10 rounded-2xl p-2.5 border border-white/10 shadow-inner">
            <span className="text-xs font-black block">6:20 AM - 9:50 PM</span>
            <span className="text-[9px] text-rose-200">Daily Operations</span>
          </div>
          <div className="bg-white/10 rounded-2xl p-2.5 border border-white/10 shadow-inner">
            <span className="text-xs font-black block">10-12 Mins</span>
            <span className="text-[9px] text-rose-200">Peak Headway</span>
          </div>
        </div>
      </div>

      {/* Real Data Notice Banner */}
      <div className="flex items-center gap-2.5 rounded-2xl bg-amber-50 border border-amber-200/80 p-3 text-amber-950 text-xs card-3d">
        <span className="text-base shrink-0">ℹ️</span>
        <div className="leading-tight">
          <span className="font-black text-[11px] block uppercase tracking-wide text-amber-900">
            Official JMRC Passenger Information
          </span>
          <span className="text-[10px] text-amber-800 font-medium">
            Live train GPS is not publicly available. Showing authorized JMRC timetable, fare slabs, and station coordinates.
          </span>
        </div>
      </div>

      {/* 2. TAB NAVIGATION */}
      <div className="flex rounded-2xl bg-slate-100/90 p-1 border border-slate-200 card-3d-sunken text-xs font-black">
        <button
          type="button"
          onClick={() => setActiveTab("journey")}
          className={`flex-1 rounded-xl py-2 transition text-center ${
            activeTab === "journey"
              ? "bg-white text-rose-600 shadow-sm font-black border border-slate-200/60"
              : "text-slate-600 hover:text-black active:translate-y-0.5"
          }`}
        >
          🗺️ Journey & Map
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("stations")}
          className={`flex-1 rounded-xl py-2 transition text-center ${
            activeTab === "stations"
              ? "bg-white text-rose-600 shadow-sm font-black border border-slate-200/60"
              : "text-slate-600 hover:text-black active:translate-y-0.5"
          }`}
        >
          🔍 Stations ({stations.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("fares")}
          className={`flex-1 rounded-xl py-2 transition text-center ${
            activeTab === "fares"
              ? "bg-white text-rose-600 shadow-sm font-black border border-slate-200/60"
              : "text-slate-600 hover:text-black active:translate-y-0.5"
          }`}
        >
          💳 Fares & Timings
        </button>
      </div>

      {/* Loading & Error States */}
      {loading ? (
        <div className="py-16 text-center text-slate-500">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-3 border-rose-600 border-t-transparent"></div>
          <p className="mt-3 text-xs font-bold">Loading Jaipur Metro stations...</p>
        </div>
      ) : stations.length === 0 ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center space-y-2">
          <p className="text-xs font-bold text-red-700">Unable to load metro data</p>
          <button
            type="button"
            onClick={fetchMetroData}
            className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white hover:bg-rose-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* 3. TAB CONTENT */}
          {activeTab === "journey" && (
        <div className="space-y-4">
          {/* Interactive Map */}
          <MetroMap
            stations={stations}
            selectedStation={selectedStation}
            onSelectStation={handleSelectStation}
            onSetFromStation={handleSetFromStation}
            onSetToStation={handleSetToStation}
            journeyStations={journeyStations}
          />

          {/* Journey Planner */}
          <MetroJourney
            stations={stations}
            fromStation={fromStation}
            toStation={toStation}
            setFromStation={setFromStation}
            setToStation={setToStation}
            onJourneyCalculated={setJourneyStations}
          />
        </div>
      )}

      {activeTab === "stations" && (
        <div className="space-y-4">
          <MetroSearch
            stations={stations}
            selectedStation={selectedStation}
            onSelectStation={handleSelectStation}
            onSetFromStation={handleSetFromStation}
            onSetToStation={handleSetToStation}
          />
        </div>
      )}

      {activeTab === "fares" && (
        <div className="space-y-4">
          {/* Official Fare Slabs */}
          <div className="rounded-3xl border border-slate-200 bg-white p-4.5 card-3d space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="text-xs font-black uppercase text-slate-900">
                Official JMRC Fare Slabs
              </h3>
              <span className="text-[10px] font-black text-rose-600">
                ₹6 - ₹22 Max
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200/80 card-3d">
                <div>
                  <span className="font-bold text-slate-800">0 – 2 Stations</span>
                  <p className="text-[10px] text-slate-500">Short hop journey</p>
                </div>
                <div className="text-right">
                  <span className="font-black text-slate-900 block">₹6 Token</span>
                  <span className="text-[10px] font-bold text-emerald-600">
                    ₹5.40 Smart Card
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200/80 card-3d">
                <div>
                  <span className="font-bold text-slate-800">3 – 5 Stations</span>
                  <p className="text-[10px] text-slate-500">Medium distance</p>
                </div>
                <div className="text-right">
                  <span className="font-black text-slate-900 block">₹12 Token</span>
                  <span className="text-[10px] font-bold text-emerald-600">
                    ₹10.80 Smart Card
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200/80 card-3d">
                <div>
                  <span className="font-bold text-slate-800">6 – 8 Stations</span>
                  <p className="text-[10px] text-slate-500">Long distance</p>
                </div>
                <div className="text-right">
                  <span className="font-black text-slate-900 block">₹18 Token</span>
                  <span className="text-[10px] font-bold text-emerald-600">
                    ₹16.20 Smart Card
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-2xl bg-rose-50/70 border border-rose-200/80 card-3d">
                <div>
                  <span className="font-bold text-rose-950">9 – 10 Stations</span>
                  <p className="text-[10px] text-rose-700">Full corridor terminal to terminal</p>
                </div>
                <div className="text-right">
                  <span className="font-black text-rose-700 block">₹22 Token</span>
                  <span className="text-[10px] font-bold text-emerald-600">
                    ₹19.80 Smart Card
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-amber-50 p-3 border border-amber-200/80 text-amber-900 text-[10px] leading-relaxed card-3d">
              <span className="font-bold">Smart Card Privilege: </span>
              Commuters using the JMRC Smart Card receive an automatic 10% discount on every journey.
            </div>
          </div>

          {/* Service Details & Helpline */}
          <div className="rounded-3xl border border-slate-200 bg-white p-4.5 card-3d space-y-3.5">
            <h3 className="text-xs font-black uppercase text-slate-900">
              Timetable & Help Information
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">First Train Departure:</span>
                <span className="font-bold text-slate-900">06:20 AM</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Last Train Departure:</span>
                <span className="font-bold text-slate-900">09:50 PM</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Peak Frequency:</span>
                <span className="font-bold text-slate-900">10 – 12 Minutes</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Off-Peak Frequency:</span>
                <span className="font-bold text-slate-900">15 Minutes</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Total Route Travel Time:</span>
                <span className="font-bold text-slate-900">~34 Minutes</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">JMRC Customer Helpline:</span>
                <a
                  href="tel:01412822171"
                  className="font-bold text-rose-600 hover:underline"
                >
                  0141-2822171
                </a>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-2.5 border border-slate-200 text-slate-500 text-[10px]">
              <span className="font-bold text-slate-700">Official Source: </span>
              Jaipur Metro Rail Corporation Ltd. (JMRC). Timings verified against gazetted passenger schedule.
            </div>
          </div>
        </div>
      )}
    </>
  )}
</div>
  );
}

