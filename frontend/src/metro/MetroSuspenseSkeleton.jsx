export default function MetroSuspenseSkeleton() {
  return (
    <main
      className="metro-premium w-full min-h-screen box-border"
      style={{
        backgroundColor: "#faf8f3",
        color: "#0d2822",
        padding: "16px 16px 48px",
      }}
      aria-label="Jaipur Metro Guide (Loading)"
    >
      {/* 1. TOP NAVIGATION BAR SKELETON */}
      <header
        className="metro-topbar w-full max-w-[1280px] mx-auto mb-5 p-2.5 sm:px-4 bg-white border border-[#e6dfd1] rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-xs animate-pulse"
        style={{ minHeight: "60px" }}
      >
        <div className="metro-brand flex items-center gap-3">
          <div
            className="metro-brand-mark w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm"
            style={{ background: "linear-gradient(135deg, #022c22 0%, #064e3b 100%)" }}
          >
            <span style={{ fontSize: "18px" }}>🚇</span>
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: "15px", fontWeight: 850, color: "#022c22" }}>
              Jaipur Metro Guide
            </h1>
            <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, color: "#e11d48", textTransform: "uppercase" }}>
              ● Pink Line · Phase 1A &amp; 1B
            </p>
          </div>
        </div>

        <div className="metro-topbar-actions flex items-center gap-2.5">
          <div
            className="metro-status-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
            style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46" }}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block" />
            <span>Operational · 06:20 – 21:50</span>
          </div>
          <div
            className="metro-back-button inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 bg-white border border-[#e6dfd1] rounded-xl text-xs font-bold text-[#064e3b] shadow-xs cursor-pointer"
          >
            <span>←</span>
            <span>Bus Tracking</span>
          </div>
        </div>
      </header>

      {/* 2. HERO CARD SKELETON (Explicit heights matching responsive styles) */}
      <section
        className="metro-hero w-full max-w-[1280px] mx-auto mb-6 h-[250px] sm:h-[310px] lg:h-[380px] rounded-2xl sm:rounded-[22px] lg:rounded-[30px] overflow-hidden bg-[#02281e] shadow-lg border border-[#e6dfd1] relative animate-pulse"
        aria-hidden="true"
      >
        <div className="w-full h-full bg-[#02281e]/90 flex items-center justify-center text-emerald-200/50 font-bold text-sm tracking-wide">
          <span>Jaipur Metro Pink Line Guide</span>
        </div>
      </section>

      {/* 3. METRO STATS BAR SKELETON (4 Cards matching 2x2 mobile / 4x1 desktop) */}
      <section
        className="metro-stats w-full max-w-[1280px] mx-auto mb-8 grid grid-cols-2 lg:grid-cols-4 gap-3.5 animate-pulse"
        aria-hidden="true"
      >
        {[
          { val: "11.97 km", lbl: "Corridor Length" },
          { val: "11 Stations", lbl: "8 Elevated · 3 Underground" },
          { val: "06:20 – 21:50", lbl: "Operating Schedule" },
          { val: "₹6 – ₹22", lbl: "Token / 10% Card Rebate" },
        ].map((item, idx) => (
          <div
            key={idx}
            className="metro-stat-card bg-white border border-[#e6dfd1] rounded-2xl p-4 shadow-xs flex items-center gap-3.5"
            style={{ minHeight: "76px" }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46" }}
            >
              <span>●</span>
            </div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 850, color: "#022c22" }}>{item.val}</div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#4e635c" }}>{item.lbl}</div>
            </div>
          </div>
        ))}
      </section>

      {/* 4. MAIN NAVIGATION TABS & CONTENT GRID SKELETON */}
      <section className="metro-main-section w-full max-w-[1280px] mx-auto animate-pulse" aria-hidden="true">
        <div className="metro-section-header flex items-center justify-between mb-3.5">
          <div>
            <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "#065f46", letterSpacing: "0.06em" }}>
              Explore Public Transit
            </div>
            <h2 style={{ margin: "2px 0 0", fontSize: "18px", fontWeight: 850, color: "#022c22" }}>
              Pink Line Corridor Tools
            </h2>
          </div>
          <span style={{ fontSize: "11px", fontWeight: 750, color: "#4e635c" }}>
            Phase 1A &amp; Phase 1B
          </span>
        </div>

        <nav
          className="metro-nav-tabs grid grid-cols-3 gap-2 p-1.5 bg-[#f4efe4] rounded-2xl mb-4"
          style={{ minHeight: "52px" }}
        >
          <div className="metro-tab-btn active flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-white text-[#022c22] font-extrabold text-xs shadow-xs border border-[#e6dfd1]">
            <span>⇄</span>
            <span>Plan Journey</span>
          </div>
          <div className="metro-tab-btn flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-[#4e635c] font-bold text-xs">
            <span>◎</span>
            <span>Explore Stations (11)</span>
          </div>
          <div className="metro-tab-btn flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-[#4e635c] font-bold text-xs">
            <span>₹</span>
            <span>Fares &amp; Timings</span>
          </div>
        </nav>

        <div className="metro-content-grid grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
          {/* Left Column: Map Panel Skeleton */}
          <section
            className="metro-panel metro-map-panel bg-white border border-[#e6dfd1] rounded-2xl sm:rounded-[22px] p-4 sm:p-5 shadow-sm flex flex-col justify-between"
            style={{ minHeight: "540px" }}
          >
            <div>
              <div className="metro-panel-header flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 850, color: "#022c22" }}>
                    Interactive Corridor Map
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: "11.5px", color: "#4e635c" }}>
                    Click any station marker to view details or set as origin / destination.
                  </p>
                </div>
                <span
                  className="px-2.5 py-1 rounded-full text-xs font-extrabold"
                  style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be185d" }}
                >
                  Pink Line
                </span>
              </div>

              <div
                className="metro-map-container w-full h-[380px] sm:h-[440px] bg-slate-100 rounded-xl relative overflow-hidden flex items-center justify-center text-slate-400 text-xs font-semibold"
              >
                <span>Jaipur Metro Pink Line Track · Mansarovar ↔ Badi Chaupar</span>
              </div>
            </div>

            <div
              className="metro-map-legend-bar mt-3 p-2 bg-[#f4efe4] rounded-xl flex flex-wrap items-center justify-between text-xs font-bold text-[#4e635c]"
              style={{ minHeight: "36px" }}
            >
              <span>Pink Line</span>
              <span>Active Trip</span>
              <span>Elevated (8)</span>
              <span>Underground (3)</span>
            </div>
          </section>

          {/* Right Column: Journey Planner Skeleton */}
          <section
            className="metro-panel metro-journey-panel bg-white border border-[#e6dfd1] rounded-2xl sm:rounded-[22px] p-4 sm:p-5 shadow-sm flex flex-col justify-between"
            style={{ minHeight: "540px" }}
          >
            <div>
              <div className="metro-panel-header flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 850, color: "#022c22" }}>
                    Trip Planner
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: "11.5px", color: "#4e635c" }}>
                    Select boarding &amp; destination stations for fares, stops and timings.
                  </p>
                </div>
                <span
                  className="px-2.5 py-1 rounded-full text-xs font-extrabold"
                  style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46" }}
                >
                  JMRC Slabs
                </span>
              </div>

              <div className="p-3.5 bg-[#f4efe4] border border-[#e6dfd1] rounded-xl flex flex-col gap-2.5">
                <div className="p-3 bg-white border border-[#e6dfd1] rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
                    <span style={{ fontSize: "13px", fontWeight: 800, color: "#022c22" }}>Mansarovar (मानसरोवर)</span>
                  </div>
                  <span style={{ fontSize: "11px", color: "#064e3b", fontWeight: 800 }}>Origin</span>
                </div>

                <div className="flex justify-center -my-1">
                  <div className="px-3 py-1 bg-white border border-[#e6dfd1] rounded-full text-xs font-bold text-[#064e3b]">
                    ⇅ Swap Stations
                  </div>
                </div>

                <div className="p-3 bg-white border border-[#e6dfd1] rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block" />
                    <span style={{ fontSize: "13px", fontWeight: 800, color: "#022c22" }}>Badi Chaupar (बड़ी चौपड़)</span>
                  </div>
                  <span style={{ fontSize: "11px", color: "#9f1239", fontWeight: 800 }}>Alight</span>
                </div>
              </div>

              <div className="mt-3.5 p-3.5 bg-white border border-[#e6dfd1] rounded-xl shadow-xs">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                  <span className="text-xs font-extrabold text-[#065f46]">Towards Badi Chaupar (Eastbound)</span>
                  <span className="text-xs font-black text-rose-600">11 Stations</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="p-2 bg-[#faf8f3] rounded-lg">
                    <div style={{ fontSize: "10px", color: "#4e635c", fontWeight: 700 }}>Token Fare</div>
                    <div style={{ fontSize: "14px", color: "#022c22", fontWeight: 850 }}>₹22</div>
                  </div>
                  <div className="p-2 bg-[#faf8f3] rounded-lg">
                    <div style={{ fontSize: "10px", color: "#4e635c", fontWeight: 700 }}>Smart Card</div>
                    <div style={{ fontSize: "14px", color: "#047857", fontWeight: 850 }}>₹19.80</div>
                  </div>
                  <div className="p-2 bg-[#faf8f3] rounded-lg">
                    <div style={{ fontSize: "10px", color: "#4e635c", fontWeight: 700 }}>Duration</div>
                    <div style={{ fontSize: "14px", color: "#022c22", fontWeight: 850 }}>~24 mins</div>
                  </div>
                  <div className="p-2 bg-[#faf8f3] rounded-lg">
                    <div style={{ fontSize: "10px", color: "#4e635c", fontWeight: 700 }}>Distance</div>
                    <div style={{ fontSize: "14px", color: "#022c22", fontWeight: 850 }}>11.97 km</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      {/* 5. FAQ PANEL SKELETON (7 items matching exact layout) */}
      <section
        className="metro-panel w-full max-w-[1280px] mx-auto mt-6 bg-white border border-[#e6dfd1] rounded-2xl sm:rounded-[22px] p-4 sm:p-6 shadow-sm animate-pulse"
        aria-hidden="true"
      >
        <div className="metro-panel-header flex items-start justify-between gap-3 mb-3.5">
          <div>
            <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 850, color: "#022c22" }}>
              Frequently Asked Questions (FAQ)
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: "11.5px", color: "#4e635c" }}>
              Verified transit facts, schedules, and fare rules for Jaipur Metro (JMRC Pink Line).
            </p>
          </div>
          <span
            className="px-2.5 py-1 rounded-full text-xs font-extrabold"
            style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46" }}
          >
            JMRC Guide
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {[
            { q: "What are the operating timings of Jaipur Metro Pink Line?", h: "82px" },
            { q: "How many stations are there on the Jaipur Metro Pink Line?", h: "48px" },
            { q: "What is the ticket fare for Jaipur Metro?", h: "48px" },
            { q: "Where can I interchange between Jaipur Metro, Indian Railways, and Bus Stand?", h: "48px" },
            { q: "How long does it take to travel the entire Jaipur Metro Pink Line?", h: "48px" },
            { q: "What is the Jaipur Metro route between Mansarovar, Railway Station, and Chandpole?", h: "48px" },
            { q: "How can I find the nearest Jaipur Metro station and plan my journey?", h: "48px" },
          ].map((item, idx) => (
            <div
              key={idx}
              style={{
                minHeight: item.h,
                background: "#f4efe4",
                border: "1px solid #e6dfd1",
                borderRadius: "16px",
                padding: "12px 16px",
                display: "flex",
                alignItems: "center"
              }}
            >
              <span style={{ fontWeight: 800, fontSize: "13px", color: "#022c22" }}>
                {item.q}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 6. FOOTER CTA SKELETON */}
      <section
        className="metro-footer-cta w-full max-w-[1280px] mx-auto mt-6 p-5 sm:p-7 rounded-2xl sm:rounded-[22px] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-md animate-pulse"
        style={{ background: "linear-gradient(135deg, #022c22 0%, #064e3b 100%)", color: "#ffffff" }}
        aria-hidden="true"
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 850 }}>Connecting Jaipur with Bus &amp; Metro</h2>
          <p style={{ margin: "4px 0 0", fontSize: "12px", opacity: 0.9 }}>
            Jaipur Metro and JCTSL city buses provide integrated public transportation across the Pink City.
          </p>
        </div>
        <div
          className="metro-btn-primary min-h-[44px] px-6 py-3 rounded-xl text-xs font-bold shrink-0"
          style={{ background: "linear-gradient(135deg, #e11d48 0%, #be185d 100%)", color: "#ffffff" }}
        >
          <span>Live Bus Tracking →</span>
        </div>
      </section>

      {/* 7. BOTTOM BRANDING & COPYRIGHT SKELETON */}
      <footer
        className="metro-footer-bar w-full max-w-[1280px] mx-auto mt-4 pt-3 border-t border-[#e6dfd1] flex flex-col sm:flex-row justify-between text-xs text-[#4e635c] animate-pulse"
        style={{ minHeight: "40px" }}
        aria-hidden="true"
      >
        <span>© 2026 Jaipur Bus Live (JBL) · Jaipur Metro Guide (JMRC)</span>
        <span>Mansarovar ↔ Badi Chaupar · 11 Stations · East-West Transit Corridor</span>
      </footer>
    </main>
  );
}
