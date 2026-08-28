import assert from "node:assert/strict";
import {
  estimateMinorBodyApparentMagnitude,
  skyPointAppearance,
} from "../src/sky/skyPointAppearance.ts";

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

const unmeasuredAsteroid = skyPointAppearance({
  object_type: "asteroid",
  color: "#c9a27c",
  apparent_magnitude: null,
  dynamic: true,
});
assert.ok(unmeasuredAsteroid.coreRadius < movingObject.coreRadius, "an asteroid without photometry does not inherit planet-like prominence");
assert.ok(unmeasuredAsteroid.opacity < movingObject.opacity, "an unmeasured asteroid uses a conservative faint fallback");
assert.equal(unmeasuredAsteroid.glowRadius, 0, "an unmeasured asteroid does not receive an artificial halo");
assert.equal(unmeasuredAsteroid.brightCore, false, "an unmeasured asteroid does not receive an artificial bright core");

for (const objectType of ["comet", "small_body", "dwarf_planet"]) {
  const unmeasuredMinorBody = skyPointAppearance({
    object_type: objectType,
    color: "#c9a27c",
    apparent_magnitude: null,
    dynamic: true,
  });
  assert.equal(unmeasuredMinorBody.glowRadius, 0, `${objectType} uses the same conservative no-photometry fallback`);
}

assert.equal(
  estimateMinorBodyApparentMagnitude({
    absoluteMagnitude: 3,
    heliocentricDistanceAu: 2,
    observerDistanceAu: 2,
  }),
  3 + 5 * Math.log10(4),
  "minor-body H magnitude is converted with its illumination and observer distances",
);
const farAsteroidMagnitude = estimateMinorBodyApparentMagnitude({
  absoluteMagnitude: 3,
  heliocentricDistanceAu: 2,
  observerDistanceAu: 2,
});
const nearAsteroidMagnitude = estimateMinorBodyApparentMagnitude({
  absoluteMagnitude: 3,
  heliocentricDistanceAu: 2,
  observerDistanceAu: 0.2,
});
assert.ok(farAsteroidMagnitude !== null && nearAsteroidMagnitude !== null);
assert.ok(nearAsteroidMagnitude < farAsteroidMagnitude, "the same minor body appears brighter from a closer observer");
assert.equal(
  farAsteroidMagnitude - nearAsteroidMagnitude,
  5,
  "moving ten times closer brightens the opposition estimate by five magnitudes",
);
const farAsteroid = skyPointAppearance({
  object_type: "asteroid",
  color: "#c9a27c",
  apparent_magnitude: farAsteroidMagnitude,
  dynamic: true,
});
const nearAsteroid = skyPointAppearance({
  object_type: "asteroid",
  color: "#c9a27c",
  apparent_magnitude: nearAsteroidMagnitude,
  dynamic: true,
});
assert.ok(nearAsteroid.coreRadius > farAsteroid.coreRadius, "observer-relative magnitude changes the rendered light footprint");
assert.ok(nearAsteroid.opacity > farAsteroid.opacity, "a genuinely nearby minor body remains visibly brighter");
assert.equal(
  estimateMinorBodyApparentMagnitude({
    absoluteMagnitude: null,
    heliocentricDistanceAu: 2,
    observerDistanceAu: 2,
  }),
  null,
  "missing H magnitude does not invent observer-relative brightness",
);

const invalidColor = skyPointAppearance({
  object_type: "galaxy",
  color: "not-a-color",
  apparent_magnitude: null,
  dynamic: false,
});
assert.equal(invalidColor.color, "rgb(241, 245, 247)", "invalid catalog colors fall back to neutral light");

console.log("sky point appearance tests passed");
