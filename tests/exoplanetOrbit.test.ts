import assert from "node:assert/strict";
import {
  ASSUMED_INCLINATION_DEG,
  DYNAMICAL_TIME_MINUS_UTC_SECONDS,
  HOLLOW_MARKER_PHASE_UNCERTAINTY_ORBITS,
  MAX_MARKER_PHASE_UNCERTAINTY_ORBITS,
  exoplanetOffsetAu,
  exoplanetOrbitPathAu,
  exoplanetOrbitReachAu,
  exoplanetOrbitRingAu,
  exoplanetOrbitStateAt,
  exoplanetUncertaintyPathAu,
  hasResolvedExoplanetMarker,
  hostFrame,
  isExoplanetOrbitResolved,
  positionExoplanet,
  readExoplanetOrbit,
  type Vector3,
} from "../src/catalog/exoplanetOrbit.ts";
import { packRichPoints, richLayerOrigin } from "../src/rendering/richPointLayer.ts";
import { EXOPLANET_TRANSLATION_KEYS, EXOPLANET_TRANSLATIONS } from "../src/catalog/exoplanetTranslations.ts";
import type { Body } from "../src/atlas/contracts.ts";

const AU_KM = 149_597_870.7;
const JULIAN_DAY_UNIX_EPOCH = 2_440_587.5;
const TRAPPIST_HOST: Vector3 = { x: 2_484_666.230151709, y: -631_632.1129646321, z: 28_182.948355498374 };
const PERIOD_DAYS = 6.1;
const SEMI_MAJOR_AXIS_AU = 0.03;
// A reference time in UTC keeps the fixtures free of the TDB offset.
const REFERENCE_JD = 2_460_000.5;

const circularFacts = {
  orbit_display_state: "position",
  semi_major_axis_au: SEMI_MAJOR_AXIS_AU,
  period_days: PERIOD_DAYS,
  ephemeris_reference_type: "conjunction",
  ephemeris_reference_time_jd: REFERENCE_JD,
  ephemeris_reference_time_jd_err_plus: 0.0002,
  ephemeris_reference_time_jd_err_minus: 0.0001,
  ephemeris_period_days: PERIOD_DAYS,
  ephemeris_period_days_err_plus: 0.00001,
  ephemeris_period_days_err_minus: 0.00002,
  ephemeris_time_system: "BJD-UTC",
};

function timestampAt(julianDay: number): string {
  return new Date((julianDay - JULIAN_DAY_UNIX_EPOCH) * 86_400_000).toISOString();
}

