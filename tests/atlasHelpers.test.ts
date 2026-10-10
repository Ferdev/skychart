import assert from "node:assert/strict";
import { bodyDistanceKm, escapeHtml, formatRatio, identifierLabel, identifierValue, readableCatalogWords, shortBodyName, uniquePairs, uniqueTextValues } from "../src/atlasFormatting.ts";
import { clamp, edgeAnchorForScreen, expandedRect, niceStep, pointInRect, pointRect, rectUnion } from "../src/geometry.ts";
import { eclipticCartesianToEquatorial } from "../src/coordinates.ts";
import { objectMediaFor, objectMediaItemsFor, pixelBufferHasVisibleVariation } from "../src/objectMedia.ts";
import { catalogSummaryFromEphemeris, mergeBodyList, replaceBodyList } from "../src/atlas/atlasState.ts";

assert.equal(escapeHtml(`<a title="x">Tom & 'Ada'</a>`), "&lt;a title=&quot;x&quot;&gt;Tom &amp; &#039;Ada&#039;&lt;/a&gt;");
assert.equal(identifierLabel("gaia_dr3_source_id"), "Gaia DR3 Source ID");
assert.equal(identifierLabel("jpl_spkid"), "JPL SPK-ID");
assert.equal(identifierLabel("simbad_oid"), "SIMBAD OID");
assert.equal(readableCatalogWords("spice_spk"), "SPICE SPK");
assert.equal(readableCatalogWords("jpl_de440s_ephemeris"), "JPL DE440s Ephemeris");
assert.equal(readableCatalogWords("naif_mar099s_satellite_spk"), "NAIF Mar099s Satellite SPK");
assert.equal(readableCatalogWords("desi_dr1_tile"), "DESI DR1 Tile");
assert.equal(readableCatalogWords("sdss_spiders_dr20"), "SDSS SPIDERS DR20");
assert.equal(readableCatalogWords("ngc_ic_deep_sky"), "NGC IC Deep Sky");
assert.equal(readableCatalogWords("esa_gaia_dr3"), "ESA Gaia DR3");
assert.equal(readableCatalogWords("simbad_tap"), "SIMBAD TAP");
assert.equal(readableCatalogWords("deep_sky_catalog"), "Deep Sky Catalog");
assert.equal(readableCatalogWords("discovery"), "Discovery", "a word that contains an acronym does not change");
assert.equal(readableCatalogWords(""), "");
assert.equal(identifierValue("  42 "), "42");
assert.equal(identifierValue(Number.NaN), null);
assert.deepEqual(uniqueTextValues(["Mars", " mars ", null, "Earth"]), ["Mars", "Earth"]);
assert.deepEqual(uniquePairs([["ID", "1"], ["id", "1"], ["ID", "2"]]), [["ID", "1"], ["ID", "2"]]);
assert.equal(shortBodyName("M31 Andromeda"), "M31 Andromeda");
assert.equal(formatRatio(12.3456), "12.35");
assert.equal(bodyDistanceKm(
  { position: { x_au: 1, y_au: 2, z_au: 3 } } as never,
  { position: { x_au: 4, y_au: 6, z_au: 3 } } as never,
  10,
), 50);
assert.equal(catalogSummaryFromEphemeris({} as never), null);
assert.deepEqual(
  catalogSummaryFromEphemeris({ catalog: { object_count: 12, group_counts: { core: 3 } } } as never),
  { object_count: 12, group_counts: { core: 3 } },
);
const previewBody = { key: "gaia-example", catalog: { preview: true } };
const hydratedBody = { key: "gaia-example", catalog: { preview: false }, name: "Gaia example" };
const additionalBody = { key: "earth", name: "Earth" };
assert.deepEqual(
  mergeBodyList([previewBody] as never, [hydratedBody, additionalBody] as never),
  [hydratedBody, additionalBody],
);
assert.deepEqual(
  replaceBodyList(
    [{ key: "earth", position: { x_au: 1 } }, { key: "io", position: { x_au: 2 } }] as never,
    [{ key: "io", position: { x_au: 3 } }, { key: "titan", position: { x_au: 4 } }] as never,
  ),
  [{ key: "earth", position: { x_au: 1 } }, { key: "io", position: { x_au: 3 } }, { key: "titan", position: { x_au: 4 } }],
);

