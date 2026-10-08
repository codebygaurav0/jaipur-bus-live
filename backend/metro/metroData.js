/**
 * Official Jaipur Metro Rail Corporation (JMRC) Pink Line Dataset
 * Source: Official JMRC Gazette, Portal & GIS Surveys
 * Phase 1A & Phase 1B (Mansarovar to Badi Chaupar)
 *
 * NOTE: JMRC operates on a closed signaling network without public real-time
 * train GPS telemetry feeds. Live GPS is explicitly flagged as unavailable.
 */

const JMRC_PINK_LINE = {
  line_id: "pink-line",
  line_name: "Pink Line (Phase 1A & 1B)",
  line_color: "#E11D48", // Pink/Rose branding
  corridor: "East-West Corridor",
  terminus_west: "Mansarovar",
  terminus_east: "Badi Chaupar",
  total_stations: 11,
  route_length_km: 11.97,
  operational_status: "Operational",
  first_train_dep: "06:20 AM",
  last_train_dep: "09:50 PM",
  peak_frequency_mins: "10-12",
  offpeak_frequency_mins: "15",
  total_travel_time_mins: 34,
  helpline: "0141-2822171",
  operator: "Jaipur Metro Rail Corporation (JMRC)",
  official_website: "https://transport.rajasthan.gov.in/jmrc",
  live_telemetry_available: false,
  live_telemetry_message:
    "Real-time GPS telemetry is restricted to JMRC internal signaling (Live train GPS broadcast unavailable)",
};

