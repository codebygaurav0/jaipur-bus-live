const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanRouteCode,
  cleanText,
  resolveStop,
  resolveStopDetailed,
  findStopIndexInRoute,
  mapLiveBusesToRoute,
  findDirectRoutes,
  findConnectingJourneys,
  searchRoutesBetweenStops,
  canonicalBusStops,
  canonicalRoutes,
} = require("../routeSearchEngine");

test("Substring trap prevention: distinct transit features are never conflated", () => {
  // Sanganer vs Sanganeri Gate (11 km apart)
  const sanganer = resolveStop("SANGANER", canonicalBusStops);
  assert.ok(sanganer, "Sanganer should resolve");
  assert.equal(sanganer.bus_stop_name, "SANGANER");
  assert.notEqual(sanganer.bus_stop_name, "SANGANERI GATE");

  const sanganeriGate = resolveStop("SANGANERI GATE", canonicalBusStops);
  assert.ok(sanganeriGate, "Sanganeri Gate should resolve");
  assert.equal(sanganeriGate.bus_stop_name, "SANGANERI GATE");
  assert.notEqual(sanganeriGate.bus_stop_name, "SANGANER");

  // Chomu vs Chomu Puliya (30 km apart)
  const chomu = resolveStop("CHOMU", canonicalBusStops);
  assert.ok(chomu, "Chomu should resolve");
  assert.equal(chomu.bus_stop_name, "CHOMU");

  const chomuPuliya = resolveStop("CHOMU PULIYA", canonicalBusStops);
  assert.ok(chomuPuliya, "Chomu Puliya should resolve");
  assert.equal(chomuPuliya.bus_stop_name, "CHOMU PULIYA");

  // Tonk Road (does not exist in dataset) must NEVER match Tonk Phatak
  const tonkRoad = resolveStop("TONK ROAD", canonicalBusStops);
  assert.equal(tonkRoad, null, "TONK ROAD must not falsely resolve to TONK PHATAK");

  const tonkPhatak = resolveStop("TONK PHATAK", canonicalBusStops);
  assert.ok(tonkPhatak, "Tonk Phatak should resolve");
  assert.equal(tonkPhatak.bus_stop_name, "TONK PHATAK");

  // Sanganer Thana (police station synonym)
  const sanganerPolice = resolveStop("SANGANER POLICE STATION", canonicalBusStops);
  assert.ok(sanganerPolice, "Sanganer Police Station should resolve to Sanganer Thana");
  assert.equal(sanganerPolice.bus_stop_name, "SANGANER THANA");
});

test("Direct routes: every returned route serves both stops in strictly forward travel order", () => {
  const result = searchRoutesBetweenStops({
    from: "AJMERI GATE",
    to: "SANGANER THANA",
  });

  assert.equal(result.success, true);
  assert.equal(result.journey_type, "direct");
  assert.ok(result.count > 0, "Should find direct routes");
  assert.equal(result.routes.length, result.count);

  // Check every route
  result.routes.forEach((r) => {
    assert.equal(typeof r.route_orgno, "string");
    assert.equal(typeof r.route_name, "string");
    assert.ok(r.from_stop_index >= 0, "From index must be valid");
    assert.ok(r.to_stop_index > r.from_stop_index, "From index MUST be strictly less than To index");
    assert.equal(r.intermediate_stops_count, r.to_stop_index - r.from_stop_index + 1);
    assert.equal(r.traversal_stops.length, r.intermediate_stops_count);
    assert.equal(r.traversal_stops[0].name, r.from_stop_matched);
    assert.equal(r.traversal_stops[r.traversal_stops.length - 1].name, r.to_stop_matched);
  });

  // Route 487 (E-1A VKI to Transport Nagar) stops at SANGANERI GATE, NOT Sanganer Thana
  const hasRoute487 = result.routes.some((r) => r.route_id === "487");
  assert.equal(hasRoute487, false, "Route 487 must NOT be returned for Sanganer Thana");

  // South-to-North Route 67 (RENWAL TO AJMERI GATE) serves both but in reverse direction
  const hasRoute67 = result.routes.some((r) => r.route_id === "67");
  assert.equal(hasRoute67, false, "Opposite direction Route 67 must NOT be returned");
});

