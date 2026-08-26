import assert from "node:assert/strict";
import {
  buildSkyCardPath,
  buildSkyPermalink,
  decodeSkyPermalink,
  decodeViewState,
  encodeViewState,
  normalizeSkyViewState,
  skyPermalinkToViewState,
} from "../src/viewState.ts";

const state = {
  center: { x: -4.321987654321e20, y: 1.234567890123e-8 }, zoom: 1e-14,
  time: "2042-04-05T06:07:08.000Z" as const, objectKey: "gaia:123",
  compare: ["gaia:123", "mars"] as const, catalogRelease: "v9",
  layers: { labels: true, grid: false, milkyWay: true }, filters: { primary: "galaxy", compare: "all" } as const,
  sky: { observerKey: "earth", yawDeg: 182.5, pitchDeg: -12, fovDeg: 64, constellations: false, hiddenObjectTypes: ["asteroid", "comet"] },
  tour: "local-group", step: 3
};
const encoded = encodeViewState(state);
assert.deepEqual(decodeViewState(encoded), state);
assert.equal(new URLSearchParams(encoded).get("F"), "galaxy.all");
assert.equal(new URLSearchParams(encoded).get("sl"), "0");
assert.equal(new URLSearchParams(encoded).get("sf"), "asteroid,comet");
assert.equal(decodeViewState("?v=1&c=0,0&z=Infinity&t=now&L="), null);
assert.equal(decodeViewState("?v=2&c=0,0&z=1&t=now&L="), null);
assert.equal(decodeViewState("?v=1&c=0,0&z=1&t=not-a-date&L="), null);
assert.deepEqual(decodeViewState("?v=1&c=0,0&z=1&t=now&L=labels.1~futureLayer.1&F=galaxy.all")?.layers, { labels: true });
assert.deepEqual(decodeViewState("?v=1&c=0,0&z=1&t=now&L=labels.10")?.layers, {});
assert.deepEqual(decodeViewState("?v=1&c=0,0&z=1&t=now&L=&F=galaxy.all")?.filters, { primary: "galaxy", compare: "all" });
assert.equal(decodeViewState("?v=1&c=0,0&z=1&t=now&L=&F=galaxy.unknown")?.filters, undefined);
assert.equal(decodeViewState("?v=1&c=0,0&z=1&t=now&L=&sky=earth&sc=0,95,60")?.sky, undefined);
assert.deepEqual(
  decodeViewState("?v=1&c=0,0&z=1&t=now&L=&sky=Earth&sc=360.04,-12.04,63.96")?.sky,
  { observerKey: "earth", yawDeg: 0, pitchDeg: -12, fovDeg: 64, constellations: true, hiddenObjectTypes: [] },
);
assert.equal(decodeViewState("?v=1&c=0,0&z=1&t=now&L=&sky=earth&sc=0,0,72&sl=2")?.sky, undefined);
assert.equal(decodeViewState("?v=1&c=0,0&z=1&t=now&L=&sky=earth&sc=0,0,72&sf=asteroid,future")?.sky, undefined);

const normalizedSky = normalizeSkyViewState({
  observerKey: " Proxima-Centauri ", yawDeg: -0.04, pitchDeg: 12.26, fovDeg: 71.94,
  constellations: false, hiddenObjectTypes: ["comet", "asteroid", "comet"],
});
assert.deepEqual(normalizedSky, {
  observerKey: "proxima-centauri", yawDeg: 0, pitchDeg: 12.3, fovDeg: 71.9,
  constellations: false, hiddenObjectTypes: ["asteroid", "comet"],
});

const shareState = {
  ...normalizedSky!,
  epochUtc: "2042-04-05T06:07:08Z",
  catalogRelease: "gaia-dr3.2026-08",
  locale: "fr" as const,
};
const permalink = buildSkyPermalink(shareState);
const cardPath = buildSkyCardPath(shareState);
assert.match(permalink, /^\/sky\/proxima-centauri\?v=1&/);
assert.match(cardPath, /^\/sky\/proxima-centauri\/card\.png\?v=1&/);
assert.equal(permalink.includes("observer_x"), false);
assert.equal(permalink.includes("c=0%2C0"), false);
assert.deepEqual(decodeSkyPermalink("/sky/proxima-centauri", permalink.split("?")[1]!), {
  ...shareState,
  epochUtc: "2042-04-05T06:07:08.000Z",
});
assert.deepEqual(skyPermalinkToViewState(decodeSkyPermalink("/sky/proxima-centauri", permalink.split("?")[1]!)!).sky, normalizedSky);
assert.equal(decodeSkyPermalink("/sky/earth", "v=1&t=now&sc=0,0,72"), null);
assert.equal(decodeSkyPermalink("/sky/earth", "v=1&t=2042-04-05T00:00:00Z&sc=0,0,10"), null);
assert.equal(decodeSkyPermalink("/sky/earth", "v=1&v=1&t=2042-04-05T00:00:00Z&sc=0,0,72"), null);
assert.equal(decodeSkyPermalink("/sky/not allowed", "", new Date("2042-04-05T00:00:00Z")), null);
assert.equal(decodeSkyPermalink("/sky/earth", `v=1&t=2042-04-05T00:00:00Z&sc=0,0,72&x=${"a".repeat(1_501)}`), null);
assert.equal(decodeSkyPermalink("/sky/earth", "v=1&t=2042-04-05T00:00:00Z&sc=0,0,72&lang=invalid")?.locale, "en");
console.log("viewState tests passed");
