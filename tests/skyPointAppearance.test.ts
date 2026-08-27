import assert from "node:assert/strict";
import { skyPointAppearance } from "../src/sky/skyPointAppearance.ts";

const brightStar = skyPointAppearance({
  object_type: "star",
  color: "#f8cb65",
  apparent_magnitude: -1,
  dynamic: false,
});
const dimStar = skyPointAppearance({
  object_type: "star",
  color: "#77aaff",
  apparent_magnitude: 7,
  dynamic: false,
});

assert.ok(brightStar.coreRadius <= 1.6, "even the brightest stars remain compact pinpoints");
assert.ok(brightStar.coreRadius > dimStar.coreRadius, "apparent magnitude controls the light footprint");
assert.ok(brightStar.opacity > dimStar.opacity, "bright stars emit more light without becoming chart-sized dots");
assert.ok(brightStar.glowRadius > 0, "bright stars retain a soft bloom");
assert.equal(dimStar.glowRadius, 0, "faint stars do not become uniform halo disks");
const brightChannels = brightStar.color.match(/\d+/g)?.map(Number) ?? [];
assert.equal(brightChannels.length, 3);
assert.ok(Math.max(...brightChannels) - Math.min(...brightChannels) < 50, "stellar catalog colors are reduced to a subtle temperature tint");
assert.ok(brightChannels[0]! > brightChannels[2]!, "the underlying warm stellar temperature remains perceptible");

const movingObject = skyPointAppearance({
  object_type: "planet",
  color: "#c96f4c",
  apparent_magnitude: null,
  dynamic: true,
});
assert.ok(movingObject.coreRadius < 1.5, "moving Solar System objects also remain points of light");

const invalidColor = skyPointAppearance({
  object_type: "galaxy",
  color: "not-a-color",
  apparent_magnitude: null,
  dynamic: false,
});
assert.equal(invalidColor.color, "rgb(241, 245, 247)", "invalid catalog colors fall back to neutral light");

console.log("sky point appearance tests passed");
