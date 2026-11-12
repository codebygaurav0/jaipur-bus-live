import { useState, useMemo } from "react";
import "./EmergencyView.css";

// Verified Official Jaipur & Rajasthan Emergency Helplines
const EMERGENCY_CONTACTS = [
  // 1. Universal / Police
  {
    id: "112",
    name: "Universal Emergency Response (ERSS)",
    hindiName: "अखिल भारतीय आपातकालीन नंबर (112)",
    number: "112",
    category: "police",
    categoryLabel: "National ERSS",
    badge: "24×7 Active",
    icon: "🚨",
    urgent: true,
    desc: "Single emergency response number for Police, Fire, and Medical assistance across Rajasthan and India.",
    authority: "Ministry of Home Affairs / Rajasthan Police",
    tags: ["police", "112", "emergency", "fire", "ambulance", "crime", "accident"],
  },
  {
    id: "100",
    name: "Rajasthan Police Control Room",
    hindiName: "राजस्थान पुलिस नियंत्रण कक्ष",
    number: "100",
    category: "police",
    categoryLabel: "State Police",
    badge: "24×7 Official",
    icon: "👮",
    urgent: true,
    desc: "Direct police dispatch line for law and order, street safety, and immediate emergency response.",
    authority: "Rajasthan Police Headquarters, Jaipur",
    tags: ["police", "100", "thana", "patrol", "crime"],
  },
  {
    id: "jaipur-comm",
    name: "Jaipur Police Commissionerate Control",
    hindiName: "जयपुर पुलिस आयुक्तालय कंट्रोल रूम",
    number: "0141-2561256",
    category: "police",
    categoryLabel: "Jaipur City Police",
    badge: "24×7 City Control",
    icon: "🏛️",
    urgent: false,
    desc: "Dedicated city control room covering North and South police districts of Jaipur Metropolitan.",
    authority: "Jaipur Police Commissionerate, MI Road",
    tags: ["police", "commissionerate", "jaipur", "city police"],
  },
  {
    id: "1095",
    name: "Jaipur Traffic Police Helpline",
    hindiName: "जयपुर ट्रैफिक पुलिस हेल्पलाइन",
    number: "1095",
    category: "police",
    categoryLabel: "Traffic Police",
    badge: "24×7 Helpline",
    icon: "🚦",
    urgent: false,
    desc: "Road traffic congestion, signal breakdown, accident reporting, and towing assistance in Jaipur.",
    authority: "Jaipur Traffic Police, Yadgar MI Road",
    tags: ["traffic", "1095", "jam", "parking", "accident", "towing"],
  },

  // 2. Medical / Ambulance
  {
    id: "108",
    name: "Medical Emergency Ambulance (108)",
    hindiName: "आपातकालीन एम्बुलेंस सेवा (108)",
    number: "108",
    category: "medical",
    categoryLabel: "Ambulance",
    badge: "Free 24×7 Service",
    icon: "🚑",
    urgent: true,
    desc: "Govt-supported free emergency ambulance with onboard life-support equipment and paramedics.",
    authority: "National Health Mission, Rajasthan",
    tags: ["ambulance", "108", "hospital", "doctor", "medical", "accident", "heart"],
  },
  {
    id: "102",
    name: "Janani Express / Child & Maternal Ambulance",
    hindiName: "जननी एक्सप्रेस एम्बुलेंस (102)",
    number: "102",
    category: "medical",
    categoryLabel: "Maternal & Child",
    badge: "Free 24×7 Service",
    icon: "👶",
    urgent: false,
    desc: "Dedicated medical transport for pregnant women, newborns, and infants to the nearest government hospital.",
    authority: "Medical & Health Dept, Rajasthan",
    tags: ["102", "ambulance", "pregnancy", "mother", "child", "hospital"],
  },
  {
    id: "104",
    name: "Medical Advice & Blood Bank Helpline",
    hindiName: "स्वास्थ्य परामर्श एवं ब्लड बैंक (104)",
    number: "104",
    category: "medical",
    categoryLabel: "Health Advice",
    badge: "Toll-Free 24×7",
    icon: "🩺",
    urgent: false,
    desc: "Verified tele-medical advice, nearest blood bank directory, and government hospital bed guidance.",
    authority: "Govt of Rajasthan Health Helpline",
    tags: ["104", "blood", "medical advice", "hospital", "telemedicine"],
  },

  // 3. Fire & Rescue
  {
    id: "101",
    name: "Jaipur Fire Brigade & Rescue Service",
    hindiName: "अग्निशमन एवं आपदा बचाव (101)",
    number: "101",
    category: "fire",
    categoryLabel: "Fire Control",
    badge: "24×7 Emergency",
    icon: "🚒",
    urgent: true,
    desc: "Municipal fire stations, chemical fire control, rescue operations, and building evacuation.",
    authority: "Nagar Nigam Greater & Heritage Jaipur Fire Dept",
    tags: ["fire", "101", "rescue", "flame", "smoke", "nagar nigam"],
  },

  // 4. Women Safety & Children
  {
    id: "1090",
    name: "Women Helpline Rajasthan (Abhaya)",
    hindiName: "महिला हेल्पलाइन राजस्थान (1090)",
    number: "1090",
    category: "women",
    categoryLabel: "Women Safety",
    badge: "24×7 Confidential",
    icon: "🛡️",
    urgent: true,
    desc: "Specialized assistance for women facing harassment, stalking, domestic distress, or transit safety concerns.",
    authority: "Rajasthan Police Women Security Cell",
    tags: ["women", "1090", "harassment", "mahila", "safety", "girls"],
  },
  {
    id: "181",
    name: "Rajasthan Mahila & Citizen Helpline (181)",
    hindiName: "राजस्थान महिला एवं नागरिक हेल्पलाइन (181)",
    number: "181",
    category: "women",
    categoryLabel: "Govt Helpdesk",
    badge: "Toll-Free 24×7",
    icon: "📞",
    urgent: false,
    desc: "Integrated state assistance for legal counseling, emergency shelter, and grievance escalation.",
    authority: "Govt of Rajasthan Helpline 181",
    tags: ["181", "mahila", "grievance", "women", "counseling"],
  },
  {
    id: "1098",
    name: "Childline India Protection Helpline",
    hindiName: "चाइल्डलाइन भारत (1098)",
    number: "1098",
    category: "women",
    categoryLabel: "Child Protection",
    badge: "24×7 Toll-Free",
    icon: "🧒",
    urgent: false,
    desc: "Nationwide helpline for children in need of care, protection, shelter, and rescue from distress or exploitation.",
    authority: "Ministry of Women & Child Development",
    tags: ["child", "1098", "childline", "children", "protection", "lost child"],
  },

  // 5. Disaster Management & Rescue
  {
    id: "1070",
    name: "Rajasthan State Disaster Control Room",
    hindiName: "राज्य आपदा प्रबंधन नियंत्रण कक्ष (1070)",
    number: "1070",
    category: "disaster",
    categoryLabel: "State Disaster",
    badge: "State EOC Active",
    icon: "🌊",
    urgent: false,
    desc: "Emergency management for floods, extreme weather, structural collapses, and natural calamities in Rajasthan.",
    authority: "Disaster Management & Relief Dept, Rajasthan",
    tags: ["disaster", "1070", "flood", "earthquake", "sdrf", "ndrf"],
  },
  {
    id: "1077",
    name: "District Emergency Operation Centre (DEOC Jaipur)",
    hindiName: "जिला आपदा नियंत्रण कक्ष जयपुर (1077)",
    number: "1077",
    category: "disaster",
    categoryLabel: "District DEOC",
    badge: "Jaipur Collectorate",
    icon: "🏢",
    urgent: false,
    desc: "District Magistrate & Collector emergency command desk for Jaipur city and rural zones.",
    authority: "District Collectorate, Bani Park, Jaipur",
    tags: ["1077", "collector", "jaipur district", "disaster", "relief"],
  },

  // 6. Cyber & Financial Fraud
  {
    id: "1930",
    name: "National Cyber Crime Reporting Portal",
    hindiName: "राष्ट्रीय साइबर अपराध हेल्पलाइन (1930)",
    number: "1930",
    category: "cyber",
    categoryLabel: "Cyber Police",
    badge: "Golden Hour Active",
    icon: "💻",
    urgent: true,
    desc: "Immediate reporting of UPI, banking, credit card, and online financial fraud to freeze suspect accounts.",
    authority: "Indian Cyber Crime Coordination Centre (I4C)",
    tags: ["cyber", "1930", "fraud", "upi", "banking", "scam", "otp", "police"],
  },

  // 7. Transit & Commuter
  {
    id: "metro-help",
    name: "Jaipur Metro Rail Corporation (JMRC)",
    hindiName: "जयपुर मेट्रो हेल्पलाइन",
    number: "0141-2822171",
    category: "transit",
    categoryLabel: "Metro Transit",
    badge: "Transit Control",
    icon: "🚇",
    urgent: false,
    desc: "Station assistance, lost and found, smart card queries, and passenger security across Pink Line stations.",
    authority: "Jaipur Metro Rail Corporation, Mansarovar Depot",
    tags: ["metro", "jmrc", "pink line", "subway", "train", "lost found"],
  },
  {
    id: "jctsl-help",
    name: "JCTSL City Bus Commuter Support",
    hindiName: "जयपुर सिटी ट्रांसपोर्ट (JCTSL) हेल्पलाइन",
    number: "1800-180-6088",
    category: "transit",
    categoryLabel: "City Bus",
    badge: "Toll-Free Support",
    icon: "🚌",
    urgent: false,
    desc: "City bus route inquiries, pass queries, driver/conductor feedback, and lost property assistance.",
    authority: "Jaipur City Transport Services Ltd",
    tags: ["bus", "jctsl", "ticket", "route", "conductor"],
  },
  {
    id: "1363",
    name: "Tourist Information & Assistance Infoline",
    hindiName: "पर्यटक सहायता हेल्पलाइन (1363)",
    number: "1363",
    category: "transit",
    categoryLabel: "Tourist Police",
    badge: "Multilingual 24×7",
    icon: "🏰",
    urgent: false,
    desc: "Guidance for domestic and international travelers visiting Jaipur monuments, forts, and heritage sites.",
    authority: "Ministry of Tourism, Govt of India",
    tags: ["tourist", "1363", "travel", "visitor", "hawa mahal", "fort", "foreigner"],
  },
  {
    id: "14567",
    name: "National Helpline for Senior Citizens (Elderline)",
    hindiName: "वरिष्ठ नागरिक हेल्पलाइन (एल्डरलाइन)",
    number: "14567",
    category: "police",
    categoryLabel: "Senior Citizens",
    badge: "Toll-Free Support",
    icon: "🧓",
    urgent: false,
    desc: "Assistance, emotional support, elder abuse rescue, and field intervention for senior citizens in Jaipur.",
    authority: "Ministry of Social Justice & Empowerment",
    tags: ["senior citizen", "elderline", "14567", "elderly", "old age"],
  },
];

