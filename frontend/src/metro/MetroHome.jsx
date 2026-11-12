import { useState, useEffect, useCallback } from "react";
import "./MetroHome.css";
import MetroMap from "./MetroMap";
import MetroJourney from "./MetroJourney";
import MetroSearch from "./MetroSearch";
import { METRO_STATIONS, JMRC_PINK_LINE } from "./metroData";
import { apiUrl } from "../apiBase";

export default function MetroHome({ onBackToBus }) {
  const [stations, setStations] = useState(METRO_STATIONS);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("journey"); // "journey" | "stations" | "fares"
  const [fromStation, setFromStation] = useState(METRO_STATIONS[0]);
  const [toStation, setToStation] = useState(METRO_STATIONS[METRO_STATIONS.length - 1]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [journeyStations, setJourneyStations] = useState(METRO_STATIONS);
  const [error, setError] = useState("");

  const loadData = useCallback(() => {
    let ignore = false;
    Promise.allSettled([
      fetch(apiUrl("/api/metro/stations")).then((response) => {
        if (!response.ok) throw new Error("Station data unavailable");
        return response.json();
      }),
      fetch(apiUrl("/api/metro/status")).then((response) => {
        if (!response.ok) throw new Error("Status data unavailable");
        return response.json();
      }),
    ])
      .then(([stationResult, statusResult]) => {
        if (ignore) return;
        if (
          stationResult.status === "fulfilled" &&
          Array.isArray(stationResult.value?.stations) &&
          stationResult.value.stations.length > 0
        ) {
          const list = stationResult.value.stations;
          setStations(list);

          if (list.length >= 2) {
            setFromStation((previous) => previous || list[0]); // Mansarovar
            setToStation((previous) => previous || list[list.length - 1]); // Badi Chaupar
          }
        } else {
          // Resilient client fallback from official JMRC dataset
          setStations(METRO_STATIONS);
          if (METRO_STATIONS.length >= 2) {
            setFromStation((previous) => previous || METRO_STATIONS[0]);
            setToStation((previous) => previous || METRO_STATIONS[METRO_STATIONS.length - 1]);
          }
        }

        if (
          statusResult.status === "fulfilled" &&
          statusResult.value?.success
        ) {
          setStatus(statusResult.value);
        } else {
          setStatus(JMRC_PINK_LINE);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (ignore) return;
        console.warn("Fetch metro data error; using client dataset:", err);
        setStations(METRO_STATIONS);
        if (METRO_STATIONS.length >= 2) {
          setFromStation((previous) => previous || METRO_STATIONS[0]);
          setToStation((previous) => previous || METRO_STATIONS[METRO_STATIONS.length - 1]);
        }
        setStatus(JMRC_PINK_LINE);
        setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    return loadData();
  }, [loadData]);

  const handleRetry = () => {
    setLoading(true);
    setError("");
    loadData();
  };

  const handleSelectStation = (station, switchTab = false) => {
    setSelectedStation(station);
    if (switchTab) {
      setActiveTab("journey");
    }
  };

  const handleSetFromStation = (station) => {
    setFromStation(station);
    setActiveTab("journey");
  };

  const handleSetToStation = (station) => {
    setToStation(station);
    setActiveTab("journey");
  };

  return (
    <main className="metro-premium" aria-label="Jaipur Metro Guide">
      {/* 1. TOP NAVIGATION BAR */}
      <header className="metro-topbar">
        <div className="metro-brand">
          <div className="metro-brand-mark" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="16" height="16" rx="3" />
              <path d="M4 11h16" />
              <path d="M12 3v8" />
              <path d="m8 19-2 3" />
              <path d="m16 19 2 3" />
              <circle cx="8" cy="15" r="1" fill="currentColor" />
              <circle cx="16" cy="15" r="1" fill="currentColor" />
            </svg>
          </div>
          <div className="metro-brand-text">
            <h1>Jaipur Metro Guide</h1>
            <p className="metro-brand-subtitle">
              <span>●</span> Pink Line · Phase 1A &amp; 1B
            </p>
          </div>
        </div>

        <div className="metro-topbar-actions">
          <div className="metro-status-pill" title="JMRC Operating Status">
            <span className="metro-status-dot" />
            <span>{status?.operational_status || "Operational"} · 06:20 – 21:50</span>
          </div>

          {typeof onBackToBus === "function" && (
            <button
              type="button"
              className="metro-back-button"
              onClick={onBackToBus}
              aria-label="Return to Jaipur Bus Tracking"
            >
              <span>←</span>
              <span>Bus Tracking</span>
            </button>
          )}
        </div>
      </header>

      {/* 2. HERO CARD (EXACT SIZE & POSITION OF ORIGINAL HERO CARD) */}
      <section className="metro-hero" aria-label="Jaipur Metro Guide">
        <picture className="metro-hero-picture">
          <source
            media="(max-width: 600px)"
            type="image/webp"
            srcSet="/assets/metro/jaipur-metro-guide-hero-mobile.webp 480w"
            sizes="(max-width: 600px) 480px"
          />
          <source
            media="(max-width: 600px)"
            type="image/jpeg"
            srcSet="/assets/metro/jaipur-metro-guide-hero-mobile.jpg 480w"
            sizes="(max-width: 600px) 480px"
          />
          <source
            type="image/webp"
            srcSet="/assets/metro/jaipur-metro-guide-hero.webp 800w"
            sizes="(max-width: 960px) 800px, 800px"
          />
          <source
            type="image/jpeg"
            srcSet="/assets/metro/jaipur-metro-guide-hero.jpg 800w"
            sizes="(max-width: 960px) 800px, 800px"
          />
          <img
            src="/assets/metro/jaipur-metro-guide-hero.webp"
            alt="Jaipur Metro Route Map and Pink Line Stations Guide - Jaipur Bus Live"
            width="800"
            height="800"
            fetchPriority="high"
            decoding="async"
            className="metro-hero-img"
          />
        </picture>
      </section>

      {/* 3. METRO OVERVIEW STATS BAR */}
      <section className="metro-stats" aria-label="Key corridor metrics">
        <div className="metro-stat-card">
          <div className="metro-stat-icon-wrap" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
          </div>
          <div>
            <div className="metro-stat-value">11.97 km</div>
            <div className="metro-stat-label">Corridor Length</div>
          </div>
        </div>

        <div className="metro-stat-card">
          <div className="metro-stat-icon-wrap" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div>
            <div className="metro-stat-value">11 Stations</div>
            <div className="metro-stat-label">8 Elevated · 3 Underground</div>
          </div>
        </div>

        <div className="metro-stat-card">
          <div className="metro-stat-icon-wrap" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div>
            <div className="metro-stat-value">06:20 – 21:50</div>
            <div className="metro-stat-label">Operating Schedule</div>
          </div>
        </div>

        <div className="metro-stat-card">
          <div className="metro-stat-icon-wrap" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h12" />
              <path d="M6 8h12" />
              <path d="m6 13 8.5 8" />
              <path d="M6 13h3a4 4 0 0 0 0-8" />
            </svg>
          </div>
          <div>
            <div className="metro-stat-value">₹6 – ₹22</div>
            <div className="metro-stat-label">Token / 10% Card Rebate</div>
          </div>
        </div>
      </section>

      {/* 4. MAIN NAVIGATION TABS */}
      <section className="metro-main-section">
        <div className="metro-section-header">
          <div>
            <div className="metro-section-eyebrow">Explore Public Transit</div>
            <h2 className="metro-section-title">Pink Line Corridor Tools</h2>
          </div>
          <span style={{ fontSize: "11px", fontWeight: 750, color: "var(--m-text-muted)" }}>
            Phase 1A &amp; Phase 1B
          </span>
        </div>

        <nav className="metro-nav-tabs" role="tablist" aria-label="Metro guide sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "journey"}
            className={`metro-tab-btn ${activeTab === "journey" ? "active" : ""}`}
            onClick={() => setActiveTab("journey")}
          >
            <span aria-hidden="true">⇄</span>
            <span>Plan Journey</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "stations"}
            className={`metro-tab-btn ${activeTab === "stations" ? "active" : ""}`}
            onClick={() => setActiveTab("stations")}
          >
            <span aria-hidden="true">◎</span>
            <span>Explore Stations ({stations.length || 11})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "fares"}
            className={`metro-tab-btn ${activeTab === "fares" ? "active" : ""}`}
            onClick={() => setActiveTab("fares")}
          >
            <span aria-hidden="true">₹</span>
            <span>Fares &amp; Timings</span>
          </button>
        </nav>

        {/* Error notification banner if any */}
        {error && (
          <div style={{ marginBottom: "16px", padding: "12px 16px", background: "var(--m-pink-tint)", border: "1px solid var(--m-pink-border)", borderRadius: "var(--m-radius-md)", color: "var(--m-pink-deep)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }} role="alert">
            <div>
              <strong style={{ display: "block", fontSize: "12.5px" }}>Service Notice</strong>
              <span style={{ fontSize: "11.5px" }}>{error}</span>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              style={{ padding: "6px 12px", background: "#ffffff", border: "1px solid var(--m-pink-border)", borderRadius: "6px", color: "var(--m-pink-deep)", fontSize: "11px", fontWeight: 800 }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Spinner */}
        {loading ? (
          <div style={{ padding: "48px 24px", textAlign: "center", background: "#ffffff", border: "1px solid var(--m-cream-border)", borderRadius: "var(--m-radius-lg)" }}>
            <div className="metro-status-dot" style={{ width: "12px", height: "12px", margin: "0 auto 12px", background: "var(--m-green-light)" }} />
            <strong style={{ display: "block", color: "var(--m-green-deep)", fontSize: "14px" }}>
              Loading Jaipur Metro Pink Line Guide...
            </strong>
            <p style={{ margin: "4px 0 0", color: "var(--m-text-muted)", fontSize: "12px" }}>
              Retrieving stations, fare slabs, and operating schedules
            </p>
          </div>
        ) : (
          <>
            {/* TAB 1: PLAN JOURNEY (DUAL COLUMN: MAP + TRIP PLANNER) */}
            {activeTab === "journey" && (
              <div className="metro-content-grid">
                {/* Left Column: Interactive Map */}
                <section className="metro-panel metro-map-panel" aria-label="Metro Route Map">
                  <div className="metro-panel-header">
                    <div className="metro-panel-title-group">
                      <h3>Interactive Corridor Map</h3>
                      <p className="metro-panel-description">
                        Click any station marker to view details or set as origin / destination.
                      </p>
                    </div>
                    <span className="metro-badge">Pink Line</span>
                  </div>

                  {stations.length > 0 ? (
                    <MetroMap
                      stations={stations}
                      selectedStation={selectedStation}
                      onSelectStation={handleSelectStation}
                      onSetFromStation={handleSetFromStation}
                      onSetToStation={handleSetToStation}
                      journeyStations={journeyStations}
                    />
                  ) : (
                    <div style={{ padding: "30px", textAlign: "center", color: "var(--m-text-muted)", background: "var(--m-cream-soft)", borderRadius: "var(--m-radius-md)" }}>
                      Corridor map is loading...
                    </div>
                  )}
                </section>

                {/* Right Column: Journey Planner */}
                <section className="metro-panel metro-journey-panel" aria-label="Metro Trip Planner">
                  <div className="metro-panel-header">
                    <div className="metro-panel-title-group">
                      <h3>Trip Planner</h3>
                      <p className="metro-panel-description">
                        Select boarding &amp; destination stations for fares, stops and timings.
                      </p>
                    </div>
                    <span className="metro-badge" style={{ background: "var(--m-green-tint)", borderColor: "var(--m-green-border)", color: "var(--m-green-deep)" }}>
                      JMRC Slabs
                    </span>
                  </div>

                  {stations.length > 0 ? (
                    <MetroJourney
                      stations={stations}
                      fromStation={fromStation}
                      toStation={toStation}
                      setFromStation={setFromStation}
                      setToStation={setToStation}
                      onJourneyCalculated={setJourneyStations}
                    />
                  ) : (
                    <div style={{ padding: "30px", textAlign: "center", color: "var(--m-text-muted)", background: "var(--m-cream-soft)", borderRadius: "var(--m-radius-md)" }}>
                      Station selector is loading...
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* TAB 2: EXPLORE STATIONS */}
            {activeTab === "stations" && (
              <section className="metro-panel" aria-label="All Metro Stations">
                <div className="metro-panel-header">
                  <div className="metro-panel-title-group">
                    <h2>Explore All 11 Stations</h2>
                    <p className="metro-panel-description">
                      Search by station name, structure, interchange, and view first/last train timetables.
                    </p>
                  </div>
                  <span className="metro-badge">Mansarovar ↔ Badi Chaupar</span>
                </div>

                {stations.length > 0 ? (
                  <MetroSearch
                    stations={stations}
                    selectedStation={selectedStation}
                    onSelectStation={handleSelectStation}
                    onSetFromStation={handleSetFromStation}
                    onSetToStation={handleSetToStation}
                  />
                ) : (
                  <div style={{ padding: "30px", textAlign: "center", color: "var(--m-text-muted)" }}>
                    Station information is currently unavailable.
                  </div>
                )}
              </section>
            )}

            {/* TAB 3: FARES & TIMINGS */}
            {activeTab === "fares" && (
              <div className="metro-content-grid">
                {/* Left Column: Official Fare Slabs */}
                <section className="metro-panel" aria-label="Metro Fare Slabs">
                  <div className="metro-panel-header">
                    <div className="metro-panel-title-group">
                      <h2>Official JMRC Fare Slabs</h2>
                      <p className="metro-panel-description">
                        Token fares and discounted smart card rates across station distances.
                      </p>
                    </div>
                    <span className="metro-badge">10% Off Card</span>
                  </div>

                  <div className="metro-fare-table-wrap">
                    <table className="metro-fare-table">
                      <thead>
                        <tr>
                          <th>Journey Tier</th>
                          <th>Stations</th>
                          <th>Single Token</th>
                          <th>Smart Card (10% Off)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { tier: "Short Distance", stations: "1 – 2 stops", token: "₹6", card: "₹5.40" },
                          { tier: "Regular Distance", stations: "3 – 5 stops", token: "₹12", card: "₹10.80" },
                          { tier: "Medium Distance", stations: "6 – 8 stops", token: "₹18", card: "₹16.20" },
                          { tier: "Long Distance", stations: "9+ stops", token: "₹22", card: "₹19.80" },
                        ].map((item, idx) => (
                          <tr key={idx}>
                            <td>
                              <strong>{item.tier}</strong>
                            </td>
                            <td style={{ color: "var(--m-text-muted)" }}>{item.stations}</td>
                            <td>
                              <strong style={{ color: "var(--m-green-deep)", fontSize: "13.5px" }}>
                                {item.token}
                              </strong>
                            </td>
                            <td>
                              <strong style={{ color: "#047857", fontSize: "13.5px" }}>
                                {item.card}
                              </strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="metro-source-disclaimer">
                    <strong>Smart Card Benefits: </strong>
                    JMRC Smart Cards save 10% on every ride, bypass token ticket queues, and are rechargeable at all stations.
                  </div>
                </section>

                {/* Right Column: Timings & Helpline */}
                <section className="metro-panel" aria-label="Metro Timings and Helpline">
                  <div className="metro-panel-header">
                    <div className="metro-panel-title-group">
                      <h2>Service Schedule &amp; Help</h2>
                      <p className="metro-panel-description">
                        Operating hours, train frequency and official commuter assistance.
                      </p>
                    </div>
                    <span className="metro-badge" style={{ background: "var(--m-green-tint)", borderColor: "var(--m-green-border)", color: "var(--m-green-deep)" }}>
                      Daily Service
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--m-cream-soft)", borderRadius: "var(--m-radius-sm)" }}>
                      <div>
                        <strong style={{ fontSize: "13px", color: "var(--m-green-deep)" }}>First Service</strong>
                        <p style={{ margin: 0, fontSize: "10.5px", color: "var(--m-text-muted)" }}>Mansarovar / Badi Chaupar</p>
                      </div>
                      <strong style={{ fontSize: "14px", color: "var(--m-green-deep)" }}>06:20 AM</strong>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--m-cream-soft)", borderRadius: "var(--m-radius-sm)" }}>
                      <div>
                        <strong style={{ fontSize: "13px", color: "var(--m-green-deep)" }}>Last Service</strong>
                        <p style={{ margin: 0, fontSize: "10.5px", color: "var(--m-text-muted)" }}>Mansarovar / Badi Chaupar</p>
                      </div>
                      <strong style={{ fontSize: "14px", color: "var(--m-green-deep)" }}>09:50 PM</strong>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--m-cream-soft)", borderRadius: "var(--m-radius-sm)" }}>
                      <div>
                        <strong style={{ fontSize: "13px", color: "var(--m-green-deep)" }}>Peak Headway</strong>
                        <p style={{ margin: 0, fontSize: "10.5px", color: "var(--m-text-muted)" }}>Morning &amp; Evening Rush</p>
                      </div>
                      <strong style={{ fontSize: "14px", color: "var(--m-green-deep)" }}>Every 10–12m</strong>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--m-cream-soft)", borderRadius: "var(--m-radius-sm)" }}>
                      <div>
                        <strong style={{ fontSize: "13px", color: "var(--m-green-deep)" }}>Off-Peak Headway</strong>
                        <p style={{ margin: 0, fontSize: "10.5px", color: "var(--m-text-muted)" }}>Midday &amp; Late Hours</p>
                      </div>
                      <strong style={{ fontSize: "14px", color: "var(--m-green-deep)" }}>Every 15m</strong>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--m-cream-soft)", borderRadius: "var(--m-radius-sm)" }}>
                      <div>
                        <strong style={{ fontSize: "13px", color: "var(--m-green-deep)" }}>End-to-End Duration</strong>
                        <p style={{ margin: 0, fontSize: "10.5px", color: "var(--m-text-muted)" }}>Complete 11-station ride</p>
                      </div>
                      <strong style={{ fontSize: "14px", color: "var(--m-green-deep)" }}>~24 mins</strong>
                    </div>
                  </div>

                  {/* Official Helpline Card */}
                  <div className="metro-helpline-card">
                    <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--m-green-deep)", flexShrink: 0, fontSize: "16px" }}>
                      ☎
                    </div>
                    <div>
                      <span style={{ fontSize: "10px", fontWeight: 850, textTransform: "uppercase", color: "var(--m-green-mid)", display: "block" }}>
                        JMRC Official Helpline
                      </span>
                      <a href="tel:01412822171" className="metro-helpline-phone" style={{ textDecoration: "none" }}>
                        0141-2822171
                      </a>
                      <p style={{ margin: "2px 0 0", fontSize: "10.5px", color: "var(--m-text-muted)" }}>
                        For lost &amp; found, ticketing, and service updates.
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </section>

      {/* 5. FREQUENTLY ASKED QUESTIONS (FAQ) */}
      <section className="metro-panel" style={{ marginTop: "24px" }} aria-label="Frequently Asked Questions">
        <div className="metro-panel-header">
          <div className="metro-panel-title-group">
            <h2>Frequently Asked Questions (FAQ)</h2>
            <p className="metro-panel-description">
              Verified transit facts, schedules, and fare rules for Jaipur Metro (JMRC Pink Line).
            </p>
          </div>
          <span className="metro-badge">JMRC Guide</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
          {[
            {
              q: "What are the operating timings of Jaipur Metro Pink Line?",
              a: "Jaipur Metro operates daily from 06:20 AM to 09:50 PM. Peak frequency is every 10–12 minutes, and off-peak frequency is every 15 minutes between Mansarovar and Badi Chaupar."
            },
            {
              q: "How many stations are there on the Jaipur Metro Pink Line?",
              a: "The Jaipur Metro Pink Line consists of 11 stations over 11.97 km: Mansarovar, New Aatish Market, Vivek Vihar, Shyam Nagar, Ram Nagar, Civil Lines, Railway Station, Sindhi Camp, Chandpole, Chhoti Chaupar, and Badi Chaupar (8 elevated and 3 underground stations)."
            },
            {
              q: "What is the ticket fare for Jaipur Metro?",
              a: "Jaipur Metro single token fares range from ₹6 for 1–2 stations, ₹12 for 3–5 stations, ₹18 for 6–8 stations, up to ₹22 for 9 or more stations. JMRC Smart Card users receive an automatic 10% discount on every journey."
            },
            {
              q: "Where can I interchange between Jaipur Metro, Indian Railways, and Bus Stand?",
              a: "Railway Station metro station provides direct access to Jaipur Junction Railway Station, while Sindhi Camp metro station connects directly to Sindhi Camp Central Bus Stand."
            },
            {
              q: "How long does it take to travel the entire Jaipur Metro Pink Line?",
              a: "The end-to-end journey from Mansarovar to Badi Chaupar covers 11.97 km and takes approximately 24 to 34 minutes."
            },
            {
              q: "What is the Jaipur Metro route between Mansarovar, Railway Station, and Chandpole?",
              a: "The Jaipur Metro Pink Line connects Mansarovar directly to Railway Station (Jaipur Junction) and Chandpole in approximately 18–20 minutes, serving major commercial, residential, and transit hubs across Jaipur with trains every 10–15 minutes."
            },
            {
              q: "How can I find the nearest Jaipur Metro station and plan my journey?",
              a: "Use the Jaipur Metro Route Planner on Jaipur Bus Live to select any boarding station across all 11 Pink Line stations from Mansarovar to Badi Chaupar. View station details, interchanges with Indian Railways or Sindhi Camp bus stand, journey durations, and token or smart card fares."
            }
          ].map((item, idx) => (
            <details
              key={idx}
              open={idx === 0}
              style={{
                background: "var(--m-cream-soft)",
                border: "1px solid var(--m-cream-border)",
                borderRadius: "var(--m-radius-md)",
                padding: "12px 16px"
              }}
            >
              <summary
                style={{
                  fontWeight: 800,
                  fontSize: "13px",
                  color: "var(--m-green-deep)",
                  cursor: "pointer",
                  userSelect: "none",
                  display: "flex",
                  alignItems: "center",
                  minHeight: "44px"
                }}
              >
                {item.q}
              </summary>
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: "12px",
                  lineHeight: "1.6",
                  color: "var(--m-text-secondary)"
                }}
              >
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* 6. FOOTER CALL TO ACTION */}
      <section className="metro-footer-cta">
        <div>
          <h2>Connecting Jaipur with Bus &amp; Metro</h2>
          <p>
            Jaipur Metro and JCTSL city buses provide integrated public transportation across the Pink City. Switch seamlessly between transit options.
          </p>
        </div>
        {typeof onBackToBus === "function" && (
          <button
            type="button"
            className="metro-btn-primary"
            onClick={onBackToBus}
            style={{ flexShrink: 0 }}
          >
            <span>Live Bus Tracking</span>
            <span aria-hidden="true">→</span>
          </button>
        )}
      </section>

      {/* 6. BOTTOM BRANDING & COPYRIGHT */}
      <footer className="metro-footer-bar">
        <span>© 2026 Jaipur Bus Live (JBL) · Jaipur Metro Guide (JMRC)</span>
        <span>Mansarovar ↔ Badi Chaupar · 11 Stations · East-West Transit Corridor</span>
      </footer>
    </main>
  );
}