// All 11 verified operational stations with official geographic coordinates
const METRO_STATIONS = [
  {
    station_id: "JMR-01",
    code: "MSVR",
    name: "Mansarovar",
    hindi_name: "मानसरोवर",
    order: 1,
    structure: "Elevated",
    latitude: 26.879531,
    longitude: 75.749971,
    distance_km: 0.0,
    travel_time_from_origin_mins: 0,
    interchange: "None (Depot & Western Terminal)",
    facilities: ["Parking", "Ticket Vending", "Lifts / Escalators", "First Aid"],
    first_train: {
      towards_badi_chaupar: "06:20 AM",
      towards_mansarovar: "Terminus",
    },
    last_train: {
      towards_badi_chaupar: "09:50 PM",
      towards_mansarovar: "Terminus",
    },
  },
  {
    station_id: "JMR-02",
    code: "NATM",
    name: "New Aatish Market",
    hindi_name: "न्यू आतिश मार्केट",
    order: 2,
    structure: "Elevated",
    latitude: 26.880308,
    longitude: 75.764602,
    distance_km: 1.45,
    travel_time_from_origin_mins: 3,
    interchange: "None",
    facilities: ["Ticket Counter", "Lifts / Escalators", "Accessible Ramps"],
    first_train: {
      towards_badi_chaupar: "06:23 AM",
      towards_mansarovar: "06:47 AM",
    },
    last_train: {
      towards_badi_chaupar: "09:53 PM",
      towards_mansarovar: "10:17 PM",
    },
  },
  {
    station_id: "JMR-03",
    code: "VKVR",
    name: "Vivek Vihar",
    hindi_name: "विवेक विहार",
    order: 3,
    structure: "Elevated",
    latitude: 26.888952,
    longitude: 75.768499,
    distance_km: 2.56,
    travel_time_from_origin_mins: 6,
    interchange: "None",
    facilities: ["Ticket Counter", "Lifts / Escalators", "First Aid"],
    first_train: {
      towards_badi_chaupar: "06:26 AM",
      towards_mansarovar: "06:44 AM",
    },
    last_train: {
      towards_badi_chaupar: "09:56 PM",
      towards_mansarovar: "10:14 PM",
    },
  },
  {
    station_id: "JMR-04",
    code: "SMNR",
    name: "Shyam Nagar",
    hindi_name: "श्याम नगर",
    order: 4,
    structure: "Elevated",
    latitude: 26.89665,
    longitude: 75.770667,
    distance_km: 3.44,
    travel_time_from_origin_mins: 9,
    interchange: "None",
    facilities: ["Ticket Counter", "Lifts / Escalators"],
    first_train: {
      towards_badi_chaupar: "06:29 AM",
      towards_mansarovar: "06:41 AM",
    },
    last_train: {
      towards_badi_chaupar: "09:59 PM",
      towards_mansarovar: "10:11 PM",
    },
  },
  {
    station_id: "JMR-05",
    code: "RMNR",
    name: "Ram Nagar",
    hindi_name: "राम नगर",
    order: 5,
    structure: "Elevated",
    latitude: 26.901944,
    longitude: 75.774652,
    distance_km: 4.19,
    travel_time_from_origin_mins: 12,
    interchange: "None",
    facilities: ["Ticket Counter", "Lifts / Escalators", "Wheelchair Friendly"],
    first_train: {
      towards_badi_chaupar: "06:32 AM",
      towards_mansarovar: "06:38 AM",
    },
    last_train: {
      towards_badi_chaupar: "10:02 PM",
      towards_mansarovar: "10:08 PM",
    },
  },
  {
    station_id: "JMR-06",
    code: "CVLN",
    name: "Civil Lines",
    hindi_name: "सिविल लाइन्स",
    order: 6,
    structure: "Elevated",
    latitude: 26.909585,
    longitude: 75.781277,
    distance_km: 5.27,
    travel_time_from_origin_mins: 16,
    interchange: "None",
    facilities: ["Ticket Counter", "Lifts / Escalators", "First Aid"],
    first_train: {
      towards_badi_chaupar: "06:36 AM",
      towards_mansarovar: "06:34 AM",
    },
    last_train: {
      towards_badi_chaupar: "10:06 PM",
      towards_mansarovar: "10:04 PM",
    },
  },
  {
    station_id: "JMR-07",
    code: "RLST",
    name: "Railway Station",
    hindi_name: "रेलवे स्टेशन",
    order: 7,
    structure: "Elevated",
    latitude: 26.918559,
    longitude: 75.789903,
    distance_km: 6.86,
    travel_time_from_origin_mins: 20,
    interchange: "Jaipur Junction Railway Station (Indian Railways)",
    facilities: [
      "Direct FOB to Railway Station",
      "Ticket Counter",
      "Luggage Scanners",
      "Lifts / Escalators",
    ],
    first_train: {
      towards_badi_chaupar: "06:40 AM",
      towards_mansarovar: "06:30 AM",
    },
    last_train: {
      towards_badi_chaupar: "10:10 PM",
      towards_mansarovar: "10:00 PM",
    },
  },
  {
    station_id: "JMR-08",
    code: "SDCP",
    name: "Sindhi Camp",
    hindi_name: "सिन्धी कैंप",
    order: 8,
    structure: "Elevated",
    latitude: 26.922563,
    longitude: 75.799747,
    distance_km: 8.2,
    travel_time_from_origin_mins: 24,
    interchange:
      "Sindhi Camp Central Bus Stand (ISBT) / Proposed Orange Line Interchange",
    facilities: [
      "Direct Access to Bus Terminal",
      "Ticket Counter",
      "Parking",
      "Lifts / Escalators",
    ],
    first_train: {
      towards_badi_chaupar: "06:44 AM",
      towards_mansarovar: "06:26 AM",
    },
    last_train: {
      towards_badi_chaupar: "10:14 PM",
      towards_mansarovar: "09:56 PM",
    },
  },
  {
    station_id: "JMR-09",
    code: "CDPL",
    name: "Chandpole",
    hindi_name: "चाँदपोल",
    order: 9,
    structure: "Underground",
    latitude: 26.92637,
    longitude: 75.807456,
    distance_km: 8.98,
    travel_time_from_origin_mins: 27,
    interchange: "None (Old Walled City Entry)",
    facilities: [
      "Underground Concourse",
      "Full Air Conditioning",
      "Lifts / Escalators",
      "Restrooms",
    ],
    first_train: {
      towards_badi_chaupar: "06:47 AM",
      towards_mansarovar: "06:23 AM",
    },
    last_train: {
      towards_badi_chaupar: "10:17 PM",
      towards_mansarovar: "09:53 PM",
    },
  },
  {
    station_id: "JMR-10",
    code: "CTCP",
    name: "Chhoti Chaupar",
    hindi_name: "छोटी चौपड़",
    order: 10,
    structure: "Underground",
    latitude: 26.92462,
    longitude: 75.818418,
    distance_km: 10.2,
    travel_time_from_origin_mins: 31,
    interchange: "None (Heritage Gallery inside station)",
    facilities: [
      "Underground Concourse",
      "Heritage Display Area",
      "Full Air Conditioning",
      "Lifts / Escalators",
    ],
    first_train: {
      towards_badi_chaupar: "06:51 AM",
      towards_mansarovar: "06:20 AM",
    },
    last_train: {
      towards_badi_chaupar: "10:21 PM",
      towards_mansarovar: "09:50 PM",
    },
  },
  {
    station_id: "JMR-11",
    code: "BDCP",
    name: "Badi Chaupar",
    hindi_name: "बड़ी चौपड़",
    order: 11,
    structure: "Underground",
    latitude: 26.922922,
    longitude: 75.826834,
    distance_km: 11.05,
    travel_time_from_origin_mins: 34,
    interchange: "None (Hawa Mahal, Jantar Mantar, City Palace)",
    facilities: [
      "Underground Concourse",
      "Heritage Gallery",
      "Full Air Conditioning",
      "Lifts / Escalators",
      "Tourist Information",
    ],
    first_train: {
      towards_badi_chaupar: "Terminus",
      towards_mansarovar: "06:20 AM",
    },
    last_train: {
      towards_badi_chaupar: "Terminus",
      towards_mansarovar: "09:50 PM",
    },
  },
];

// Official JMRC Station-count Fare Slab Matrix
function calculateJmrcFare(stationCount) {
  if (stationCount <= 0) return { token_fare: 0, smart_card_fare: 0 };
  if (stationCount <= 2) return { token_fare: 6, smart_card_fare: 5.4 };
  if (stationCount <= 5) return { token_fare: 12, smart_card_fare: 10.8 };
  if (stationCount <= 8) return { token_fare: 18, smart_card_fare: 16.2 };
  return { token_fare: 22, smart_card_fare: 19.8 };
}

module.exports = {
  JMRC_PINK_LINE,
  METRO_STATIONS,
  calculateJmrcFare,
};