const bounds = { left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 };
assert.equal(clamp(12, 0, 10), 10);
assert.equal(niceStep(2.1), 5);
assert.deepEqual(expandedRect(bounds, 5), { left: -5, top: -5, right: 105, bottom: 85, width: 110, height: 90 });
assert.deepEqual(pointRect({ x: 10, y: 20 }, 4), { left: 8, top: 18, right: 12, bottom: 22, width: 4, height: 4 });
assert.deepEqual(rectUnion(pointRect({ x: 10, y: 20 }, 4), pointRect({ x: 20, y: 30 }, 4)), { left: 8, top: 18, right: 22, bottom: 32, width: 14, height: 14 });
assert.equal(pointInRect({ x: 100, y: 80 }, bounds), true);
assert.deepEqual(edgeAnchorForScreen({ x: 200, y: 40 }, { x: 50, y: 40 }, bounds), { point: { x: 84, y: 40 }, side: "right" });
assert.equal(pixelBufferHasVisibleVariation(new Uint8ClampedArray([32, 32, 32, 255, 32, 32, 32, 255])), false);
assert.equal(pixelBufferHasVisibleVariation(new Uint8ClampedArray([32, 32, 32, 255, 32, 36, 32, 255])), true);
{
  // A bright star can fill a survey frame: most pixels are at the maximum of a channel and the image shows a solid colour.
  const frame = (saturatedPixels: number, darkPixels: number) => new Uint8ClampedArray([
    ...Array.from({ length: saturatedPixels }, (_, index) => [255, 255, 250 - (index % 3), 255]).flat(),
    ...Array.from({ length: darkPixels }, (_, index) => [20 + (index % 5), 22, 30, 255]).flat(),
  ]);
  assert.equal(pixelBufferHasVisibleVariation(frame(100, 0)), false, "a fully saturated frame");
  assert.equal(pixelBufferHasVisibleVariation(frame(61, 39)), false, "more than 60% of the pixels saturated");
  assert.equal(pixelBufferHasVisibleVariation(frame(60, 40)), true, "60% is the limit");
  assert.equal(pixelBufferHasVisibleVariation(frame(5, 95)), true, "a star field with some saturated stars");
  // The alpha channel is not a colour channel: an opaque dark image is not saturated.
  assert.equal(pixelBufferHasVisibleVariation(frame(0, 100)), true);
  // One saturated channel is sufficient, for example a red frame.
  assert.equal(pixelBufferHasVisibleVariation(new Uint8ClampedArray(Array.from({ length: 50 }, (_, index) => [255, index % 9, 0, 255]).flat())), false);
}
assert.deepEqual(eclipticCartesianToEquatorial(1, 0, 0), { raDeg: 0, decDeg: 0 });
const eclipticYAxis = eclipticCartesianToEquatorial(0, 1, 0);
assert.ok(eclipticYAxis);
assert.ok(Math.abs(eclipticYAxis.raDeg - 90) < 1e-9);
assert.ok(Math.abs(eclipticYAxis.decDeg - 23.4392911) < 1e-9);

const legacySurveyBody = {
  key: "example-galaxy",
  name: "Example Galaxy",
  object_type: "galaxy",
  catalog: { ra_deg: 190.1086, dec_deg: 1.2005 },
  deep_sky: { angular_size_arcmin: "12.0 x 6.0" }
};
const legacySurveyItems = objectMediaItemsFor(legacySurveyBody);
assert.deepEqual(legacySurveyItems.map((media) => media.provider), ["dss2", "legacy-dr11"]);
const legacySurveyMedia = legacySurveyItems[1];
assert.ok(legacySurveyMedia);
assert.equal(legacySurveyMedia.badge, "Legacy Surveys DR11");
const legacySurveyImageUrl = new URL(legacySurveyMedia.imageUrl, "https://skychart.org");
assert.equal(legacySurveyImageUrl.origin, "https://skychart.org");
assert.equal(legacySurveyImageUrl.pathname, "/api/survey-image");
assert.equal(legacySurveyImageUrl.searchParams.get("provider"), "legacy-dr11");
assert.equal(legacySurveyImageUrl.searchParams.get("ra"), "190.108600");
assert.equal(legacySurveyImageUrl.searchParams.get("dec"), "1.200500");
assert.equal(legacySurveyImageUrl.searchParams.get("fov"), "0.420");
assert.ok(legacySurveyMedia.fallback);
assert.equal(legacySurveyMedia.fallback.provider, "allwise");
const legacyFallbackImageUrl = new URL(legacySurveyMedia.fallback.imageUrl, "https://skychart.org");
assert.equal(legacyFallbackImageUrl.origin, "https://skychart.org");
assert.equal(legacyFallbackImageUrl.pathname, "/api/survey-image");
assert.equal(legacyFallbackImageUrl.searchParams.get("provider"), "allwise");

