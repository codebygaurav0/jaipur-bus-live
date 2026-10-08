/**
 * Metro Service for Jaipur Metro (JMRC)
 * Handles station lookups, line queries, and journey planning.
 */

const {
  JMRC_PINK_LINE,
  METRO_STATIONS,
  calculateJmrcFare,
} = require("./metroData");

const cleanStr = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");

function getLines() {
  return {
    success: true,
    total_lines: 1,
    lines: [
      {
        ...JMRC_PINK_LINE,
        stations: METRO_STATIONS.map((s) => ({
          station_id: s.station_id,
          code: s.code,
          name: s.name,
          hindi_name: s.hindi_name,
          order: s.order,
          structure: s.structure,
          latitude: s.latitude,
          longitude: s.longitude,
        })),
      },
    ],
  };
}

function getStations(query = "") {
  const q = cleanStr(query);
  let stations = METRO_STATIONS;

  if (q) {
    stations = METRO_STATIONS.filter((s) => {
      const sName = cleanStr(s.name);
      const sCode = cleanStr(s.code);
      const sHindi = cleanStr(s.hindi_name);
      return (
        sName.includes(q) ||
        sCode.includes(q) ||
        sHindi.includes(q) ||
        q.includes(sName)
      );
    });
  }

  return {
    success: true,
    total_stations: stations.length,
    stations,
  };
}

function getStationById(identifier) {
  if (!identifier) return null;
  const q = cleanStr(identifier);
  const qRaw = String(identifier).trim().toUpperCase();

  const station = METRO_STATIONS.find(
    (s) =>
      s.station_id === qRaw ||
      s.code === qRaw ||
      cleanStr(s.name) === q ||
      cleanStr(s.hindi_name) === q
  );

  return station || null;
}

function planJourney(fromIdentifier, toIdentifier) {
  const fromStation = getStationById(fromIdentifier);
  const toStation = getStationById(toIdentifier);

  if (!fromStation || !toStation) {
    return {
      success: false,
      message: "Both origin and destination stations must be valid Jaipur Metro stations.",
      from_station: fromStation,
      to_station: toStation,
    };
  }

  if (fromStation.station_id === toStation.station_id) {
    return {
      success: false,
      message: "Origin and destination stations cannot be the same.",
      from_station: fromStation,
      to_station: toStation,
    };
  }

  const isEastbound = fromStation.order < toStation.order;
  const directionName = isEastbound
    ? "Towards Badi Chaupar"
    : "Towards Mansarovar";
  const terminusName = isEastbound ? "Badi Chaupar" : "Mansarovar";

  // Slice stations between origin and destination in correct travel direction
  let journeyStations = [];
  if (isEastbound) {
    journeyStations = METRO_STATIONS.slice(
      fromStation.order - 1,
      toStation.order
    );
  } else {
    journeyStations = METRO_STATIONS.slice(
      toStation.order - 1,
      fromStation.order
    ).reverse();
  }

  const stationHops = Math.abs(toStation.order - fromStation.order);
  const fare = calculateJmrcFare(stationHops);

  // Time difference in minutes
  const estimatedTimeMins = Math.abs(
    toStation.travel_time_from_origin_mins -
      fromStation.travel_time_from_origin_mins
  );

  // Approximate distance traversed
  const distanceKm = Math.abs(toStation.distance_km - fromStation.distance_km);

  return {
    success: true,
    line: {
      line_id: JMRC_PINK_LINE.line_id,
      line_name: JMRC_PINK_LINE.line_name,
      line_color: JMRC_PINK_LINE.line_color,
    },
    direction: directionName,
    terminus: terminusName,
    from_station: fromStation,
    to_station: toStation,
    total_stops: journeyStations.length,
    station_hops: stationHops,
    distance_km: parseFloat(distanceKm.toFixed(2)),
    estimated_travel_time_mins: estimatedTimeMins,
    fare: {
      token_fare: fare.token_fare,
      smart_card_fare: fare.smart_card_fare,
      currency: "INR",
      note: "10% discount on JMRC Smart Card / Metro Pass",
    },
    operating_hours: {
      first_train: isEastbound
        ? fromStation.first_train.towards_badi_chaupar
        : fromStation.first_train.towards_mansarovar,
      last_train: isEastbound
        ? fromStation.last_train.towards_badi_chaupar
        : fromStation.last_train.towards_mansarovar,
      frequency_mins: JMRC_PINK_LINE.peak_frequency_mins,
    },
    stations: journeyStations,
    live_telemetry_available: false,
    live_telemetry_notice:
      "Real-time GPS telemetry is restricted to JMRC internal signaling (Live train GPS broadcast unavailable)",
  };
}

module.exports = {
  getLines,
  getStations,
  getStationById,
  planJourney,
};