test("Reversed direction rejection: queries in reverse return only reverse routes", () => {
  const northResult = searchRoutesBetweenStops({
    from: "SANGANER THANA",
    to: "AJMERI GATE",
  });

  assert.equal(northResult.success, true);
  assert.equal(northResult.journey_type, "direct");
  assert.ok(northResult.count > 0, "Should find north-bound direct routes");

  // In every returned route, SANGANER THANA comes before AJMERI GATE
  northResult.routes.forEach((r) => {
    assert.ok(
      r.from_stop_index < r.to_stop_index,
      `Route ${r.route_orgno} must have fromIdx (${r.from_stop_index}) < toIdx (${r.to_stop_index})`
    );
  });

  // Must include North-bound Route 67 (RENWAL TO AJMERI GATE)
  const hasRoute67 = northResult.routes.some((r) => r.route_id === "67");
  assert.equal(hasRoute67, true, "North-bound Route 67 must be returned");

  // Must reject South-bound Route 79 (AJMERI GATE TO RENWAL)
  const hasRoute79 = northResult.routes.some((r) => r.route_id === "79");
  assert.equal(hasRoute79, false, "South-bound Route 79 must NOT be returned for reverse journey");
});

test("Unrelated destination-only routes are never returned", () => {
  // Synthetic test with isolated routes
  const mockRoutes = [
    {
      route_id: "101",
      route_orgno: "TEST-1",
      route_name: "A to B",
      stops: [
        { name: "STOP A", latitude: 26.9, longitude: 75.8 },
        { name: "STOP B", latitude: 26.91, longitude: 75.81 },
      ],
    },
    {
      route_id: "102",
      route_orgno: "TEST-2",
      route_name: "B to C (Destination only)",
      stops: [
        { name: "STOP B", latitude: 26.91, longitude: 75.81 },
        { name: "STOP C", latitude: 26.92, longitude: 75.82 },
      ],
    },
  ];

  const origin = { bus_stop_name: "STOP A", latitude: 26.9, longitude: 75.8 };
  const dest = { bus_stop_name: "STOP C", latitude: 26.92, longitude: 75.82 };

  const direct = findDirectRoutes(origin, dest, mockRoutes, []);
  assert.equal(direct.length, 0, "Should find 0 direct routes from A to C");

  // Connecting route from A to C via B
  const connecting = findConnectingJourneys(origin, dest, mockRoutes, []);
  assert.equal(connecting.length, 1, "Should find exactly 1 connecting journey via STOP B");
  assert.equal(connecting[0].transfer_stop.name, "STOP B");
  assert.equal(connecting[0].leg1.route_id, "101");
  assert.equal(connecting[0].leg2.route_id, "102");
});

test("Connecting journeys: returns verified 1-transfer journey when no direct route exists", () => {
  // VKI NO. 17 to CHAKSU has 0 direct routes
  const result = searchRoutesBetweenStops({
    from: "VKI NO. 17",
    to: "CHAKSU",
  });

  assert.equal(result.success, true);
  assert.equal(result.journey_type, "connecting");
  assert.equal(result.routes.length, 0);
  assert.ok(result.connecting_journeys.length > 0, "Should return connecting journeys");

  const c = result.connecting_journeys[0];
  assert.equal(c.is_connecting, true);
  assert.equal(typeof c.transfer_stop.name, "string");
  assert.equal(c.transfer_stop.name, "AJMERI GATE");

  // Leg 1: VKI NO. 17 -> AJMERI GATE
  assert.equal(c.leg1.from_stop, "VKI NO. 17");
  assert.equal(c.leg1.transfer_stop, "AJMERI GATE");
  assert.ok(c.leg1.from_stop_index < c.leg1.transfer_stop_index);
  assert.ok(c.leg1.intermediate_stops_count > 1);

  // Leg 2: AJMERI GATE -> CHAKSU
  assert.equal(c.leg2.transfer_stop, "AJMERI GATE");
  assert.equal(c.leg2.to_stop, "CHAKSU");
  assert.ok(c.leg2.transfer_stop_index < c.leg2.to_stop_index);
  assert.ok(c.leg2.intermediate_stops_count > 1);

  // Total stops
  assert.equal(c.total_stops_count, c.leg1.intermediate_stops_count + c.leg2.intermediate_stops_count - 1);
});

