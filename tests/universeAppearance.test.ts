import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appearanceRotation, bodyAppearance, EXOPLANET_COLOR, EXOPLANET_MATERIAL, parseBodyColor, resolvedBodyWeight, stellarDisplayColor } from "../src/universe/universeAppearanceProfiles.ts";
import { lightDirection, UniverseExoplanetSystems } from "../src/universe/universeExoplanets.ts";
import { bodyOccluders, occludedByBody, saturnRingOpacity, ringTransmission } from "../src/universe/universeOcclusion.ts";
import { makeDeepSkyCloud } from "../src/universe/universeCloudGeometry.ts";
import { messierTypeCode } from "../src/universe/universeDeepSkyProfiles.ts";
import { createSkyProjector } from "../src/sky/skyProjection.ts";
import { AU_KM } from "../src/universe/universeBodyGeometry.ts";

const camera = { yawDeg: 0, pitchDeg: 0, fovDeg: 72 };
const observer = { x: 1e12, y: -1e12, z: 0 };
const body = { key: "jupiter", object_type: "planet", position: { x: observer.x + 3, y: observer.y, z: 0 }, radiusKm: AU_KM };
const blockers = bodyOccluders([body], observer, camera, 1000, 600);
assert.equal(occludedByBody({ x: 4, y: 0, z: 0 }, blockers), true);
assert.equal(occludedByBody({ x: 1, y: 0, z: 0 }, blockers), false, "foreground points survive");
assert.equal(occludedByBody({ x: -4, y: 0, z: 0 }, blockers), false);
assert.equal(occludedByBody({ x: 4, y: 2, z: 0 }, blockers), false, "rays past the limb survive");
assert.equal(occludedByBody({ x: 3, y: 0, z: 0 }, blockers, "jupiter"), false);
const inside = [{ ...blockers[0]!, center: { x: 0, y: 0, z: 0 }, distance: 0 }];
assert.equal(occludedByBody({ x: 2, y: 0, z: 0 }, inside), true);
assert.equal(occludedByBody({ x: .5, y: 0, z: 0 }, inside), false);
assert.ok(saturnRingOpacity(1.98) < .1, "Cassini division transmits background light");
assert.ok(saturnRingOpacity(1.7) > .5, "dense B ring absorbs background light");
const ring = [{ key: "saturn", center: { x: 0, y: 0, z: 3 }, ringNormal: { x: 0, y: 0, z: 1 }, radius: 1, distance: 3, angularSize: 100 }];
assert.ok(ringTransmission({ x: 3.4, y: 0, z: 6 }, ring) < .5);
assert.equal(ringTransmission({ x: 1.7, y: 0, z: 2 }, ring), 1, "foreground points are unaffected by rings");

for (const key of ["earth", "jupiter", "saturn", "uranus", "moon"]) {
  const rotation = appearanceRotation(bodyAppearance({ ...body, key }));
  const rows = [0,1,2].map((i) => [rotation[i]!, rotation[i+3]!, rotation[i+6]!]);
  for (const row of rows) assert.ok(Math.abs(Math.hypot(...row) - 1) < 1e-6);
  assert.ok(Math.abs(rows[0]!.reduce((sum, v, i) => sum + v * rows[2]![i]!, 0)) < 1e-6);
}
assert.equal(resolvedBodyWeight(1), 0);
assert.equal(resolvedBodyWeight(6), 1);
for (let px = 1.5; px < 6; px += .1) assert.ok(resolvedBodyWeight(px + .1) >= resolvedBodyWeight(px));
assert.ok(stellarDisplayColor(3000)[0] > stellarDisplayColor(3000)[2]);
assert.ok(stellarDisplayColor(15000)[2] > stellarDisplayColor(15000)[0]);
assert.equal(bodyAppearance({ ...body, key: "unknown-exoplanet" }).map, undefined);

// Each exoplanet has one neutral material. The mass, the radius, the
// temperature, and the catalog color do not select a surface.
const hotGiant = bodyAppearance({ key: "exoplanet-51-peg-b", object_type: "planet", catalog_group: "exoplanets",
  position: body.position, radiusKm: 90_000, temperatureK: 1_300, color: "#89d6ff" });
const smallWorld = bodyAppearance({ key: "exoplanet-trappist-1-e", object_type: "planet", catalog_group: "exoplanets",
  position: body.position, radiusKm: 5_861, temperatureK: 250, color: "#ff0000" });
