/**
 * Metro API Routes for Jaipur Metro (JMRC)
 * Mounted at /api/metro
 */

const express = require("express");
const router = express.Router();
const {
  getLines,
  getStations,
  getStationById,
  planJourney,
} = require("./metroService");
const { JMRC_PINK_LINE } = require("./metroData");

// 1. Operational status
router.get("/status", (req, res) => {
  res.json({
    success: true,
    metro_system: "Jaipur Metro Rail Corporation (JMRC)",
    corridor: JMRC_PINK_LINE.corridor,
    operational_status: JMRC_PINK_LINE.operational_status,
    operating_hours: `${JMRC_PINK_LINE.first_train_dep} - ${JMRC_PINK_LINE.last_train_dep}`,
    peak_frequency: `${JMRC_PINK_LINE.peak_frequency_mins} mins`,
    live_telemetry_available: false,
    live_telemetry_message: JMRC_PINK_LINE.live_telemetry_message,
    helpline: JMRC_PINK_LINE.helpline,
  });
});

// 2. Metro lines
router.get("/lines", (req, res) => {
  const data = getLines();
  res.json(data);
});

// 3. Metro stations (all or filtered)
router.get("/stations", (req, res) => {
  const query = req.query.q || req.query.query || "";
  const data = getStations(query);
  res.json(data);
});

// 4. Station details by ID or code
router.get("/stations/:id", (req, res) => {
  const station = getStationById(req.params.id);
  if (!station) {
    return res.status(404).json({
      success: false,
      message: `Metro station '${req.params.id}' not found.`,
    });
  }
  res.json({
    success: true,
    station,
  });
});

// 5. Journey planner between stations
const handleJourney = (req, res) => {
  const from = req.query.from || req.body?.from || req.body?.from_station;
  const to = req.query.to || req.body?.to || req.body?.to_station;

  if (!from || !to) {
    return res.status(400).json({
      success: false,
      message: "Both origin ('from') and destination ('to') stations are required.",
    });
  }

  const result = planJourney(from, to);
  if (!result.success) {
    return res.status(400).json(result);
  }

  res.json(result);
};

router.get("/journey", handleJourney);
router.post("/journey", handleJourney);

module.exports = router;

