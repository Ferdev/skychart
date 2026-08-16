import assert from "node:assert/strict";
import { propagateSmallBody, smallBodyPositionAt } from "../src/catalog/smallBodyPropagation.ts";
import type { Body } from "../src/atlas/contracts.ts";

const AU_KM = 149_597_870.7;
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

const encounterPosition = smallBodyPositionAt(facts, "2029-04-13T21:46:00.000Z");
assert.ok(encounterPosition);
assert.ok(Math.abs(encounterPosition.xAu - -0.9182007853477625) < 1e-10);
assert.ok(Math.abs(encounterPosition.yAu - -0.4049254184267905) < 1e-10);
assert.ok(Math.abs(encounterPosition.zAu - -0.00010452705512643129) < 1e-10);

const snapshotPosition = smallBodyPositionAt(facts, "2026-05-10T11:00:37.064Z");
assert.ok(snapshotPosition);
assert.ok(Math.hypot(
  encounterPosition.xAu - snapshotPosition.xAu,
  encounterPosition.yAu - snapshotPosition.yAu,
  encounterPosition.zAu - snapshotPosition.zAu,
) > 1);

const apophis = {
  key: "jpl-sbdb-20099942",
  name: "Apophis",
  object_type: "asteroid",
  catalog_group: "jpl_small_bodies",
  parent_key: "sun",
  radius_km: 0.17,
  color: "#f06f61",
  catalog: { facts },
  position: {
    x_au: snapshotPosition.xAu,
    y_au: snapshotPosition.yAu,
    z_au: snapshotPosition.zAu,
    x_km: snapshotPosition.xAu * AU_KM,
    y_km: snapshotPosition.yAu * AU_KM,
    z_km: snapshotPosition.zAu * AU_KM,
    heliocentric_distance_km: 0,
  },
  distance_from_earth_km: 0,
} as Body;
const earth = {
  key: "earth",
  name: "Earth",
  object_type: "planet",
  radius_km: 6_371,
  color: "#62a8ff",
  position: {
    x_au: -0.9144251299137498,
    y_au: -0.4119238986735139,
    z_au: -0.000002772863447075835,
    x_km: 0,
    y_km: 0,
    z_km: 0,
    heliocentric_distance_km: 0,
  },
  distance_from_earth_km: 0,
} as Body;

const propagated = propagateSmallBody(apophis, "2029-04-13T21:46:00.000Z", AU_KM, earth);
assert.notEqual(propagated, apophis);
assert.equal(propagated.catalog?.dynamic_position, true);
assert.ok(Math.abs(propagated.position.x_au - encounterPosition.xAu) < 1e-12);
assert.ok((propagated.distance_from_earth_km ?? Infinity) < 1_200_000);

assert.equal(smallBodyPositionAt({}, "2029-04-13T21:46:00.000Z"), null);
assert.equal(smallBodyPositionAt(facts, "not-a-date"), null);

console.log("small-body propagation tests passed");