assert.deepEqual(hotGiant, smallWorld);
assert.equal(hotGiant.material, EXOPLANET_MATERIAL);
assert.deepEqual(hotGiant.color, parseBodyColor(EXOPLANET_COLOR));
assert.equal(new Set(hotGiant.color).size, 1, "the neutral color is a gray");
assert.equal(hotGiant.map, undefined);
assert.equal(hotGiant.detail, undefined);
assert.equal(hotGiant.relief, 0);
assert.equal(hotGiant.atmosphere, 0);
assert.equal(hotGiant.tilt, 0);
for (const key of ["earth", "mars", "jupiter", "moon", "titan"]) {
  assert.notEqual(bodyAppearance({ ...body, key }).material, EXOPLANET_MATERIAL, `${key} keeps its own material`);
}
// A name does not make an exoplanet look like a Solar System planet.
assert.deepEqual(bodyAppearance({ ...body, key: "earth", catalog_group: "exoplanets" }), hotGiant);

// An exoplanet is lit from its host star. Each other body is lit from the Sun at the origin.
const host = { x: 2_484_666.23, y: -631_632.11, z: 28_182.95 };
const planetLight = lightDirection({ position: { x: host.x + 0.03, y: host.y, z: host.z }, lightSource: host });
assert.ok(Math.abs(planetLight.x + 1) < 1e-6 && Math.abs(planetLight.y) < 1e-6 && Math.abs(planetLight.z) < 1e-6);
const sunLight = lightDirection({ position: { x: 5, y: 0, z: 0 } });
assert.deepEqual(sunLight, { x: -1, y: 0, z: 0 });
assert.notDeepEqual(planetLight, lightDirection({ position: { x: host.x + 0.03, y: host.y, z: host.z } }));

// The planets of the host stars near the 3D observer load once for each star.
{
  const requests: { x_au: number; y_au: number; z_au: number }[] = [];
  let loaded = 0;
  const systems = new UniverseExoplanetSystems(async (position) => { requests.push(position); }, () => { loaded += 1; });
  const point = (key: string, catalog_group: string, x: number) => ({ key, name: key, catalog_group, position: { x, y: 0, z: 0 }, dynamic: false });
  const points = [
    point("exosys-near", "exoplanet_systems", 100),
    point("near-twin", "nearby_exoplanet_systems", 100),
    point("exosys-far", "exoplanet_systems", 1_000_000),
    point("hip-1", "bright_stars", 10),
  ];
  systems.update(points, { x: 0, y: 0, z: 0 });
  systems.update(points, { x: 1, y: 0, z: 0 });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(requests, [{ x_au: 100, y_au: 0, z_au: 0 }], "one request for one star; a far host and a plain star get none");
  assert.equal(loaded, 1);
  systems.reset();
  systems.update(points, { x: 0, y: 0, z: 0 });
  assert.equal(requests.length, 2, "a time change loads the planets again");
}

const m87 = makeDeepSkyCloud("m87", "elliptical");
assert.deepEqual(m87, makeDeepSkyCloud("simbad-m-87", "elliptical"), "M87 aliases have identical material-space geometry");
const m31 = makeDeepSkyCloud("m31", "spiral");
assert.deepEqual(m31, makeDeepSkyCloud("m31", "spiral"), "clouds do not change when revisited");
assert.notDeepEqual(m31, makeDeepSkyCloud("m33", "spiral"));
assert.ok(m31.some((p) => p.layer === "dust") && m31.some((p) => p.layer === "gas"));
const shell = makeDeepSkyCloud("m57", "ring");
assert.ok(shell.some((p) => Math.hypot(p.x, p.y) < .25), "M57 has material along the interior sightline, not just a torus");
assert.ok(Math.max(...shell.map((p) => p.z)) - Math.min(...shell.map((p) => p.z)) > 1, "M57 has elongated depth");
const nearEdge = { x: 1, y: 1.36, z: 0 };
assert.equal(createSkyProjector(camera, 1000, 600)(nearEdge), null);
assert.ok(createSkyProjector(camera, 1000, 600, 200)(nearEdge), "large soft splats can overlap the viewport with an offscreen center");
// The Messier morphology table must agree with the catalog it was derived from.
// Milky Way patches, double stars and asterisms have no form.
const catalog = JSON.parse(readFileSync(new URL("../data/catalogs/deep_sky_catalog.json", import.meta.url), "utf8")) as
  { objects: { key: string; deep_sky_type: string }[] };
assert.equal(catalog.objects.length, 110);
for (const entry of catalog.objects) {
  assert.equal(messierTypeCode(entry.key), ["MW", "Ds", "As"].includes(entry.deep_sky_type) ? undefined : entry.deep_sky_type, entry.key);
}
assert.equal(messierTypeCode("m55"), "Gc");
assert.equal(messierTypeCode("ngc-104"), undefined);
// A globular cluster with no hand-made profile, such as M55, is still a dense,
// centrally concentrated ball of stars.
const m55 = makeDeepSkyCloud("m55", "globular");
assert.equal(m55.length, 6500);
assert.ok(m55.every((particle) => particle.layer === "star"));
assert.ok(m55.filter((particle) => Math.hypot(particle.x, particle.y, particle.z) < 0.3).length > m55.length * 0.4, "M55 has a concentrated core");
console.log("universe appearance, morphology and occlusion tests passed");