test("Connecting journeys: KUKAS to WATIKA returns verified interchange via AJMERI GATE", () => {
  const result = searchRoutesBetweenStops({
    from: "KUKAS",
    to: "WATIKA",
  });

  assert.equal(result.success, true);
  assert.equal(result.journey_type, "connecting");
  assert.ok(result.connecting_journeys.length > 0);

  const c = result.connecting_journeys[0];
  assert.equal(c.transfer_stop.name, "AJMERI GATE");
  assert.equal(c.leg1.from_stop, "KUKAS");
  assert.equal(c.leg1.transfer_stop, "AJMERI GATE");
  assert.equal(c.leg2.transfer_stop, "AJMERI GATE");
  assert.equal(c.leg2.to_stop, "WATIKA");
});

test("Direct routes: AMBA BARI to JAGATPURA PHATAK correctly identifies direct Route AC7", () => {
  const result = searchRoutesBetweenStops({
    from: "AMBA BARI",
    to: "JAGATPURA PHATAK",
  });

  assert.equal(result.success, true);
  assert.equal(result.journey_type, "direct");
  assert.ok(result.count > 0);
  assert.ok(result.routes.some((r) => r.route_orgno === "AC7"));
});

test("Missing data and invalid stops are handled honestly without fabricating routes", () => {
  // Non-existent origin stop
  const res1 = searchRoutesBetweenStops({
    from: "NON_EXISTENT_ORIGIN_XYZ",
    to: "AJMERI GATE",
  });
  assert.equal(res1.success, false);
  assert.equal(res1.journey_type, "none");
  assert.equal(res1.count, 0);
  assert.equal(res1.routes.length, 0);
  assert.match(res1.message, /Could not resolve origin "NON_EXISTENT_ORIGIN_XYZ"/);

  // Non-existent destination stop
  const res2 = searchRoutesBetweenStops({
    from: "AJMERI GATE",
    to: "NON_EXISTENT_DEST_XYZ",
  });
  assert.equal(res2.success, false);
  assert.match(res2.message, /Could not resolve destination "NON_EXISTENT_DEST_XYZ"/);

  // Empty queries
  const res3 = searchRoutesBetweenStops({ from: "", to: "" });
  assert.equal(res3.success, false);
  assert.equal(res3.message, "Both from and to stops are required");
});

test("Live vehicle mapping: associates real vehicle registrations and reports 0 honestly", () => {
  const mockLiveBuses = [
    {
      vehno: "RJ14PD7829",
      rno: "11",
      curlat: "26.8865",
      curlong: "75.7326",
      speed: 18.5,
      movementState: "MOVING",
      telemetryStatus: "LIVE · MOVING",
    },
    {
      vehno: "RJ14PE5909",
      rno: "11",
      curlat: "26.8192",
      curlong: "75.7963",
      speed: 0,
      movementState: "STOPPED",
      telemetryStatus: "LIVE · STOPPED",
    },
    {
      vehno: "RJ14PA1111",
      rno: "99X", // Unrelated route
      curlat: "26.9",
      curlong: "75.8",
      speed: 25,
      movementState: "MOVING",
      telemetryStatus: "LIVE · MOVING",
    },
  ];

  // Route 11 should match RJ14PD7829 and RJ14PE5909
  const matched11 = mapLiveBusesToRoute("11", mockLiveBuses);
  assert.equal(matched11.length, 2);
  assert.equal(matched11[0].vehicle_number, "RJ14PD7829");
  assert.equal(matched11[0].speed, 18.5);
  assert.equal(matched11[0].movementState, "MOVING");
  assert.equal(matched11[1].vehicle_number, "RJ14PE5909");
  assert.equal(matched11[1].movementState, "STOPPED");

  // Route 16 has 0 buses in mockLiveBuses
  const matched16 = mapLiveBusesToRoute("16", mockLiveBuses);
  assert.equal(matched16.length, 0, "Route 16 must have 0 buses");

  // Test full search with mock live buses attached
  const searchResult = searchRoutesBetweenStops({
    from: "AJMERI GATE",
    to: "SANGANER THANA",
    filterRoute: "11",
    liveBuses: mockLiveBuses,
  });

  assert.equal(searchResult.success, true);
  assert.equal(searchResult.count, 1);
  const route11 = searchResult.routes[0];
  assert.equal(route11.route_orgno, "11");
  assert.equal(route11.live_buses_count, 2);
  assert.equal(route11.live_buses[0].vehicle_number, "RJ14PD7829");
  assert.equal(route11.live_buses[1].vehicle_number, "RJ14PE5909");
});

