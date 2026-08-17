import assert from "node:assert/strict";
import { smallBodyOrbitPathForBody } from "../src/catalog/smallBodyOrbit.ts";
import type { Body } from "../src/atlas/contracts.ts";

const facts = {
  argument_of_perihelion_deg: 126.6728325163065,
  ascending_node_deg: 203.8996515621043,
  eccentricity: 0.1911663355386932,
  epoch_jd_tdb: 2461000.5,
  inclination_deg: 3.340958441017069,
  mean_anomaly_deg: 312.8054663584516,
  mean_motion_deg_day: 1.11259994308075,
  semi_major_axis_au: 0.9223803173917017,
};

function apophis(designation: string): Body {
  return {
    key: `jpl-sbdb-${designation}`,
    name: "Apophis",
    object_type: "asteroid",
    catalog_group: "jpl_small_bodies",
    parent_key: "sun",
    radius_km: 0.17,
    color: "#f06f61",
    catalog: { facts, external_ids: { primary_designation: designation } },
    position: { x_au: 0, y_au: 0, z_au: 0, x_km: 0, y_km: 0, z_km: 0, heliocentric_distance_km: 0 },
    distance_from_earth_km: 0,
  } as Body;
}

const horizonsPoints = [
  { x_au: 0.5, y_au: 0.4, z_au: 0.01 },
  { x_au: -0.5, y_au: -0.4, z_au: -0.01 },
];

{
  // Synchronous fallback, then the Horizons series replaces it once fetched.
  const body = apophis("99942");
  let readyCalls = 0;
  let requestedUrl = "";
  const fallback = smallBodyOrbitPathForBody(body, "2029-04-13T21:46:00.000Z", () => { readyCalls += 1; }, async (url) => {
    requestedUrl = url;
    return { ok: true, async json() { return { points: horizonsPoints, position_model: "jpl_horizons_vectors" }; } };
  });
  assert.ok(fallback);
  assert.equal(fallback.length, 182);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(readyCalls, 1);
  assert.match(requestedUrl, /designation=99942/);
  assert.match(requestedUrl, /period_days=323\.5/);
  assert.match(requestedUrl, /around=2029-04-13/);

  const resolved = smallBodyOrbitPathForBody(body, "2029-04-13T21:46:00.000Z", () => {});
  assert.deepEqual(resolved, horizonsPoints.map((point) => ({ xAu: point.x_au, yAu: point.y_au, zAu: point.z_au })));
}

{
  // An unavailable upstream keeps the two-body fallback and does not retry.
  const body = apophis("433");
  let fetches = 0;
  const fallback = smallBodyOrbitPathForBody(body, "2029-04-13T21:46:00.000Z", () => {}, async () => {
    fetches += 1;
    return { ok: true, async json() { return { points: null, position_model: "horizons_unavailable" }; } };
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const after = smallBodyOrbitPathForBody(body, "2029-04-13T21:46:00.000Z", () => {}, async () => {
    fetches += 1;
    return { ok: true, async json() { return { points: null }; } };
  });
  assert.equal(fetches, 1);
  assert.deepEqual(after, fallback);
}

{
  // Bodies without elements or designation have no orbit at all and never fetch.
  const body = apophis("1");
  body.catalog = { facts: {}, external_ids: {} } as Body["catalog"];
  let fetches = 0;
  const path = smallBodyOrbitPathForBody(body, "2029-04-13T21:46:00.000Z", () => {}, async () => {
    fetches += 1;
    return { ok: true, async json() { return {}; } };
  });
  assert.equal(path, null);
  assert.equal(fetches, 0);
}

console.log("small-body orbit tests passed");
