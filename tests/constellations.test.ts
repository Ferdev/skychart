import assert from "node:assert/strict";
import { CONSTELLATIONS } from "../src/sky/constellations.ts";

assert.equal(CONSTELLATIONS.length, 87, "all line-bearing IAU figures are represented, including both parts of Serpens");

const orion = CONSTELLATIONS.find((constellation) => constellation.name === "Orion");
assert.ok(orion);
assert.equal(orion.polylines.length, 6);
assert.ok(orion.polylines.some((polyline) =>
  ["hip-22449", "hip-25336", "hip-26207", "hip-27989"].every((key) => polyline.includes(key))));

const endpoints = new Set(CONSTELLATIONS.flatMap((constellation) => constellation.polylines.flat()));
assert.ok(endpoints.size >= 700, "the figures should retain their full Hipparcos topology");
assert.ok([...endpoints].every((key) => /^hip-\d+$/.test(key)));

console.log("constellation topology tests passed");
