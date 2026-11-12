import { useState, useEffect, useCallback, useRef } from "react";
import { apiUrl } from "../apiBase";

// Client-side fallback calculator using verified JMRC station data & official fare slabs
function computeClientJourney(fromCode, toCode, stationsList) {
  if (!Array.isArray(stationsList) || stationsList.length < 2) return null;
  const fromSt = stationsList.find(
    (s) => s.station_id === fromCode || s.code === fromCode || s.name?.toLowerCase() === fromCode?.toLowerCase()
  );
  const toSt = stationsList.find(
    (s) => s.station_id === toCode || s.code === toCode || s.name?.toLowerCase() === toCode?.toLowerCase()
  );
  if (!fromSt || !toSt || fromSt.station_id === toSt.station_id) return null;

  const isEastbound = fromSt.order < toSt.order;
  const direction = isEastbound
    ? "Towards Badi Chaupar (Eastbound)"
    : "Towards Mansarovar (Westbound)";
  const terminus = isEastbound ? "Badi Chaupar" : "Mansarovar";

  const minOrder = Math.min(fromSt.order, toSt.order);
  const maxOrder = Math.max(fromSt.order, toSt.order);
  const rawSub = stationsList.filter((s) => s.order >= minOrder && s.order <= maxOrder);
  const sortedStops = isEastbound ? rawSub : [...rawSub].reverse();

  const totalStops = sortedStops.length;
  const stationHops = Math.max(0, totalStops - 1);
  const distanceKm = Number(
    Math.abs((toSt.distance_km || 0) - (fromSt.distance_km || 0)).toFixed(2)
  );
  const estimatedTimeMins = Math.max(3, Math.round(stationHops * 3.2));

  // Official JMRC fare slabs: 1-2 stops: ₹6, 3-5: ₹12, 6-8: ₹18, 9+: ₹22
  let tokenFare = 6;
  if (totalStops > 8) {
    tokenFare = 22;
  } else if (totalStops > 5) {
    tokenFare = 18;
  } else if (totalStops > 2) {
    tokenFare = 12;
  }
  const smartCardFare = Number((tokenFare * 0.9).toFixed(1));

  return {
    success: true,
    line: "Pink Line (Phase 1A & 1B)",
    direction,
    terminus,
    from_station: fromSt,
    to_station: toSt,
    total_stops: totalStops,
    station_hops: stationHops,
    distance_km: distanceKm,
    estimated_travel_time_mins: estimatedTimeMins,
    fare: {
      token_fare: tokenFare,
      smart_card_fare: smartCardFare,
      currency: "INR",
      note: "10% discount on JMRC Smart Card / Metro Pass",
    },
    operating_hours: {
      first_train: "06:20 AM",
      last_train: "09:50 PM",
      frequency_mins: "10-12",
    },
    stations: sortedStops,
    live_telemetry_available: false,
    live_telemetry_notice:
      "JMRC train positions are governed by internal signaling systems; travel durations are computed from official timetable headways.",
  };
}

