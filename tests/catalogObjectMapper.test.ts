import assert from "node:assert/strict";
import { CatalogObjectMapper } from "../src/catalog/catalogObjectMapper.ts";
import { hasBodyPosition } from "../src/catalog/spacecraftCatalog.ts";
import { equatorialToEclipticDirection } from "../src/coordinates.ts";

const mapper = new CatalogObjectMapper(() => ({ auKm: 149597870.7 }));
const angular = mapper.map({ key: "ngc-unknown", name: "NGC unknown",
  radius_km: null, astrometry: { ra_deg: 90, dec_deg: 0 },
  position: { x_au: null, y_au: null, z_au: null },
  external_ids: { gaia: "18446744073709551615" } });
assert.equal(hasBodyPosition(angular), false);
assert.ok(Number.isNaN(angular.radius_km));
assert.ok(Number.isNaN(angular.distance_from_earth_km));
assert.equal(angular.catalog?.ra_deg, 90);
assert.equal(angular.catalog?.external_ids?.gaia, "18446744073709551615");
const direction = equatorialToEclipticDirection(angular.catalog?.ra_deg, angular.catalog?.dec_deg)!;
assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-12);
assert.ok(direction.z < 0);
assert.equal(equatorialToEclipticDirection(null, 0), null);

const shell = mapper.map({ key: "xray-shell", name: "X-ray detection",
  position_model: "catalog_sky_position_reference_shell",
  astrometry: { ra_deg: 0, dec_deg: 0 }, position: { x_au: 1e14, y_au: 0, z_au: 0 } });
assert.equal(hasBodyPosition(shell), false);
assert.ok(Number.isNaN(shell.position.heliocentric_distance_km));
const sun = mapper.map({ key: "sun", name: "Sun", radius_km: 0,
  position: { x_au: 0, y_au: 0, z_au: 0 } });
assert.equal(hasBodyPosition(sun), true);
assert.equal(sun.radius_km, 0);
assert.equal(sun.position.heliocentric_distance_km, 0);
assert.equal(hasBodyPosition(mapper.map({ key: "metadata", name: "Metadata only" })), false);
console.log("Unknown distance, reference shell, zero position and lossless IDs passed.");