// Verified Public Safety Notices & Civic Advisories
const VERIFIED_SAFETY_NOTICES = [
  {
    id: "notice-1",
    type: "official",
    tag: "ERSS 112 Advisory",
    date: "Current Active Protocol",
    title: "Single Emergency Response System (ERSS 112) in Jaipur",
    desc: "Dialing 112 connects callers to the centralized GIS-enabled control room in Jaipur. The system automatically coordinates Police (100), Fire (101), and Ambulance (108) based on your caller GPS.",
    source: "Jaipur Police Commissionerate & CCTNS",
    url: "https://police.rajasthan.gov.in",
  },
  {
    id: "notice-2",
    type: "official",
    tag: "Cyber Fraud Protocol",
    date: "Golden Hour Action",
    title: "Immediate Action for Online & UPI Frauds (Dial 1930)",
    desc: "If money is debited fraudulently via UPI or phishing, calling 1930 within the first 2 hours triggers an instant freeze across participating beneficiary bank nodal accounts.",
    source: "Rajasthan Police State Cyber Cell",
    url: "https://cybercrime.gov.in",
  },
  {
    id: "notice-3",
    type: "transit",
    tag: "Transit Safety",
    date: "Public Safety Standard",
    title: "CCTV Surveillance & Pink Line Safety Infrastructure",
    desc: "All JMRC Metro stations and major JCTSL interchange terminals (Sindhi Camp, Ajmeri Gate, Badi Chaupar) operate 24×7 CCTV monitoring and have dedicated women passenger help desks.",
    source: "JMRC & JCTSL Security Administration",
    url: "https://transport.rajasthan.gov.in",
  },
  {
    id: "notice-4",
    type: "official",
    tag: "DEOC Civic Notice",
    date: "Seasonal Preparedness",
    title: "District Disaster & Weather Advisory (DEOC 1077)",
    desc: "For localized flooding, fallen electrical cables, or building hazard reporting during severe weather events, contact the District Emergency Operation Centre at Jaipur Collectorate.",
    source: "District Disaster Management Authority, Jaipur",
    url: "https://jaipur.rajasthan.gov.in",
  },
];