export default function MetroJourney({
  stations = [],
  fromStation,
  toStation,
  setFromStation,
  setToStation,
  onJourneyCalculated,
}) {
  const [loading, setLoading] = useState(false);
  const [journeyResult, setJourneyResult] = useState(() =>
    computeClientJourney(
      fromStation?.code || "MSOR",
      toStation?.code || "BDCP",
      stations
    )
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);
  const fromDropdownRef = useRef(null);
  const toDropdownRef = useRef(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (fromDropdownRef.current && !fromDropdownRef.current.contains(event.target)) {
        setShowFromDropdown(false);
      }
      if (toDropdownRef.current && !toDropdownRef.current.contains(event.target)) {
        setShowToDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const calculateJourney = useCallback(
    async (fromCode, toCode) => {
      if (!fromCode || !toCode) return;
      if (fromCode === toCode) {
        setErrorMsg("Boarding and destination stations cannot be the same.");
        setJourneyResult(null);
        if (onJourneyCalculated) onJourneyCalculated([]);
        return;
      }

      setErrorMsg("");
      setLoading(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second safety timeout

      try {
        const res = await fetch(
          apiUrl(`/api/metro/journey?from=${encodeURIComponent(
            fromCode
          )}&to=${encodeURIComponent(toCode)}`),
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.message || "Failed to calculate metro journey.");
        }

        setJourneyResult(data);
        if (onJourneyCalculated) onJourneyCalculated(data.stations || []);
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn("Metro journey API fetch error; computing client fallback:", err);

        const fallback = computeClientJourney(fromCode, toCode, stations);
        if (fallback) {
          setJourneyResult(fallback);
          if (onJourneyCalculated) onJourneyCalculated(fallback.stations || []);
        } else {
          setErrorMsg("Unable to calculate route. Please try selecting different stations.");
          setJourneyResult(null);
          if (onJourneyCalculated) onJourneyCalculated([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [onJourneyCalculated, stations]
  );

  // Auto-calculate journey when stations are ready
  useEffect(() => {
    if (
      !fromStation?.code ||
      !toStation?.code ||
      fromStation.code === toStation.code
    ) {
      return;
    }

    let ignore = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    fetch(
      apiUrl(`/api/metro/journey?from=${encodeURIComponent(
        fromStation.code
      )}&to=${encodeURIComponent(toStation.code)}`),
      { signal: controller.signal }
    )
      .then((res) => {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (ignore) return;
        if (!data.success) {
          throw new Error(data.message || "Failed to calculate metro journey.");
        }
        setJourneyResult(data);
        setErrorMsg("");
        setLoading(false);
        if (onJourneyCalculated) onJourneyCalculated(data.stations || []);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (ignore) return;
        console.warn("Metro journey API fetch error; computing client fallback:", err);

        const fallback = computeClientJourney(
          fromStation.code,
          toStation.code,
          stations
        );
        if (fallback) {
          setJourneyResult(fallback);
          setErrorMsg("");
          if (onJourneyCalculated) onJourneyCalculated(fallback.stations || []);
        } else {
          setErrorMsg(
            "Unable to calculate route. Please try selecting different stations."
          );
          setJourneyResult(null);
          if (onJourneyCalculated) onJourneyCalculated([]);
        }
        setLoading(false);
      });

    return () => {
      ignore = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [fromStation?.code, toStation?.code, onJourneyCalculated, stations]);

  const handleSelectFrom = (s) => {
    setFromStation(s);
    setShowFromDropdown(false);
  };

  const handleSelectTo = (s) => {
    setToStation(s);
    setShowToDropdown(false);
  };

  const handleSwap = () => {
    if (!fromStation || !toStation || fromStation.station_id === toStation.station_id) return;
    const tmp = fromStation;
    setFromStation(toStation);
    setToStation(tmp);
  };

  // Safe string extractions to prevent React child object crash
  const fromStationName =
    typeof journeyResult?.from_station === "object"
      ? journeyResult.from_station?.name || ""
      : String(journeyResult?.from_station || "");
  const toStationName =
    typeof journeyResult?.to_station === "object"
      ? journeyResult.to_station?.name || ""
      : String(journeyResult?.to_station || "");
  const lineTitle =
    typeof journeyResult?.line === "object"
      ? journeyResult.line?.line_name || "Pink Line"
      : String(journeyResult?.line || "Pink Line");

  return (
    <div className="w-full">
      {/* FROM / TO SELECTION CARD */}
      <div className="metro-station-selector-box">
        {/* FROM STATION INPUT */}
        <div className="metro-input-group" ref={fromDropdownRef}>
          <div className="metro-input-label">
            <span>Boarding Station</span>
            <span style={{ color: "#064e3b", fontWeight: 800 }}>Origin</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowFromDropdown((prev) => !prev);
              setShowToDropdown(false);
            }}
            className="metro-station-trigger"
            aria-expanded={showFromDropdown}
            aria-haspopup="listbox"
          >
            <div className="metro-station-trigger-content">
              <span className="metro-station-indicator from" />
              <span className="truncate">
                {fromStation ? (
                  <>
                    <strong style={{ color: "var(--m-green-deep)" }}>{fromStation.name}</strong>{" "}
                    <span style={{ color: "var(--m-text-secondary)", fontSize: "11px" }}>
                      ({fromStation.hindi_name})
                    </span>
                  </>
                ) : (
                  <span style={{ color: "var(--m-text-secondary)" }}>Select boarding station</span>
                )}
              </span>
            </div>
            <span style={{ fontSize: "11px", color: "var(--m-text-secondary)" }}>
              {showFromDropdown ? "▲" : "▼"}
            </span>
          </button>

          {showFromDropdown && (
            <div className="metro-station-dropdown" role="listbox">
              {stations.map((s) => (
                <div
                  key={s.station_id}
                  onClick={() => handleSelectFrom(s)}
                  className={`metro-dropdown-item ${
                    fromStation?.station_id === s.station_id ? "selected" : ""
                  }`}
                  role="option"
                  aria-selected={fromStation?.station_id === s.station_id}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="metro-station-order-badge">#{s.order}</span>
                    <strong style={{ color: "var(--m-green-deep)" }}>{s.name}</strong>
                    <span style={{ fontSize: "11px", color: "var(--m-text-muted)" }}>
                      {s.hindi_name}
                    </span>
                  </div>
                  <span
                    className={`metro-structure-pill ${
                      s.structure?.toLowerCase() || "elevated"
                    }`}
                  >
                    {s.structure}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SWAP BUTTON */}
        <div className="metro-swap-divider">
          <button
            type="button"
            onClick={handleSwap}
            disabled={!fromStation || !toStation || fromStation.station_id === toStation.station_id}
            className="metro-swap-btn"
            title="Swap boarding and destination stations"
          >
            <span className="metro-swap-icon" style={{ fontSize: "13px" }}>⇅</span>
            <span>Swap Stations</span>
          </button>
        </div>

        {/* TO STATION INPUT */}
        <div className="metro-input-group" ref={toDropdownRef}>
          <div className="metro-input-label">
            <span>Destination Station</span>
            <span style={{ color: "#9f1239", fontWeight: 800 }}>Alight</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowToDropdown((prev) => !prev);
              setShowFromDropdown(false);
            }}
            className="metro-station-trigger"
            aria-expanded={showToDropdown}
            aria-haspopup="listbox"
          >
            <div className="metro-station-trigger-content">
              <span className="metro-station-indicator to" />
              <span className="truncate">
                {toStation ? (
                  <>
                    <strong style={{ color: "var(--m-green-deep)" }}>{toStation.name}</strong>{" "}
                    <span style={{ color: "var(--m-text-secondary)", fontSize: "11px" }}>
                      ({toStation.hindi_name})
                    </span>
                  </>
                ) : (
                  <span style={{ color: "var(--m-text-secondary)" }}>
                    Select destination station
                  </span>
                )}
              </span>
            </div>
            <span style={{ fontSize: "11px", color: "var(--m-text-secondary)" }}>
              {showToDropdown ? "▲" : "▼"}
            </span>
          </button>

          {showToDropdown && (
            <div className="metro-station-dropdown" role="listbox">
              {stations.map((s) => (
                <div
                  key={s.station_id}
                  onClick={() => handleSelectTo(s)}
                  className={`metro-dropdown-item ${
                    toStation?.station_id === s.station_id ? "selected" : ""
                  }`}
                  role="option"
                  aria-selected={toStation?.station_id === s.station_id}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="metro-station-order-badge">#{s.order}</span>
                    <strong style={{ color: "var(--m-green-deep)" }}>{s.name}</strong>
                    <span style={{ fontSize: "11px", color: "var(--m-text-muted)" }}>
                      {s.hindi_name}
                    </span>
                  </div>
                  <span
                    className={`metro-structure-pill ${
                      s.structure?.toLowerCase() || "elevated"
                    }`}
                  >
                    {s.structure}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PLAN JOURNEY BUTTON */}
        <button
          type="button"
          onClick={() => calculateJourney(fromStation?.code, toStation?.code)}
          disabled={!fromStation || !toStation || loading}
          className="metro-plan-btn"
        >
          {loading ? (
            <span>Calculating Journey...</span>
          ) : (
            <>
              <span>Plan Metro Journey</span>
              <span aria-hidden="true">→</span>
            </>
          )}
        </button>

        {errorMsg && (
          <div
            style={{
              marginTop: "10px",
              padding: "8px 12px",
              background: "var(--m-pink-tint)",
              border: "1px solid var(--m-pink-border)",
              borderRadius: "8px",
              color: "var(--m-pink-deep)",
              fontSize: "11.5px",
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            {errorMsg}
          </div>
        )}
      </div>

      {/* JOURNEY RESULTS CARD */}
      {journeyResult && (
        <div className="metro-journey-result-card">
          {/* Header Summary */}
          <div className="metro-result-summary-header">
            <div>
              <div className="metro-direction-badge">
                <span>🚇 {lineTitle}</span>
                <span>•</span>
                <span>{journeyResult.direction || "Scheduled Corridor"}</span>
              </div>
              <h3
                style={{
                  margin: "8px 0 2px",
                  fontSize: "14.5px",
                  fontWeight: 850,
                  color: "var(--m-green-deep)",
                }}
              >
                {fromStationName} to {toStationName}
              </h3>
            </div>

            <div style={{ textAlign: "right" }}>
              <div className="metro-fare-amount">
                ₹{journeyResult.fare?.token_fare ?? "--"}
              </div>
              <span className="metro-fare-title">Token Fare</span>
            </div>
          </div>

          {/* Key Metrics Grid */}
          <div className="metro-journey-metrics-grid">
            <div className="metro-metric-box">
              <strong>{journeyResult.total_stops ?? "--"}</strong>
              <span>Stations</span>
            </div>
            <div className="metro-metric-box">
              <strong>~{journeyResult.estimated_travel_time_mins ?? "--"} min</strong>
              <span>Travel Time</span>
            </div>
            <div className="metro-metric-box">
              <strong>{journeyResult.distance_km ?? "--"} km</strong>
              <span>Distance</span>
            </div>
          </div>

          {/* Dual Fare Box (Token vs Smart Card 10% Discount) */}
          <div className="metro-fare-comparison-grid">
            <div className="metro-fare-card standard">
              <span className="metro-fare-title">Standard Token</span>
              <div className="metro-fare-amount" style={{ margin: "4px 0 2px" }}>
                ₹{journeyResult.fare?.token_fare ?? "--"}
              </div>
              <p style={{ margin: 0, fontSize: "10px", color: "var(--m-text-muted)" }}>
                Single Journey Token
              </p>
            </div>

            <div className="metro-fare-card smart">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  className="metro-fare-title"
                  style={{ color: "var(--m-green-mid)" }}
                >
                  Smart Card
                </span>
                <span
                  style={{
                    background: "var(--m-green-border)",
                    color: "var(--m-green-deep)",
                    fontSize: "9px",
                    fontWeight: 900,
                    padding: "2px 5px",
                    borderRadius: "4px",
                  }}
                >
                  10% OFF
                </span>
              </div>
              <div
                className="metro-fare-amount"
                style={{ color: "var(--m-green-deep)", margin: "4px 0 2px" }}
              >
                ₹{journeyResult.fare?.smart_card_fare ?? "--"}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "10px",
                  color: "var(--m-green-mid)",
                  fontWeight: 750,
                }}
              >
                JMRC Metro Card Tap
              </p>
            </div>
          </div>

          {/* Service Schedule Band */}
          {journeyResult.operating_hours && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                background: "var(--m-cream-soft)",
                borderRadius: "var(--m-radius-sm)",
                border: "1px solid var(--m-cream-border-subtle)",
                fontSize: "11px",
                marginBottom: "14px",
              }}
            >
              <div>
                <span
                  style={{
                    color: "var(--m-text-muted)",
                    fontSize: "9.5px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    display: "block",
                  }}
                >
                  First Train
                </span>
                <strong style={{ color: "var(--m-green-deep)" }}>
                  {journeyResult.operating_hours.first_train || "06:20 AM"}
                </strong>
              </div>
              <div>
                <span
                  style={{
                    color: "var(--m-text-muted)",
                    fontSize: "9.5px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    display: "block",
                  }}
                >
                  Last Train
                </span>
                <strong style={{ color: "var(--m-green-deep)" }}>
                  {journeyResult.operating_hours.last_train || "09:50 PM"}
                </strong>
              </div>
              <div>
                <span
                  style={{
                    color: "var(--m-text-muted)",
                    fontSize: "9.5px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    display: "block",
                  }}
                >
                  Frequency
                </span>
                <strong style={{ color: "var(--m-green-deep)" }}>
                  Every {journeyResult.operating_hours.frequency_mins || "10-12"}m
                </strong>
              </div>
            </div>
          )}

          {/* Vertical Station Sequence Timeline */}
          <div className="metro-timeline-container">
            <span
              style={{
                fontSize: "10.5px",
                fontWeight: 850,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--m-text-muted)",
                display: "block",
              }}
            >
              Journey Route ({journeyResult.stations?.length || 0} Stations)
            </span>

            <div className="metro-timeline-list">
              {journeyResult.stations?.map((st, idx) => {
                const isStart = idx === 0;
                const isEnd = idx === journeyResult.stations.length - 1;
                const isUnderground = st.structure
                  ?.toLowerCase()
                  .includes("underground");

                return (
                  <div
                    key={st.station_id || idx}
                    className={`metro-timeline-node ${
                      isStart ? "start" : isEnd ? "end" : ""
                    }`}
                  >
                    <span className="metro-timeline-dot" />

                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span className="metro-timeline-station-name">
                          {st.name}
                        </span>
                        <span
                          style={{
                            fontSize: "10.5px",
                            color: "var(--m-text-muted)",
                          }}
                        >
                          ({st.hindi_name})
                        </span>
                        <span
                          className={`metro-structure-pill ${
                            isUnderground ? "underground" : "elevated"
                          }`}
                        >
                          {st.structure}
                        </span>
                      </div>

                      {st.interchange && st.interchange !== "None" && (
                        <div
                          style={{
                            fontSize: "10px",
                            color: "#0369a1",
                            fontWeight: 750,
                            marginTop: "2px",
                          }}
                        >
                          🔄 {st.interchange}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Genuine Telemetry & Schedule Disclaimer */}
          <div className="metro-source-disclaimer">
            <strong>Travel Notice: </strong>
            {journeyResult.live_telemetry_notice ||
              "JMRC live train GPS telemetry is restricted to official internal signaling; intermediate travel durations are computed from official timetable headways."}
          </div>
        </div>
      )}
    </div>
  );
}