test("Stop lookup accepts exact IDs and codes but reports duplicate names as ambiguous", () => {
  const stops = [
    { bus_stop_id: "1", bus_stop_code: "ONE", bus_stop_name: "CENTRAL MARKET", latitude: 26.9, longitude: 75.8 },
    { bus_stop_id: "2", bus_stop_code: "TWO", bus_stop_name: "CENTRAL MARKET", latitude: 26.91, longitude: 75.81 },
  ];

  assert.equal(resolveStop("ONE", stops).bus_stop_id, "1");
  assert.equal(resolveStop("2", stops).bus_stop_id, "2");
  assert.equal(resolveStop({ bus_stop_code: "TWO" }, stops).bus_stop_id, "2");
  assert.equal(resolveStop("CENTRAL MARKET", stops), null);
  assert.equal(resolveStopDetailed("CENTRAL MARKET", stops).ambiguous, true);

  const result = searchRoutesBetweenStops({
    from: "CENTRAL MARKET",
    to: "ONE",
    allStops: stops,
    allRoutes: [],
  });
  assert.equal(result.success, false);
  assert.equal(result.ambiguous, true);
  assert.equal(result.from_stop_candidates.length, 2);
});

test("Direct search selects a valid later occurrence when a route repeats a stop", () => {
  const route = {
    route_id: "DUP-1",
    route_orgno: "DUP-1",
    route_name: "Repeated stop test",
    stops: [
      { name: "DESTINATION", latitude: 26.9, longitude: 75.8 },
      { name: "ORIGIN", latitude: 26.91, longitude: 75.81 },
      { name: "DESTINATION", latitude: 26.9, longitude: 75.8 },
      { name: "ORIGIN", latitude: 26.91, longitude: 75.81 },
      { name: "DESTINATION", latitude: 26.9, longitude: 75.8 },
    ],
  };
  const result = findDirectRoutes(
    { bus_stop_name: "ORIGIN", latitude: 26.91, longitude: 75.81 },
    { bus_stop_name: "DESTINATION", latitude: 26.9, longitude: 75.8 },
    [route]
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].from_stop_index, 1);
  assert.equal(result[0].to_stop_index, 2);
  assert.deepEqual(result[0].traversal_stops.map((stop) => stop.name), [
    "ORIGIN",
    "DESTINATION",
  ]);
});

test("Connecting routes require the same physical stop and respect route filters", () => {
  const routeA = {
    route_id: "1",
    route_orgno: "A",
    route_name: "Origin to hub",
    stops: [
      { name: "ORIGIN", latitude: 26.9, longitude: 75.8 },
      { name: "COMMON HUB", latitude: 26.91, longitude: 75.81 },
    ],
  };
  const routeB = {
    route_id: "2",
    route_orgno: "B",
    route_name: "Hub to destination",
    stops: [
      { name: "COMMON HUB", latitude: 26.9101, longitude: 75.8101 },
      { name: "DESTINATION", latitude: 26.92, longitude: 75.82 },
    ],
  };
  const routeWithDifferentHub = {
    ...routeB,
    route_id: "3",
    route_orgno: "C",
    stops: [
      { name: "COMMON HUB", latitude: 27.1, longitude: 75.8 },
      { name: "DESTINATION", latitude: 26.92, longitude: 75.82 },
    ],
  };
  const allStops = [
    { bus_stop_id: "o", bus_stop_name: "ORIGIN", latitude: 26.9, longitude: 75.8 },
    { bus_stop_id: "d", bus_stop_name: "DESTINATION", latitude: 26.92, longitude: 75.82 },
  ];

  const filtered = searchRoutesBetweenStops({
    from: "ORIGIN",
    to: "DESTINATION",
    allStops,
    allRoutes: [routeA, routeB, routeWithDifferentHub],
    filterRoute: "A",
  });
  assert.equal(filtered.journey_type, "connecting");
  assert.ok(filtered.connecting_journeys.every((journey) =>
    journey.leg1.route_orgno === "A" || journey.leg2.route_orgno === "A"
  ));
  assert.ok(filtered.connecting_journeys.every((journey) =>
    journey.leg2.route_orgno === "B"
  ));

  const unrelatedFilter = searchRoutesBetweenStops({
    from: "ORIGIN",
    to: "DESTINATION",
    allStops,
    allRoutes: [routeA, routeB],
    filterRoute: "UNRELATED",
  });
  assert.equal(unrelatedFilter.journey_type, "none");

  const disconnected = searchRoutesBetweenStops({
    from: "ORIGIN",
    to: "DESTINATION",
    allStops,
    allRoutes: [routeA, routeWithDifferentHub],
  });
  assert.equal(disconnected.journey_type, "none");
});