const CATEGORIES = [
  { id: "all", label: "All Helplines", icon: "📋" },
  { id: "police", label: "Police & Law", icon: "👮" },
  { id: "medical", label: "Ambulance & Medical", icon: "🚑" },
  { id: "fire", label: "Fire & Rescue", icon: "🚒" },
  { id: "women", label: "Women & Child", icon: "🛡️" },
  { id: "disaster", label: "Disaster (SDRF)", icon: "🌊" },
  { id: "cyber", label: "Cyber Crime", icon: "💻" },
  { id: "transit", label: "Transit & Travel", icon: "🚌" },
];

export default function EmergencyView({ userPos, onBackToBus }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [copiedLocation, setCopiedLocation] = useState(false);
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [internalPos, setInternalPos] = useState(null);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState("");

  // Safe coordinates (resolves active live GPS or defaults to Jaipur Metropolitan Transit Zone)
  const coords = useMemo(() => {
    const effectiveLat =
      typeof internalPos?.lat === "number"
        ? internalPos.lat
        : typeof userPos?.lat === "number"
        ? userPos.lat
        : 26.9124;
    const effectiveLng =
      typeof internalPos?.lng === "number"
        ? internalPos.lng
        : typeof userPos?.lng === "number"
        ? userPos.lng
        : 75.7873;
    const isReal = Boolean(
      (internalPos?.lat && internalPos?.lng) || (userPos?.lat && userPos?.lng)
    );

    return {
      lat: effectiveLat,
      lng: effectiveLng,
      isReal,
    };
  }, [userPos, internalPos]);

  // Handle direct GPS location request with clear permission messaging
  const handleRequestLiveLocation = () => {
    if (!navigator.geolocation) {
      setLocError("Geolocation is not supported by your browser.");
      return;
    }

    setLocLoading(true);
    setLocError("");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setInternalPos({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocLoading(false);
        setLocError("");
      },
      (err) => {
        setLocLoading(false);
        let msg = "Unable to retrieve your location.";
        if (err.code === 1) {
          msg = "Location permission was denied. You can enable it in your browser site settings or share default Jaipur Metropolitan coordinates.";
        } else if (err.code === 2) {
          msg = "GPS signal is currently unavailable. Please check that device location services are switched on.";
        } else if (err.code === 3) {
          msg = "GPS request timed out. Please try again.";
        }
        setLocError(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  };

  // Filtered contacts based on search query and category tab
  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return EMERGENCY_CONTACTS.filter((item) => {
      // Category filter
      if (activeCategory !== "all" && item.category !== activeCategory) {
        return false;
      }
      // Query filter
      if (!q) return true;

      const inName = item.name.toLowerCase().includes(q);
      const inHindi = item.hindiName.toLowerCase().includes(q);
      const inNumber = item.number.toLowerCase().includes(q);
      const inDesc = item.desc.toLowerCase().includes(q);
      const inTags = item.tags.some((t) => t.toLowerCase().includes(q));

      return inName || inHindi || inNumber || inDesc || inTags;
    });
  }, [activeCategory, searchQuery]);

  // Category count helper
  const getCategoryCount = (catId) => {
    if (catId === "all") return EMERGENCY_CONTACTS.length;
    return EMERGENCY_CONTACTS.filter((c) => c.category === catId).length;
  };

  // Location sharing handler
  const handleShareLocation = async () => {
    const mapsUrl = `https://www.google.com/maps?q=${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
    const shareText = `🚨 EMERGENCY ALERT: My location in Jaipur is https://www.google.com/maps?q=${coords.lat.toFixed(5)},${coords.lng.toFixed(5)} (GPS Coordinates: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "🚨 Jaipur Emergency Location SOS",
          text: shareText,
          url: mapsUrl,
        });
        return;
      } catch {
        // User dismissed share dialog or browser cancelled
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedLocation(true);
      setTimeout(() => setCopiedLocation(false), 3500);
    } catch {
      window.open(mapsUrl, "_blank");
    }
  };

  // Copy GPS coordinates handler
  const handleCopyCoords = async () => {
    const text = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCoords(true);
      setTimeout(() => setCopiedCoords(false), 3000);
    } catch {
      // Fallback
    }
  };

  // Copy individual helpline phone number
  const handleCopyNumber = async (contact) => {
    const cleanNum = contact.number.replace(/[^0-9]/g, "");
    try {
      await navigator.clipboard.writeText(cleanNum);
      setCopiedId(contact.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="emergency-premium">
      {/* =================================================================== */}
      {/* 1. TOP NAVIGATION BAR (SINGLE CLEAN HEADER, NO DUPLICATES)          */}
      {/* =================================================================== */}
      <header className="emergency-topbar" role="banner">
        <div className="emergency-topbar-left">
          {onBackToBus && (
            <button
              type="button"
              onClick={onBackToBus}
              className="emergency-back-btn"
              title="Return to Jaipur Bus Tracking"
              aria-label="Back to Jaipur Bus Tracking"
            >
              <span>←</span>
              <span>Bus Tracking</span>
            </button>
          )}

          <div className="emergency-brand-lockup">
            <div className="emergency-brand-icon" aria-hidden="true">
              🚨
            </div>
            <div className="emergency-brand-titles">
              <h1 className="emergency-brand-title">Jaipur Emergency & Safety SOS</h1>
              <span className="emergency-brand-sub">
                Quick Response Helplines • 24×7
              </span>
            </div>
          </div>
        </div>

        <div className="emergency-topbar-right">
          <div className="emergency-status-pill" title="Live GPS & Dispatch Active">
            <span className="emergency-pulse-dot" aria-hidden="true"></span>
            <span>{coords.isReal ? "GPS Active" : "Jaipur Zone"}</span>
          </div>
        </div>
      </header>

      {/* =================================================================== */}
      {/* 2. CALM BUT FUNCTIONAL HERO SECTION                                 */}
      {/* =================================================================== */}
      <section className="emergency-hero" aria-labelledby="emergency-hero-heading">
        <span className="emergency-hero-badge">
          <span>●</span> 24×7 Verified Emergency Helplines
        </span>
        <h2 id="emergency-hero-heading" className="emergency-hero-heading">
          Emergency help, when every second matters.
        </h2>
        <p className="emergency-hero-sub">
          Find essential emergency contacts and safety resources for Jaipur in one
          place. Direct carrier connection to official state police, ambulances, fire
          brigades, and women helplines.
        </p>

        {/* Above-the-fold Critical SOS Call Grid */}
        <div className="emergency-sos-grid" role="region" aria-label="Priority Emergency Dialers">
          {/* 112 Universal Emergency */}
          <a
            href="tel:112"
            className="emergency-sos-card red"
            aria-label="Call 112 for Universal Emergency and Police"
          >
            <div className="emergency-sos-left">
              <div className="emergency-sos-icon" aria-hidden="true">
                🚨
              </div>
              <div className="emergency-sos-info">
                <span className="emergency-sos-num">Call 112</span>
                <span className="emergency-sos-name">
                  National Emergency & Police (ERSS)
                </span>
              </div>
            </div>
            <div className="emergency-sos-right">
              <span className="emergency-sos-pill">
                <span>Tap to Call</span>
                <span>›</span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCopyNumber({ id: "112-top", number: "112" });
                }}
                className="emergency-sos-copy-btn"
                title="Copy 112 to clipboard"
                aria-label="Copy 112 emergency number"
              >
                {copiedId === "112-top" ? "✓" : "📋"}
              </button>
            </div>
          </a>

          {/* 108 Ambulance */}
          <a
            href="tel:108"
            className="emergency-sos-card emerald"
            aria-label="Call 108 for Medical Emergency and Free Ambulance"
          >
            <div className="emergency-sos-left">
              <div className="emergency-sos-icon" aria-hidden="true">
                🚑
              </div>
              <div className="emergency-sos-info">
                <span className="emergency-sos-num">Call 108</span>
                <span className="emergency-sos-name">
                  Medical Ambulance (Free 24×7)
                </span>
              </div>
            </div>
            <div className="emergency-sos-right">
              <span className="emergency-sos-pill">
                <span>Tap to Call</span>
                <span>›</span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCopyNumber({ id: "108-top", number: "108" });
                }}
                className="emergency-sos-copy-btn"
                title="Copy 108 to clipboard"
                aria-label="Copy 108 emergency number"
              >
                {copiedId === "108-top" ? "✓" : "📋"}
              </button>
            </div>
          </a>

          {/* 101 Fire Control */}
          <a
            href="tel:101"
            className="emergency-sos-card orange"
            aria-label="Call 101 for Fire Brigade and Rescue Control"
          >
            <div className="emergency-sos-left">
              <div className="emergency-sos-icon" aria-hidden="true">
                🚒
              </div>
              <div className="emergency-sos-info">
                <span className="emergency-sos-num">Call 101</span>
                <span className="emergency-sos-name">
                  Fire Brigade & Rescue Service
                </span>
              </div>
            </div>
            <div className="emergency-sos-right">
              <span className="emergency-sos-pill">
                <span>Tap to Call</span>
                <span>›</span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCopyNumber({ id: "101-top", number: "101" });
                }}
                className="emergency-sos-copy-btn"
                title="Copy 101 to clipboard"
                aria-label="Copy 101 emergency number"
              >
                {copiedId === "101-top" ? "✓" : "📋"}
              </button>
            </div>
          </a>

          {/* 1090 Women Helpline */}
          <a
            href="tel:1090"
            className="emergency-sos-card rose"
            aria-label="Call 1090 for Women Helpline Abhaya Rajasthan"
          >
            <div className="emergency-sos-left">
              <div className="emergency-sos-icon" aria-hidden="true">
                🛡️
              </div>
              <div className="emergency-sos-info">
                <span className="emergency-sos-num">Call 1090</span>
                <span className="emergency-sos-name">
                  Women Helpline Rajasthan (Abhaya)
                </span>
              </div>
            </div>
            <div className="emergency-sos-right">
              <span className="emergency-sos-pill">
                <span>Tap to Call</span>
                <span>›</span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCopyNumber({ id: "1090-top", number: "1090" });
                }}
                className="emergency-sos-copy-btn"
                title="Copy 1090 to clipboard"
                aria-label="Copy 1090 emergency number"
              >
                {copiedId === "1090-top" ? "✓" : "📋"}
              </button>
            </div>
          </a>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 3. LIVE GPS LOCATION & DISPATCH ASSISTANCE CARD                     */}
      {/* =================================================================== */}
      <section className="emergency-location-card" aria-labelledby="emergency-loc-heading">
        <div className="emergency-location-header">
          <div className="emergency-location-title-group">
            <div className="emergency-location-icon" aria-hidden="true">
              📍
            </div>
            <div>
              <h3 id="emergency-loc-heading" className="emergency-location-title">
                Your Live GPS & Dispatch Location
              </h3>
            </div>
          </div>
          <span className="emergency-location-badge">
            <span>●</span> {coords.isReal ? "High Precision GPS" : "Default Transit Zone"}
          </span>
        </div>

        <div className="emergency-location-body">
          <div className="emergency-coords-row">
            <span className="emergency-coords-label">Coordinates for Dispatchers:</span>
            <span className="emergency-coords-value">
              {coords.lat.toFixed(5)}° N, {coords.lng.toFixed(5)}° E
            </span>
            <span className="emergency-coords-desc">
              Share these exact coordinates with the 112/108 dispatcher for rapid
              vehicle dispatch to your exact position in Jaipur.
            </span>
          </div>

          <div className="emergency-location-actions">
            <button
              type="button"
              onClick={handleRequestLiveLocation}
              disabled={locLoading}
              className={`emergency-loc-btn ${coords.isReal ? "secondary" : "primary"}`}
              title="Detect your high-precision live GPS coordinates"
            >
              <span>{locLoading ? "⏳" : "🎯"}</span>
              <span>{locLoading ? "Detecting GPS..." : coords.isReal ? "Refresh GPS" : "Detect My GPS"}</span>
            </button>

            <button
              type="button"
              onClick={handleShareLocation}
              className="emergency-loc-btn primary"
              title="Share live location via WhatsApp, SMS, or copy link"
            >
              <span>📲</span>
              <span>Share Location</span>
            </button>

            <button
              type="button"
              onClick={handleCopyCoords}
              className="emergency-loc-btn secondary"
              title="Copy GPS coordinates to clipboard"
            >
              <span>📋</span>
              <span>Copy GPS</span>
            </button>

            <a
              href={`https://www.google.com/maps?q=${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="emergency-loc-btn secondary"
              title="Open coordinates in Google Maps app or browser"
            >
              <span>🗺️</span>
              <span>Open Maps</span>
            </a>
          </div>
        </div>

        {locError && (
          <div className="emergency-loc-error-banner" role="alert">
            <span>⚠️</span>
            <span>{locError}</span>
          </div>
        )}

        {copiedLocation && (
          <div className="emergency-copy-feedback" role="alert">
            <span>✓</span>
            <span>Emergency location link and GPS coordinates copied to clipboard!</span>
          </div>
        )}

        {copiedCoords && (
          <div className="emergency-copy-feedback" role="alert">
            <span>✓</span>
            <span>
              GPS Coordinates ({coords.lat.toFixed(5)}, {coords.lng.toFixed(5)})
              copied!
            </span>
          </div>
        )}
      </section>

      {/* =================================================================== */}
      {/* 4. FAST SEARCH & CATEGORY FILTER TABS                               */}
      {/* =================================================================== */}
      <section className="emergency-filter-section" aria-label="Search and filter emergency contacts">
        {/* Search input */}
        <div className="emergency-search-bar">
          <span className="emergency-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search helpline by name, number, or service (e.g. Police, 112, Ambulance, Fire, Cyber)..."
            className="emergency-search-input"
            aria-label="Search emergency helplines"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="emergency-clear-btn"
              title="Clear search"
              aria-label="Clear search"
            >
              ✕ Clear
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="emergency-chips-wrapper" role="tablist" aria-label="Helpline Categories">
          {CATEGORIES.map((cat) => {
            const count = getCategoryCount(cat.id);
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveCategory(cat.id)}
                className={`emergency-chip ${isActive ? "active" : ""}`}
              >
                <span aria-hidden="true">{cat.icon}</span>
                <span>{cat.label}</span>
                <span className="emergency-chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* =================================================================== */}
      {/* 5. VERIFIED HELPLINE DIRECTORY CARDS GRID                           */}
      {/* =================================================================== */}
      <section className="emergency-cards-section" aria-labelledby="emergency-directory-heading">
        <div className="emergency-section-header">
          <h3 id="emergency-directory-heading" className="emergency-section-title">
            <span>🏛️</span>
            <span>Jaipur Emergency Contacts Directory</span>
          </h3>
          <span className="emergency-section-count">
            Showing {filteredContacts.length} of {EMERGENCY_CONTACTS.length} services
          </span>
        </div>

        {filteredContacts.length === 0 ? (
          <div className="emergency-empty-state" role="status">
            <div className="emergency-empty-icon" aria-hidden="true">
              🔍
            </div>
            <h4 className="emergency-empty-title">No matching emergency services found</h4>
            <p className="emergency-empty-desc">
              We couldn't find any helpline matching &ldquo;{searchQuery}&rdquo;. Try
              searching for general terms like &ldquo;police&rdquo;,
              &ldquo;ambulance&rdquo;, or &ldquo;fire&rdquo;.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setActiveCategory("all");
              }}
              className="emergency-reset-btn"
            >
              Reset Filters & Show All
            </button>
          </div>
        ) : (
          <div className="emergency-cards-grid">
            {filteredContacts.map((contact) => {
              const isCopied = copiedId === contact.id;
              const telUri = `tel:${contact.number.replace(/[^0-9]/g, "")}`;

              return (
                <article key={contact.id} className="emergency-card">
                  <div>
                    {/* Top Row: Category badge & verified status */}
                    <div className="emergency-card-top">
                      <span className={`emergency-card-category ${contact.category}`}>
                        {contact.categoryLabel}
                      </span>
                      <span className="emergency-card-verified">
                        <span>✓</span>
                        <span>{contact.badge}</span>
                      </span>
                    </div>

                    {/* Service Name & Hindi title */}
                    <div className="emergency-card-title-row">
                      <div className="emergency-card-icon" aria-hidden="true">
                        {contact.icon}
                      </div>
                      <div className="emergency-card-names">
                        <h4 className="emergency-card-name">{contact.name}</h4>
                        <span className="emergency-card-hindi">
                          {contact.hindiName}
                        </span>
                      </div>
                    </div>

                    {/* Official Phone Number Highlight */}
                    <div className="emergency-card-phone-row">
                      <span className="emergency-card-number">{contact.number}</span>
                      <span className="emergency-card-type-tag">Official Line</span>
                    </div>

                    {/* Description & Scope */}
                    <p className="emergency-card-desc">{contact.desc}</p>
                  </div>

                  {/* Bottom Actions: Call Now & Copy */}
                  <div className="emergency-card-actions">
                    <a
                      href={telUri}
                      className={`emergency-call-btn ${contact.urgent ? "urgent" : ""}`}
                      aria-label={`Call ${contact.name} at ${contact.number}`}
                    >
                      <span aria-hidden="true">📞</span>
                      <span>Call Now</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => handleCopyNumber(contact)}
                      className="emergency-copy-icon-btn"
                      title={`Copy ${contact.number} to clipboard`}
                      aria-label={`Copy phone number for ${contact.name}`}
                    >
                      {isCopied ? "✓" : "📋"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* =================================================================== */}
      {/* 6. JAIPUR SAFETY UPDATES & CIVIC ADVISORIES                         */}
      {/* =================================================================== */}
      <section className="emergency-notices-section" aria-labelledby="emergency-notices-heading">
        <div className="emergency-section-header">
          <h3 id="emergency-notices-heading" className="emergency-section-title">
            <span>📢</span>
            <span>Jaipur Safety Updates & Official Civic Advisories</span>
          </h3>
          <span className="emergency-section-count">Verified Protocols</span>
        </div>

        <div className="emergency-notices-grid">
          {VERIFIED_SAFETY_NOTICES.map((notice) => (
            <div key={notice.id} className="emergency-notice-card">
              <div>
                <div className="emergency-notice-top">
                  <span className={`emergency-notice-tag ${notice.type}`}>
                    {notice.tag}
                  </span>
                  <span className="emergency-notice-date">{notice.date}</span>
                </div>
                <h4 className="emergency-notice-title">{notice.title}</h4>
                <p className="emergency-notice-desc">{notice.desc}</p>
              </div>

              <div className="emergency-notice-footer">
                <span className="emergency-notice-source">{notice.source}</span>
                <a
                  href={notice.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="emergency-notice-link"
                >
                  <span>Portal</span>
                  <span>›</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* =================================================================== */}
      {/* 7. PRACTICAL SAFETY GUIDANCE & REPORTING CHECKLIST                  */}
      {/* =================================================================== */}
      <section className="emergency-guidance-section" aria-labelledby="emergency-guidance-heading">
        <div className="emergency-section-header">
          <h3 id="emergency-guidance-heading" className="emergency-section-title">
            <span>🛡️</span>
            <span>Essential Citizen Safety Guidance</span>
          </h3>
        </div>

        <div className="emergency-guidance-grid">
          {/* Card 1: What to report */}
          <div className="emergency-guidance-card">
            <div className="emergency-guidance-header">
              <div className="emergency-guidance-icon" aria-hidden="true">
                📋
              </div>
              <h4 className="emergency-guidance-title">
                What to Tell the 112/108 Dispatcher
              </h4>
            </div>
            <ul className="emergency-guidance-list">
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">1.</span>
                <span>
                  <strong>Exact Location:</strong> Give nearby landmark (Metro
                  station, road crossing, circle, or colony gate).
                </span>
              </li>
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">2.</span>
                <span>
                  <strong>Nature of Emergency:</strong> Clearly state if it is a
                  road accident, medical cardiac, fire, or crime.
                </span>
              </li>
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">3.</span>
                <span>
                  <strong>Persons Involved:</strong> Mention how many injured or
                  unconscious people require medical attention.
                </span>
              </li>
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">4.</span>
                <span>
                  <strong>Hazard Alert:</strong> Note if there are active hazards
                  (fuel leaks, fire, traffic block).
                </span>
              </li>
            </ul>
          </div>

          {/* Card 2: Waiting precautions */}
          <div className="emergency-guidance-card">
            <div className="emergency-guidance-header">
              <div className="emergency-guidance-icon" aria-hidden="true">
                ⏳
              </div>
              <h4 className="emergency-guidance-title">
                Precautions While Waiting for Help
              </h4>
            </div>
            <ul className="emergency-guidance-list">
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">●</span>
                <span>
                  <strong>Stay on the line</strong> until the emergency operator
                  confirms vehicle dispatch and instructs you to hang up.
                </span>
              </li>
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">●</span>
                <span>
                  <strong>At night or low light,</strong> wave your smartphone
                  flashlight to signal the arriving police/ambulance van.
                </span>
              </li>
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">●</span>
                <span>
                  <strong>Keep hazard lights on</strong> if waiting inside or near a
                  vehicle on high-speed roads (e.g. JLN Marg, Tonk Road, Bypass).
                </span>
              </li>
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">●</span>
                <span>
                  <strong>Do not move injured persons</strong> with neck or back
                  trauma unless there is immediate danger of fire or incoming traffic.
                </span>
              </li>
            </ul>
          </div>

          {/* Card 3: Women commuter safety */}
          <div className="emergency-guidance-card">
            <div className="emergency-guidance-header">
              <div className="emergency-guidance-icon" aria-hidden="true">
                🌸
              </div>
              <h4 className="emergency-guidance-title">
                Women Transit Safety in Jaipur
              </h4>
            </div>
            <ul className="emergency-guidance-list">
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">●</span>
                <span>
                  <strong>Pink Line Metro:</strong> Dedicated coaches and reserved
                  seats for women commuters with panic alarm strips.
                </span>
              </li>
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">●</span>
                <span>
                  <strong>Abhaya Helpline (1090):</strong> 24×7 confidential women
                  protection service operated by Rajasthan Police.
                </span>
              </li>
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">●</span>
                <span>
                  <strong>JCTSL Safe Transit:</strong> Major bus stations (Sindhi
                  Camp, Ajmeri Gate) have security personnel and CCTV surveillance.
                </span>
              </li>
            </ul>
          </div>

          {/* Card 4: Tourist assistance */}
          <div className="emergency-guidance-card">
            <div className="emergency-guidance-header">
              <div className="emergency-guidance-icon" aria-hidden="true">
                🏰
              </div>
              <h4 className="emergency-guidance-title">
                Visitor & Tourist Safety Desk
              </h4>
            </div>
            <ul className="emergency-guidance-list">
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">●</span>
                <span>
                  <strong>Tourist Police Booths:</strong> Dedicated police desks at
                  Amber Fort, Hawa Mahal, City Palace, and Jaipur Junction.
                </span>
              </li>
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">●</span>
                <span>
                  <strong>Tourist Infoline (1363):</strong> Multi-lingual government
                  assistance for international and outstation travelers.
                </span>
              </li>
              <li className="emergency-guidance-item">
                <span className="emergency-guidance-bullet">●</span>
                <span>
                  <strong>Authorized Guides:</strong> Always verify RTDC authorized
                  badges before engaging heritage tour guides.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* 8. SAFE ADS INTEGRATION (CLEARLY ISOLATED, NON-INTERFERING)         */}
      {/* =================================================================== */}
      <aside className="emergency-ad-container" aria-label="Sponsorship and Community Partners">
        <span className="emergency-ad-label">
          Community Safety Initiative Partner
        </span>
        <div className="emergency-ad-slot">
          {/* Preserved AdSense container matching publisher ca-pub-9794253080735375 */}
          <ins
            className="adsbygoogle"
            style={{ display: "block", width: "100%", textAlign: "center" }}
            data-ad-client="ca-pub-9794253080735375"
            data-ad-slot="emergency_safety_footer"
            data-ad-format="auto"
            data-full-width-responsive="true"
          ></ins>
          <span>Jaipur Bus Live Civic Safety Network • Verified Government Helplines</span>
        </div>
      </aside>

      {/* =================================================================== */}
      {/* 9. EMERGENCY FOOTER & CIVIC DISCLAIMER                              */}
      {/* =================================================================== */}
      <footer className="emergency-footer">
        <p className="emergency-disclaimer">
          <strong>Important Citizen Disclaimer:</strong> Jaipur Bus Live provides
          verified directory links to official Rajasthan Government and national
          emergency helplines. Telephone dialing functionality depends on your mobile
          carrier service. In life-threatening emergencies, always dial 112 directly.
        </p>
        <p>© {new Date().getFullYear()} Jaipur Bus Live — Public Transport & Civic Transit Safety</p>

        <div className="emergency-footer-actions">
          {onBackToBus && (
            <button
              type="button"
              onClick={onBackToBus}
              className="emergency-footer-btn"
            >
              <span>🚌 Return to Live Bus Tracking</span>
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
