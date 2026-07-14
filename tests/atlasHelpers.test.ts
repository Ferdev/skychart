import assert from "node:assert/strict";
import { escapeHtml, formatRatio, identifierLabel, identifierValue, shortBodyName, uniquePairs, uniqueTextValues } from "../src/atlasFormatting.ts";
import { clamp, edgeAnchorForScreen, expandedRect, niceStep, pointInRect, pointRect, rectUnion } from "../src/geometry.ts";

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

console.log("atlas helper tests passed");