function dot(left: Vector3, right: Vector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function length(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function offsetAt(facts: Record<string, unknown>, julianDay: number, host = TRAPPIST_HOST) {
  const elements = readExoplanetOrbit(facts);
  assert.ok(elements);
  const frame = hostFrame(host);
  const state = exoplanetOrbitStateAt(elements, timestampAt(julianDay));
  return { elements, frame, state, offset: exoplanetOffsetAu(elements, frame, state) };
}

function planet(facts: Record<string, unknown>, host = TRAPPIST_HOST): Body {
  return {
    key: "exoplanet-fixture-b",
    name: "Fixture b",
    object_type: "planet",
    catalog_group: "exoplanets",
    parent_key: "exosys-fixture",
    radius_km: 6_371,
    color: "#89d6ff",
    catalog: { facts, position_model: "exoplanet_archive_host_relative_orbit" },
    position: {
      x_au: host.x, y_au: host.y, z_au: host.z,
      x_km: host.x * AU_KM, y_km: host.y * AU_KM, z_km: host.z * AU_KM,
      heliocentric_distance_km: length(host) * AU_KM,
    },
    distance_from_earth_km: length(host) * AU_KM,
  } as Body;
}

{
  // The frame is orthonormal; the node is parallel to the ecliptic plane and
  // at 90 degrees to the line of sight.
  const frame = hostFrame(TRAPPIST_HOST);
  for (const axis of [frame.n, frame.m, frame.s]) assert.ok(Math.abs(length(axis) - 1) < 1e-12);
  assert.ok(Math.abs(dot(frame.n, frame.s)) < 1e-12);
  assert.ok(Math.abs(dot(frame.n, frame.m)) < 1e-12);
  assert.ok(Math.abs(dot(frame.m, frame.s)) < 1e-12);
  assert.equal(Math.abs(frame.n.z), 0);
  assert.ok(Math.abs(frame.s.x - TRAPPIST_HOST.x / length(TRAPPIST_HOST)) < 1e-12);

  // At an ecliptic pole the rule gives no direction, so the node is the x axis.
  const pole = hostFrame({ x: 0, y: 0, z: 500_000 });
  assert.ok(Math.abs(pole.n.x - 1) < 1e-12 && Math.abs(pole.n.y) < 1e-12 && Math.abs(pole.n.z) < 1e-12);
  assert.ok(Math.abs(dot(pole.n, pole.s)) < 1e-12);
  assert.ok(Math.abs(length(pole.m) - 1) < 1e-12);
}

{
  // 1. At the conjunction time the planet is on the line from the Sun to the
  // host, on the near side, at the orbit radius.
  const { elements, frame, state, offset } = offsetAt(circularFacts, REFERENCE_JD);
  assert.ok(offset);
  assert.equal(state.displayState, "position");
  assert.deepEqual(elements.conventions, ["node_angle", "edge_on_inclination", "circular_orbit"]);
  assert.ok(Math.abs(elements.inclinationRad - ASSUMED_INCLINATION_DEG * Math.PI / 180) < 1e-15);
  assert.ok(Math.abs(dot(offset, frame.s) + SEMI_MAJOR_AXIS_AU) < 1e-12);
  assert.ok(Math.abs(dot(offset, frame.n)) < 1e-12);
  assert.ok(Math.abs(dot(offset, frame.m)) < 1e-12);
  assert.ok(length({ x: TRAPPIST_HOST.x + offset.x, y: TRAPPIST_HOST.y + offset.y, z: TRAPPIST_HOST.z + offset.z }) < length(TRAPPIST_HOST));
}

{
  // 2. A quarter of a period later the depth is zero and the sky distance is
  // equal to the semi-major axis (circular orbit).
  const { frame, offset } = offsetAt(circularFacts, REFERENCE_JD + PERIOD_DAYS / 4);
  assert.ok(offset);
  assert.ok(Math.abs(dot(offset, frame.s)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(dot(offset, frame.n), dot(offset, frame.m)) - SEMI_MAJOR_AXIS_AU) < 1e-9);

  // Half a period after conjunction the planet is behind the star.
  const opposite = offsetAt(circularFacts, REFERENCE_JD + PERIOD_DAYS / 2);
  assert.ok(opposite.offset);
  assert.ok(Math.abs(dot(opposite.offset, opposite.frame.s) - SEMI_MAJOR_AXIS_AU) < 1e-9);
}

{
  // 3. After one period the position is the same.
  const first = offsetAt(circularFacts, REFERENCE_JD + 1.37).offset;
  const second = offsetAt(circularFacts, REFERENCE_JD + 1.37 + PERIOD_DAYS).offset;
  const before = offsetAt(circularFacts, REFERENCE_JD + 1.37 - 3 * PERIOD_DAYS).offset;
  assert.ok(first && second && before);
  assert.ok(length({ x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }) < 1e-9);
  assert.ok(length({ x: first.x - before.x, y: first.y - before.y, z: first.z - before.z }) < 1e-9);

  // One day moves the planet by one day's fraction of its period.
  const frame = hostFrame(TRAPPIST_HOST);
  const later = offsetAt(circularFacts, REFERENCE_JD + 1).offset;
  assert.ok(later);
  const start = offsetAt(circularFacts, REFERENCE_JD).offset;
  assert.ok(start);
  const angle = Math.acos(dot(start, later) / (length(start) * length(later)));
  assert.ok(Math.abs(angle - 2 * Math.PI / PERIOD_DAYS) < 1e-9);
  assert.ok(Math.abs(dot(later, frame.m)) < 1e-12);
}

{
  // 4. For an eccentricity of 0.5 the distance stays between a(1-e) and a(1+e).
  const eccentricFacts = { ...circularFacts, eccentricity: 0.5, argument_of_periastron_deg: 40, inclination_deg: 72 };
  const elements = readExoplanetOrbit(eccentricFacts);
  assert.ok(elements);
  assert.deepEqual(elements.conventions, ["node_angle"]);
  let minimum = Infinity;
  let maximum = 0;
  for (let step = 0; step < 400; step += 1) {
    const { offset } = offsetAt(eccentricFacts, REFERENCE_JD + (step / 400) * PERIOD_DAYS);
    assert.ok(offset);
    minimum = Math.min(minimum, length(offset));
    maximum = Math.max(maximum, length(offset));
  }
  assert.ok(minimum >= SEMI_MAJOR_AXIS_AU * 0.5 - 1e-12 && minimum < SEMI_MAJOR_AXIS_AU * 0.5 + 1e-5);
  assert.ok(maximum <= SEMI_MAJOR_AXIS_AU * 1.5 + 1e-12 && maximum > SEMI_MAJOR_AXIS_AU * 1.5 - 1e-5);

  // The eccentric planet is also at conjunction at its conjunction time, and
  // each ring point is inside the same limits.
  const conjunction = offsetAt(eccentricFacts, REFERENCE_JD);
  assert.ok(conjunction.offset);
  assert.ok(Math.abs(dot(conjunction.offset, conjunction.frame.n)) < 1e-12);
  assert.ok(dot(conjunction.offset, conjunction.frame.s) < 0);
  for (const point of exoplanetOrbitRingAu(elements, hostFrame(TRAPPIST_HOST), 90)) {
    assert.ok(length(point) >= SEMI_MAJOR_AXIS_AU * 0.5 - 1e-12 && length(point) <= SEMI_MAJOR_AXIS_AU * 1.5 + 1e-12);
  }

  // A periastron time puts the planet at periastron: the shortest distance,
  // at the argument of periastron from the node.
  const periastronFacts = {
    ...eccentricFacts,
    ephemeris_reference_type: "periastron",
    ephemeris_argument_of_periastron_deg: 40,
  };
  const periastron = offsetAt(periastronFacts, REFERENCE_JD);
  assert.ok(periastron.offset);
  assert.ok(Math.abs(length(periastron.offset) - SEMI_MAJOR_AXIS_AU * 0.5) < 1e-12);
  assert.ok(Math.abs(dot(periastron.offset, periastron.frame.n) - SEMI_MAJOR_AXIS_AU * 0.5 * Math.cos(40 * Math.PI / 180)) < 1e-12);
}

{
  // 5. The uncertainty grows with the time from the reference time and gives
  // the correct display state.
  const elements = readExoplanetOrbit(circularFacts);
  assert.ok(elements);
  const near = exoplanetOrbitStateAt(elements, timestampAt(REFERENCE_JD));
  assert.ok(near.phaseUncertaintyOrbits !== null);
  assert.ok(Math.abs(near.phaseUncertaintyOrbits - 0.0002 / PERIOD_DAYS) < 1e-12);
  assert.equal(near.marker, "solid");

  // sigma = sqrt(sigma_T^2 + (N * sigma_P)^2) / P, with the larger published error.
  const orbits = 1_000;
  const later = exoplanetOrbitStateAt(elements, timestampAt(REFERENCE_JD + orbits * PERIOD_DAYS));
  assert.ok(later.phaseUncertaintyOrbits !== null);
  assert.ok(Math.abs(later.phaseUncertaintyOrbits - Math.hypot(0.0002, orbits * 0.00002) / PERIOD_DAYS) < 1e-9);
  assert.ok(later.phaseUncertaintyOrbits > near.phaseUncertaintyOrbits);
  assert.equal(later.marker, "solid");

  const hollowOrbits = (HOLLOW_MARKER_PHASE_UNCERTAINTY_ORBITS * PERIOD_DAYS / 0.00002) * 1.2;
  const hollow = exoplanetOrbitStateAt(elements, timestampAt(REFERENCE_JD + hollowOrbits * PERIOD_DAYS));
  assert.equal(hollow.displayState, "position");
  assert.equal(hollow.marker, "hollow");

  const lostOrbits = (MAX_MARKER_PHASE_UNCERTAINTY_ORBITS * PERIOD_DAYS / 0.00002) * 1.2;
  const lost = exoplanetOrbitStateAt(elements, timestampAt(REFERENCE_JD + lostOrbits * PERIOD_DAYS));
  assert.equal(lost.displayState, "orbit_only");
  assert.equal(lost.displayReason, "phase_uncertainty");
  assert.equal(lost.marker, "none");
  assert.equal(lost.meanAnomalyRad, null);
  assert.equal(exoplanetOffsetAu(elements, hostFrame(TRAPPIST_HOST), lost), null);

  // The same holds before the reference time.
  const past = exoplanetOrbitStateAt(elements, timestampAt(REFERENCE_JD - lostOrbits * PERIOD_DAYS));
  assert.equal(past.displayState, "orbit_only");

  // Without a published uncertainty, or with mixed papers, the marker is hollow.
  const { ephemeris_period_days_err_plus: _plus, ephemeris_period_days_err_minus: _minus, ...noPeriodError } = circularFacts;
  const unknown = exoplanetOrbitStateAt(readExoplanetOrbit(noPeriodError)!, timestampAt(REFERENCE_JD + 10));
  assert.equal(unknown.phaseUncertaintyOrbits, null);
  assert.equal(unknown.displayState, "position");
  assert.equal(unknown.marker, "hollow");
  const mixed = exoplanetOrbitStateAt(readExoplanetOrbit({ ...circularFacts, ephemeris_mixed_references: true })!, timestampAt(REFERENCE_JD));
  assert.equal(mixed.marker, "hollow");

  // A reference time in TDB is later than the same instant in UTC.
  const dynamical = offsetAt({ ...circularFacts, ephemeris_time_system: "BJD-TDB" }, REFERENCE_JD - DYNAMICAL_TIME_MINUS_UTC_SECONDS / 86_400);
  assert.ok(dynamical.offset);
  assert.ok(Math.abs(dot(dynamical.offset, dynamical.frame.n)) < 1e-9);
}

{
  // 6. Absent values give display state 2 or 3, not an invented position.
  const orbitOnly = readExoplanetOrbit({ orbit_display_state: "orbit_only", semi_major_axis_au: 42 });
  assert.ok(orbitOnly);
  assert.equal(orbitOnly.ephemeris, null);
  const state = exoplanetOrbitStateAt(orbitOnly, timestampAt(REFERENCE_JD));
  assert.equal(state.displayState, "orbit_only");
  assert.equal(state.displayReason, "no_timing");
  assert.equal(exoplanetOffsetAu(orbitOnly, hostFrame(TRAPPIST_HOST), state), null);
  assert.equal(exoplanetOrbitRingAu(orbitOnly, hostFrame(TRAPPIST_HOST), 12).length, 13);

  assert.equal(readExoplanetOrbit({ orbit_display_state: "none", period_days: 900 }), null);
  assert.equal(readExoplanetOrbit({ orbit_display_state: "position", period_days: 900 }), null);
  assert.equal(readExoplanetOrbit({ semi_major_axis_au: 0.03, period_days: 6.1 }), null);
  assert.equal(readExoplanetOrbit(null), null);

  // A "position" record with a broken ephemeris falls back to the orbit only.
  const { ephemeris_reference_time_jd: _time, ...noTime } = circularFacts;
  assert.equal(exoplanetOrbitStateAt(readExoplanetOrbit(noTime)!, timestampAt(REFERENCE_JD)).displayState, "orbit_only");
  const periastronWithoutArgument = { ...circularFacts, ephemeris_reference_type: "periastron" };
  assert.equal(readExoplanetOrbit(periastronWithoutArgument)!.ephemeris, null);

  // Limits are not measurements: the shape is a circle and the orbit is edge-on.
  const limits = readExoplanetOrbit({
    ...circularFacts,
    eccentricity: 0.3, eccentricity_limit: 1, argument_of_periastron_deg: 90,
    inclination_deg: 60, inclination_deg_limit: -1,
  });
  assert.ok(limits);
  assert.equal(limits.eccentricity, 0);
  assert.deepEqual(limits.conventions, ["node_angle", "edge_on_inclination", "circular_orbit"]);
  // An eccentricity with no argument of periastron cannot orient an ellipse.
  assert.deepEqual(readExoplanetOrbit({ ...circularFacts, eccentricity: 0.3, inclination_deg: 88 })!.conventions, ["node_angle", "circular_orbit"]);
  // A measured eccentricity of zero is a circle, not a convention.
  assert.deepEqual(readExoplanetOrbit({ ...circularFacts, eccentricity: 0, inclination_deg: 88 })!.conventions, ["node_angle"]);

  // Bodies: the planet moves off its host, and each other body is unchanged.
  const timestamp = timestampAt(REFERENCE_JD + 1);
  const positioned = positionExoplanet(planet(circularFacts), timestamp, AU_KM);
  assert.equal(positioned.exoplanet_orbit?.display_state, "position");
  assert.equal(positioned.exoplanet_orbit?.marker, "solid");
  assert.equal(positioned.catalog?.dynamic_position, true);
  assert.deepEqual(positioned.exoplanet_orbit?.host_position, { x_au: TRAPPIST_HOST.x, y_au: TRAPPIST_HOST.y, z_au: TRAPPIST_HOST.z });
  const separation = Math.hypot(
    positioned.position.x_au - TRAPPIST_HOST.x,
    positioned.position.y_au - TRAPPIST_HOST.y,
    positioned.position.z_au - TRAPPIST_HOST.z,
  );
  assert.ok(Math.abs(separation - SEMI_MAJOR_AXIS_AU) < 1e-8);
  // A second calculation starts from the host position, not from the planet.
  const again = positionExoplanet(positioned, timestamp, AU_KM);
  assert.deepEqual(again.position, positioned.position);
  const ring = exoplanetOrbitPathAu(positioned, 36);
  assert.ok(ring);
  assert.equal(ring.length, 37);
  assert.ok(exoplanetUncertaintyPathAu(positioned));
  assert.equal(exoplanetOrbitReachAu(positioned), SEMI_MAJOR_AXIS_AU);

  const ringOnly = positionExoplanet(planet({ orbit_display_state: "orbit_only", semi_major_axis_au: 42 }), timestamp, AU_KM);
  assert.equal(ringOnly.exoplanet_orbit?.display_state, "orbit_only");
  assert.equal(ringOnly.exoplanet_orbit?.marker, "none");
  assert.equal(ringOnly.position.x_au, TRAPPIST_HOST.x);
  assert.equal(ringOnly.catalog?.dynamic_position, false);
  assert.ok(exoplanetOrbitPathAu(ringOnly));
  assert.equal(exoplanetUncertaintyPathAu(ringOnly), null);

  const noOrbit = positionExoplanet(planet({ orbit_display_state: "none", period_days: 900 }), timestamp, AU_KM);
  assert.equal(noOrbit.exoplanet_orbit?.display_state, "none");
  assert.equal(noOrbit.exoplanet_orbit?.display_reason, "no_orbit_size");
  assert.equal(noOrbit.position.x_au, TRAPPIST_HOST.x);
  assert.equal(exoplanetOrbitPathAu(noOrbit), null);
  assert.equal(exoplanetOrbitReachAu(noOrbit), null);

  // A record from before the orbit facts existed stays as it is.
  const legacy = planet({ semi_major_axis_au: 0.03, period_days: 6.1 });
  assert.equal(positionExoplanet(legacy, timestamp, AU_KM), legacy);
  const star = { ...planet(circularFacts), catalog_group: "exoplanet_systems" } as Body;
  assert.equal(positionExoplanet(star, timestamp, AU_KM), star);

  // The marker rule: a calculated position on an orbit of 4 pixels or more.
  assert.equal(isExoplanetOrbitResolved(positioned, 4 / (2 * SEMI_MAJOR_AXIS_AU)), true);
  assert.equal(isExoplanetOrbitResolved(positioned, 3.9 / (2 * SEMI_MAJOR_AXIS_AU)), false);
  assert.equal(hasResolvedExoplanetMarker(positioned, 1_000), true);
  assert.equal(hasResolvedExoplanetMarker(ringOnly, 1_000), false);
  assert.equal(isExoplanetOrbitResolved(ringOnly, 1_000), true);
  assert.equal(isExoplanetOrbitResolved(noOrbit, 1_000_000), false);
}

{
  // 7. Two points 0.03 AU apart at 2.5 million AU stay apart after the
  // Float32 conversion with the origin.
  const color = { red: 1, green: 1, blue: 1, radiusAu: 0 };
  const points = [
    { xAu: TRAPPIST_HOST.x, yAu: TRAPPIST_HOST.y, ...color },
    { xAu: TRAPPIST_HOST.x + 0.03, yAu: TRAPPIST_HOST.y, ...color },
  ];
  const absolute = packRichPoints(points, { x: 0, y: 0 });
  assert.equal(absolute[0], absolute[6], "absolute Float32 AU values put the two points on one value");

  const origin = richLayerOrigin(null, { xAu: TRAPPIST_HOST.x + 0.01, yAu: TRAPPIST_HOST.y }, 0.2);
  const relative = packRichPoints(points, origin);
  assert.ok(Math.abs((relative[6] - relative[0]) - 0.03) < 1e-7);
  assert.ok(Math.abs(origin.x + relative[6] - (TRAPPIST_HOST.x + 0.03)) < 1e-7);

  // The origin stays while the camera is near, and moves when it is not.
  assert.equal(richLayerOrigin(origin, { xAu: origin.x + 10, yAu: origin.y }, 0.2), origin);
  assert.notEqual(richLayerOrigin(origin, { xAu: origin.x + 100, yAu: origin.y }, 0.2), origin);
}

{
  // Each new text exists in each of the nine languages, with the same placeholders.
  const locales = ["en", "es", "fr", "de", "pt-BR", "it", "zh-Hans", "ja", "ko"];
  assert.deepEqual(Object.keys(EXOPLANET_TRANSLATIONS).sort(), [...locales].sort());
  const placeholders = (text: string) => (text.match(/\{\w+}/g) ?? []).sort().join(",");
  for (const locale of locales) {
    const strings = EXOPLANET_TRANSLATIONS[locale]!;
    assert.deepEqual(Object.keys(strings), [...EXOPLANET_TRANSLATION_KEYS], locale);
    for (const key of EXOPLANET_TRANSLATION_KEYS) {
      assert.ok(strings[key]!.trim(), `${locale} ${key}`);
      assert.equal(placeholders(strings[key]!), placeholders(EXOPLANET_TRANSLATIONS.en![key]!), `${locale} ${key} placeholders`);
      if (locale !== "en" && strings[key]!.length > 12) {
        assert.notEqual(strings[key], EXOPLANET_TRANSLATIONS.en![key], `${locale} ${key} is not the English text`);
      }
    }
  }
}

console.log("exoplanet orbit tests passed");
