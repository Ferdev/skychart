import assert from "node:assert/strict";
import { escapeHtml, formatRatio, identifierLabel, identifierValue, shortBodyName, uniquePairs, uniqueTextValues } from "../src/atlasFormatting.ts";
import { clamp, edgeAnchorForScreen, expandedRect, niceStep, pointInRect, pointRect, rectUnion } from "../src/geometry.ts";
import { objectMediaFor, objectMediaItemsFor } from "../src/objectMedia.ts";

assert.equal(escapeHtml(`<a title="x">Tom & 'Ada'</a>`), "&lt;a title=&quot;x&quot;&gt;Tom &amp; &#039;Ada&#039;&lt;/a&gt;");
assert.equal(identifierLabel("gaia_dr3_source_id"), "Gaia DR3 Source ID");
assert.equal(identifierValue("  42 "), "42");
assert.equal(identifierValue(Number.NaN), null);
assert.deepEqual(uniqueTextValues(["Mars", " mars ", null, "Earth"]), ["Mars", "Earth"]);
assert.deepEqual(uniquePairs([["ID", "1"], ["id", "1"], ["ID", "2"]]), [["ID", "1"], ["ID", "2"]]);
assert.equal(shortBodyName("M31 Andromeda"), "M31 Andromeda");
assert.equal(formatRatio(12.3456), "12.35");

const bounds = { left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 };
assert.equal(clamp(12, 0, 10), 10);
assert.equal(niceStep(2.1), 5);
assert.deepEqual(expandedRect(bounds, 5), { left: -5, top: -5, right: 105, bottom: 85, width: 110, height: 90 });
assert.deepEqual(pointRect({ x: 10, y: 20 }, 4), { left: 8, top: 18, right: 12, bottom: 22, width: 4, height: 4 });
assert.deepEqual(rectUnion(pointRect({ x: 10, y: 20 }, 4), pointRect({ x: 20, y: 30 }, 4)), { left: 8, top: 18, right: 22, bottom: 32, width: 14, height: 14 });
assert.equal(pointInRect({ x: 100, y: 80 }, bounds), true);
assert.deepEqual(edgeAnchorForScreen({ x: 200, y: 40 }, { x: 50, y: 40 }, bounds), { point: { x: 84, y: 40 }, side: "right" });

const legacySurveyBody = {
  key: "example-galaxy",
  name: "Example Galaxy",
  object_type: "galaxy",
  catalog: { ra_deg: 190.1086, dec_deg: 1.2005 },
  deep_sky: { angular_size_arcmin: "12.0 x 6.0" }
};
const legacySurveyMedia = objectMediaFor(legacySurveyBody);
assert.ok(legacySurveyMedia);
assert.equal(legacySurveyMedia.badge, "Legacy Surveys DR11");
const legacySurveyImageUrl = new URL(legacySurveyMedia.imageUrl);
assert.equal(legacySurveyImageUrl.origin, "https://www.legacysurvey.org");
assert.equal(legacySurveyImageUrl.pathname, "/viewer/jpeg-cutout");
assert.equal(legacySurveyImageUrl.searchParams.get("layer"), "ls-dr11");
assert.equal(legacySurveyImageUrl.searchParams.get("width"), "512");
assert.equal(legacySurveyImageUrl.searchParams.get("height"), "320");
assert.equal(legacySurveyImageUrl.searchParams.get("ra"), "190.108600");
assert.equal(legacySurveyImageUrl.searchParams.get("dec"), "1.200500");

const curatedAndSurveyMedia = objectMediaItemsFor({
  key: "m31",
  name: "M31 Andromeda Galaxy",
  object_type: "galaxy",
  catalog: { ra_deg: 10.684708, dec_deg: 41.26875 }
});
assert.deepEqual(curatedAndSurveyMedia.map((media) => media.kind), ["curated", "survey"]);
assert.equal(curatedAndSurveyMedia[1]?.badge, "Legacy Surveys DR11");
assert.equal(objectMediaFor({ key: "unknown", name: "Unknown", catalog: { ra_deg: 361, dec_deg: 0 } }), null);

console.log("atlas helper tests passed");