const defaultSurveyMedia = objectMediaFor(legacySurveyBody);
assert.ok(defaultSurveyMedia);
assert.equal(defaultSurveyMedia.provider, "dss2");
const defaultSurveyImageUrl = new URL(defaultSurveyMedia.imageUrl, "https://skychart.org");
assert.equal(defaultSurveyImageUrl.pathname, "/api/survey-image");
assert.equal(defaultSurveyImageUrl.searchParams.get("provider"), "dss2");
assert.equal(defaultSurveyImageUrl.searchParams.get("fov"), "0.420");

const curatedAndSurveyMedia = objectMediaItemsFor({
  key: "m31",
  name: "M31 Andromeda Galaxy",
  object_type: "galaxy",
  catalog: { ra_deg: 10.684708, dec_deg: 41.26875 }
});
assert.deepEqual(curatedAndSurveyMedia.map((media) => media.kind), ["curated", "survey"]);
assert.deepEqual(curatedAndSurveyMedia.map((media) => media.provider ?? media.kind), ["curated", "legacy-dr11"]);
assert.equal(curatedAndSurveyMedia[1]?.badge, "Legacy Surveys DR11");
assert.equal(objectMediaFor({ key: "unknown", name: "Unknown", catalog: { ra_deg: 361, dec_deg: 0 } }), null);

const earthObserver = { position: { x_au: 1, y_au: 0, z_au: 0 } };
const asteroidMedia = objectMediaItemsFor({
  key: "jpl-sbdb-example",
  name: "Example asteroid",
  object_type: "asteroid",
  catalog: { catalog_group: "jpl_small_bodies", ra_deg: null, dec_deg: null },
  position: { x_au: 1, y_au: 1, z_au: 0 }
}, earthObserver);
assert.deepEqual(asteroidMedia.map((media) => media.provider), ["dss2", "legacy-dr11"]);
const asteroidDr11Url = new URL(asteroidMedia[1]!.imageUrl, "https://skychart.org");
assert.equal(asteroidDr11Url.searchParams.get("ra"), "90.000000");
assert.equal(asteroidDr11Url.searchParams.get("dec"), "23.439291");
assert.match(asteroidMedia[1]!.description ?? "", /moving object may not appear/i);
assert.deepEqual(objectMediaItemsFor({
  key: "jpl-sbdb-no-observer",
  name: "Observerless asteroid",
  object_type: "asteroid",
  position: { x_au: 0, y_au: 1, z_au: 0 }
}), []);

const gaiaMedia = objectMediaItemsFor({
  key: "gaia_dr3_example",
  name: "Gaia DR3 example",
  object_type: "star",
  catalog: { catalog_group: "gaia_dr3_bulk", ra_deg: null, dec_deg: null },
  position: { x_au: 2, y_au: 0, z_au: 0 }
}, earthObserver);
assert.deepEqual(gaiaMedia.map((media) => media.provider), ["dss2", "legacy-dr11"]);
const gaiaDr11Url = new URL(gaiaMedia[1]!.imageUrl, "https://skychart.org");
assert.equal(gaiaDr11Url.searchParams.get("ra"), "0.000000");
assert.equal(gaiaDr11Url.searchParams.get("dec"), "0.000000");
assert.match(gaiaMedia[1]!.description ?? "", /reconstructed from the atlas position/i);

console.log("atlas helper tests passed");
