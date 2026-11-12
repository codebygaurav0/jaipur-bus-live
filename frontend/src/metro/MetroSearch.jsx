import { useState, useMemo } from "react";

export default function MetroSearch({
  stations = [],
  selectedStation,
  onSelectStation,
  onSetFromStation,
  onSetToStation,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all"); // "all" | "elevated" | "underground" | "interchange"
  const [expandedStationId, setExpandedStationId] = useState(null);

  const clean = (s) =>
    String(s || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, "");

  const filteredStations = useMemo(() => {
    return stations.filter((s) => {
      // 1. Structure / Type filter
      if (filterType === "elevated" && !s.structure?.toLowerCase().includes("elevated")) {
        return false;
      }
      if (filterType === "underground" && !s.structure?.toLowerCase().includes("underground")) {
        return false;
      }
      if (filterType === "interchange" && (!s.interchange || s.interchange === "None")) {
        return false;
      }

      // 2. Query filter
      if (!searchQuery) return true;
      const q = clean(searchQuery);
      const qRaw = searchQuery.toLowerCase().trim();
      const nameMatch = clean(s.name).includes(q) || s.name.toLowerCase().includes(qRaw);
      const hindiMatch = (s.hindi_name || "").includes(searchQuery.trim());
      const codeMatch = (s.code || "").toLowerCase().includes(qRaw);
      const interchangeMatch = (s.interchange || "").toLowerCase().includes(qRaw);
      const structureMatch = (s.structure || "").toLowerCase().includes(qRaw);
      return nameMatch || hindiMatch || codeMatch || interchangeMatch || structureMatch;
    });
  }, [stations, searchQuery, filterType]);

  const counts = useMemo(() => {
    const elevated = stations.filter((s) => s.structure?.toLowerCase().includes("elevated")).length;
    const underground = stations.filter((s) => s.structure?.toLowerCase().includes("underground")).length;
    const interchange = stations.filter((s) => s.interchange && s.interchange !== "None").length;
    return { all: stations.length, elevated, underground, interchange };
  }, [stations]);

  return (
    <div className="w-full">
      {/* Search Input Bar */}
      <div className="metro-search-bar-wrap">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by station name (e.g. Sindhi Camp, Chandpole, मानसरोवर)"
          className="metro-search-input"
          aria-label="Search Jaipur Metro stations"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="metro-search-clear"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* Filter Chips Bar */}
      <div className="metro-filter-chips">
        <button
          type="button"
          onClick={() => setFilterType("all")}
          className={`metro-filter-chip ${filterType === "all" ? "active" : ""}`}
        >
          All Stations ({counts.all})
        </button>
        <button
          type="button"
          onClick={() => setFilterType("elevated")}
          className={`metro-filter-chip ${filterType === "elevated" ? "active" : ""}`}
        >
          Elevated ({counts.elevated})
        </button>
        <button
          type="button"
          onClick={() => setFilterType("underground")}
          className={`metro-filter-chip ${filterType === "underground" ? "active" : ""}`}
        >
          Underground ({counts.underground})
        </button>
        <button
          type="button"
          onClick={() => setFilterType("interchange")}
          className={`metro-filter-chip ${filterType === "interchange" ? "active" : ""}`}
        >
          Interchanges ({counts.interchange})
        </button>
      </div>

      {/* Station Cards Grid */}
      {filteredStations.length > 0 ? (
        <div className="metro-station-cards-grid">
          {filteredStations.map((st) => {
            const isSelected = selectedStation?.station_id === st.station_id;
            const isExpanded = expandedStationId === st.station_id;
            const isUnderground = st.structure?.toLowerCase().includes("underground");

            return (
              <div
                key={st.station_id}
                className={`metro-station-card ${isSelected ? "selected" : ""}`}
              >
                <div className="metro-station-card-top">
                  <div
                    style={{ cursor: "pointer", flex: 1 }}
                    onClick={() => {
                      if (onSelectStation) onSelectStation(st);
                      setExpandedStationId(isExpanded ? null : st.station_id);
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className="metro-station-order-badge">#{st.order}</span>
                      <div className="metro-station-title-group">
                        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 800, color: "var(--m-green-deep)" }}>{st.name}</h3>
                        <span className="metro-station-hindi">{st.hindi_name}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
                      <span className={`metro-structure-pill ${isUnderground ? 'underground' : 'elevated'}`}>
                        {st.structure}
                      </span>
                      {st.interchange && st.interchange !== "None" && (
                        <span style={{ fontSize: "9.5px", fontWeight: 800, padding: "2px 6px", borderRadius: "4px", background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>
                          🔄 {st.interchange}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedStationId(isExpanded ? null : st.station_id)}
                    style={{ minHeight: "44px", minWidth: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "6px", fontSize: "13px", color: "var(--m-text-muted)", fontWeight: 750, background: "transparent", border: "none", cursor: "pointer" }}
                    aria-label={isExpanded ? "Collapse station details" : "Expand station details"}
                  >
                    {isExpanded ? "▲" : "▼"}
                  </button>
                </div>

                {/* Quick Action Buttons */}
                <div className="metro-station-card-actions">
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectStation) onSelectStation(st, true);
                    }}
                    className="metro-btn-action"
                    title="View station on map"
                  >
                    📍 View on Map
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onSetFromStation) onSetFromStation(st);
                    }}
                    className="metro-btn-action"
                    style={{ color: "#047857", fontWeight: 850 }}
                    title="Board here"
                  >
                    Board Here
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onSetToStation) onSetToStation(st);
                    }}
                    className="metro-btn-action"
                    style={{ color: "var(--m-pink)", fontWeight: 850 }}
                    title="Alight here"
                  >
                    Alight Here
                  </button>
                </div>

                {/* Expandable Details Tray */}
                {isExpanded && (
                  <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--m-cream-border-subtle)", fontSize: "11px", color: "var(--m-text-secondary)" }}>
                    {/* First & Last Train Details */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
                      <div style={{ background: "var(--m-cream-soft)", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--m-cream-border-subtle)" }}>
                        <span style={{ fontSize: "9.5px", fontWeight: 850, textTransform: "uppercase", color: "var(--m-pink)", display: "block" }}>
                          To Badi Chaupar
                        </span>
                        <div style={{ marginTop: "2px" }}>
                          First: <strong>{st.first_train?.towards_badi_chaupar || "06:20 AM"}</strong>
                        </div>
                        <div>
                          Last: <strong>{st.last_train?.towards_badi_chaupar || "09:50 PM"}</strong>
                        </div>
                      </div>

                      <div style={{ background: "var(--m-cream-soft)", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--m-cream-border-subtle)" }}>
                        <span style={{ fontSize: "9.5px", fontWeight: 850, textTransform: "uppercase", color: "var(--m-green-mid)", display: "block" }}>
                          To Mansarovar
                        </span>
                        <div style={{ marginTop: "2px" }}>
                          First: <strong>{st.first_train?.towards_mansarovar || "06:20 AM"}</strong>
                        </div>
                        <div>
                          Last: <strong>{st.last_train?.towards_mansarovar || "09:50 PM"}</strong>
                        </div>
                      </div>
                    </div>

                    {/* Facilities Checklist */}
                    {Array.isArray(st.facilities) && st.facilities.length > 0 && (
                      <div style={{ marginBottom: "8px" }}>
                        <span style={{ fontSize: "9.5px", fontWeight: 850, textTransform: "uppercase", color: "var(--m-text-muted)", display: "block", marginBottom: "4px" }}>
                          Station Facilities
                        </span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {st.facilities.map((fac, i) => (
                            <span
                              key={i}
                              style={{ background: "#ffffff", border: "1px solid var(--m-cream-border)", padding: "2px 7px", borderRadius: "6px", fontSize: "10px", fontWeight: 650, color: "var(--m-green-deep)" }}
                            >
                              ✓ {fac}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Distance from Mansarovar */}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--m-text-muted)", paddingTop: "4px" }}>
                      <span>Corridor Distance: {st.distance_km} km</span>
                      <span>GPS: {st.latitude?.toFixed(4)}, {st.longitude?.toFixed(4)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "32px 16px", background: "var(--m-cream-soft)", borderRadius: "var(--m-radius-md)", border: "1px solid var(--m-cream-border)", color: "var(--m-text-muted)" }}>
          <p style={{ margin: "0 0 6px", fontWeight: 800, color: "var(--m-green-deep)", fontSize: "14px" }}>
            No stations match your search.
          </p>
          <p style={{ margin: 0, fontSize: "12px" }}>
            Try searching for "Sindhi Camp", "Mansarovar", "Chandpole", or clear your filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setFilterType("all");
            }}
            style={{ marginTop: "12px", padding: "6px 14px", background: "#ffffff", border: "1px solid var(--m-cream-border)", borderRadius: "8px", fontSize: "11px", fontWeight: 800, color: "var(--m-green-deep)" }}
          >
            Reset Filters
          </button>
        </div>
      )}
    </div>
  );
}
