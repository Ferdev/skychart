import assert from "node:assert/strict";
import { decodeViewState, encodeViewState } from "../src/viewState.ts";

const state = {
  center: { x: -4.321987654321e20, y: 1.234567890123e-8 }, zoom: 1e-14,
  time: "2042-04-05T06:07:08.000Z" as const, objectKey: "gaia:123",
  compare: ["gaia:123", "mars"] as const, catalogRelease: "v9",
  layers: { labels: true, grid: false, milkyWay: true }, filters: { primary: "galaxy", compare: "all" } as const,
  sky: { observerKey: "earth", yawDeg: 182.5, pitchDeg: -12, fovDeg: 64 },
  tour: "local-group", step: 3
};
const encoded = encodeViewState(state);
assert.deepEqual(decodeViewState(encoded), state);
assert.equal(new URLSearchParams(encoded).get("F"), "galaxy.all");
assert.equal(decodeViewState("?v=1&c=0,0&z=Infinity&t=now&L="), null);
assert.equal(decodeViewState("?v=2&c=0,0&z=1&t=now&L="), null);
assert.equal(decodeViewState("?v=1&c=0,0&z=1&t=not-a-date&L="), null);
assert.deepEqual(decodeViewState("?v=1&c=0,0&z=1&t=now&L=labels.1~futureLayer.1&F=galaxy.all")?.layers, { labels: true });
assert.deepEqual(decodeViewState("?v=1&c=0,0&z=1&t=now&L=labels.10")?.layers, {});
assert.deepEqual(decodeViewState("?v=1&c=0,0&z=1&t=now&L=&F=galaxy.all")?.filters, { primary: "galaxy", compare: "all" });
assert.equal(decodeViewState("?v=1&c=0,0&z=1&t=now&L=&F=galaxy.unknown")?.filters, undefined);
assert.equal(decodeViewState("?v=1&c=0,0&z=1&t=now&L=&sky=earth&sc=0,95,60")?.sky, undefined);
console.log("viewState tests passed");
