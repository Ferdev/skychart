import assert from "node:assert/strict";
import type { Body } from "../src/atlas/contracts.ts";
import { positionExoplanet } from "../src/catalog/exoplanetOrbit.ts";
import { AU_KM } from "../src/universe/universeBodyGeometry.ts";
import { isOrbitPlanet, universeOrbitForBody, universeOrbits } from "../src/universe/universeOrbits.ts";

const JULIAN_DAY_UNIX_EPOCH = 2_440_587.5;
const REFERENCE_JD = 2_460_000.5;
const SEMI_MAJOR_AXIS_AU = 0.03;
const HOST = { x: 2_484_666.230151709, y: -631_632.1129646321, z: 28_182.948355498374 };

const circularFacts = {
  orbit_display_state: "position",
  semi_major_axis_au: SEMI_MAJOR_AXIS_AU,
  period_days: 6.1,
  ephemeris_reference_type: "conjunction",
  ephemeris_reference_time_jd: REFERENCE_JD,
  ephemeris_period_days: 6.1,
  ephemeris_time_system: "BJD-UTC",
};

function timestampAt(julianDay: number): string {
  return new Date((julianDay - JULIAN_DAY_UNIX_EPOCH) * 86_400_000).toISOString();
}

function planetBody(): Body {
  return {
    key: "exoplanet-fixture-b",
    name: "Fixture b",
    object_type: "planet",
    catalog_group: "exoplanets",
    parent_key: "exosys-fixture",
    radius_km: 6_371,
    color: "#89d6ff",
    catalog: { facts: circularFacts, position_model: "exoplanet_archive_host_relative_orbit" },
    position: {
      x_au: HOST.x, y_au: HOST.y, z_au: HOST.z,
      x_km: HOST.x * AU_KM, y_km: HOST.y * AU_KM, z_km: HOST.z * AU_KM,
      heliocentric_distance_km: Math.hypot(HOST.x, HOST.y, HOST.z) * AU_KM,
    },
    distance_from_earth_km: Math.hypot(HOST.x, HOST.y, HOST.z) * AU_KM,
  } as Body;
}

function solarPlanet(overrides: Partial<Body> = {}): Body {
  return {
    key: "earth",
    name: "Earth",
    object_type: "planet",
    parent_key: "sun",
    catalog_group: "core",
    position: {
      x_au: 1, y_au: 0, z_au: 0,
      x_km: AU_KM, y_km: 0, z_km: 0,
      heliocentric_distance_km: AU_KM,
    },
    distance_from_earth_km: 0,
    orbit: {
      central_body_key: "sun", central_body_name: "Sun",
      semi_major_axis_km: AU_KM,
      eccentricity: 0,
      inclination_deg: 0,
      longitude_of_ascending_node_deg: 0,
      argument_of_periapsis_deg: 0,
      true_anomaly_deg: 0,
      periapsis_km: AU_KM, apoapsis_km: AU_KM, orbital_period_days: 365.25, orbit_class: "planet",
    },
    ...overrides,
  } as Body;
}

const sun = {
  key: "sun", name: "Sun", object_type: "star", position: { x_au: 0, y_au: 0, z_au: 0 },
} as Body;

// A planet and a dwarf planet have an orbit; a moon and a star do not.
assert.equal(isOrbitPlanet(solarPlanet()), true);
assert.equal(isOrbitPlanet(solarPlanet({ object_type: "dwarf_planet" })), true);
assert.equal(isOrbitPlanet(solarPlanet({ object_type: "moon", catalog_group: "core" })), false);
assert.equal(isOrbitPlanet(sun), false);

// A circular equatorial orbit stays at one AU from the parent and closes.
const circular = universeOrbitForBody(solarPlanet(), sun);
assert.ok(circular);
assert.equal(circular.kind, "planet");
assert.equal(circular.points.length, 241);
for (const point of circular.points) {
  assert.ok(Math.abs(Math.hypot(point.x - 0, point.y - 0, point.z - 0) - 1) < 1e-9);
  assert.ok(Math.abs(point.z) < 1e-12);
}
const first = circular.points[0]!;
const last = circular.points[circular.points.length - 1]!;
assert.ok(Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) < 1e-9);

// The ring is placed at the parent body, so a satellite's ellipse is not at the Sun.
const parent = solarPlanet({ key: "parent", object_type: "star", position: {
  x_au: 5, y_au: -2, z_au: 1, x_km: 0, y_km: 0, z_km: 0, heliocentric_distance_km: 0,
} });
const satellite = universeOrbitForBody(solarPlanet({ key: "sat", orbit: {
  semi_major_axis_km: AU_KM, eccentricity: 0, inclination_deg: 0,
  longitude_of_ascending_node_deg: 0, argument_of_periapsis_deg: 0, true_anomaly_deg: 0,
} }), parent);
assert.ok(satellite);
const closedPoints = satellite.points.slice(0, -1);
const centerX = closedPoints.reduce((sum, point) => sum + point.x, 0) / closedPoints.length;
const centerY = closedPoints.reduce((sum, point) => sum + point.y, 0) / closedPoints.length;
assert.ok(Math.abs(centerX - 5) < 1e-9);
assert.ok(Math.abs(centerY + 2) < 1e-9);

// An inclined orbit leaves the ecliptic plane.
const inclined = universeOrbitForBody(solarPlanet({ orbit: {
  central_body_key: "sun", central_body_name: "Sun",
  semi_major_axis_km: AU_KM, eccentricity: 0, inclination_deg: 90,
  longitude_of_ascending_node_deg: 0, argument_of_periapsis_deg: 0, true_anomaly_deg: 0,
  periapsis_km: AU_KM, apoapsis_km: AU_KM, orbital_period_days: 365.25, orbit_class: "planet",
} }), sun);
assert.ok(inclined);
assert.ok(inclined.points.some((point) => Math.abs(point.z) > 0.5));

// A body without orbit facts has no ring.
assert.equal(universeOrbitForBody(solarPlanet({ orbit: null }), sun), null);

// An exoplanet ring is host-relative and uses the catalog orbit facts.
const positioned = positionExoplanet(planetBody(), timestampAt(REFERENCE_JD), AU_KM);
const exoplanet = universeOrbitForBody(positioned, null);
assert.ok(exoplanet);
assert.equal(exoplanet.kind, "exoplanet");
assert.equal(exoplanet.points.length, 241);
for (const point of exoplanet.points) {
  const offset = Math.hypot(point.x - HOST.x, point.y - HOST.y, point.z - HOST.z);
  assert.ok(Math.abs(offset - SEMI_MAJOR_AXIS_AU) < 1e-8);
}

// A candidate is a candidate ring, not a confirmed planet.
const candidate = universeOrbitForBody({ ...positioned, key: "toi-100-01",
  object_type: "planet_candidate", catalog_group: "exoplanet_candidates" } as Body, null);
assert.ok(candidate);
assert.equal(candidate.kind, "candidate");

// The collection skips bodies without a ring, such as a star.
const bodies = new Map<string, Body>([[sun.key, sun], [circular.key, solarPlanet()]]);
const all = universeOrbits(bodies.values(), bodies);
assert.deepEqual(all.map((orbit) => orbit.key), ["earth"]);

console.log("universe orbit tests passed");
