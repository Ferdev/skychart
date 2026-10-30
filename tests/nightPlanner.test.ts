import assert from "node:assert/strict";
import { test } from "node:test";
import { barSegments, defaultNight, forgetSite, parseCoordinate, planRequest, PLANNER_SITE_KEY, readSite, targetDirection, validSite, writeSite } from "../src/sky/nightPlannerModel.ts";
import { eclipticCartesianToEquatorial } from "../src/coordinates.ts";

function memoryStore() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key), values };
}

test("the site is stored in the browser and can be removed", () => {
  const store = memoryStore();
  assert.equal(readSite(store), null);
  writeSite(store, { latitude: -33.5, longitude: 151.2 });
  assert.deepEqual(readSite(store), { latitude: -33.5, longitude: 151.2 });
  forgetSite(store);
  assert.equal(store.values.has(PLANNER_SITE_KEY), false);
});

test("a stored value that is not a valid site is ignored", () => {
  const store = memoryStore();
  store.setItem(PLANNER_SITE_KEY, "{not json");
  assert.equal(readSite(store), null);
  store.setItem(PLANNER_SITE_KEY, JSON.stringify({ latitude: 95, longitude: 0 }));
  assert.equal(readSite(store), null);
});

test("coordinates accept a comma and refuse an empty field", () => {
  assert.equal(parseCoordinate(" 40,4 "), 40.4);
  assert.ok(Number.isNaN(parseCoordinate("")));
  assert.equal(validSite({ latitude: 90, longitude: -180 }), true);
  assert.equal(validSite({ latitude: Number.NaN, longitude: 0 }), false);
});

test("the default night is the evening that is in progress", () => {
  assert.equal(defaultNight(new Date(2026, 9, 30, 22)), "2026-10-30");
  assert.equal(defaultNight(new Date(2026, 9, 30, 3)), "2026-10-29");
  assert.equal(defaultNight(new Date(2026, 0, 1, 2)), "2025-12-31");
});

test("the request sends only the filters that the user set", () => {
  const body = planRequest({ latitude: 1, longitude: 2 }, "2026-10-30", { type: "", minAltitude: 30, maxMagnitude: null, minSize: 0, maxSize: null });
  assert.deepEqual(body, { latitude_deg: 1, longitude_deg: 2, date: "2026-10-30", min_altitude_deg: 30, min_size_arcmin: 0 });
  assert.deepEqual(planRequest({ latitude: 1, longitude: 2 }, "2026-10-30", { type: "galaxy", minAltitude: 10, maxMagnitude: 9, minSize: null, maxSize: 5 }).types, ["galaxy"]);
});

test("a window has its place on the bar of the night", () => {
  const night = { start_utc: "2026-10-30T18:00:00Z", end_utc: "2026-10-31T02:00:00Z" };
  assert.deepEqual(barSegments(night, [{ start_utc: "2026-10-30T20:00:00Z", end_utc: "2026-10-31T00:00:00Z" }]), [{ left: 25, width: 50 }]);
});

test("the direction of a target is the inverse of the atlas coordinate conversion", () => {
  const direction = targetDirection({ ra_deg: 83.8, dec_deg: -5.4 });
  const back = eclipticCartesianToEquatorial(direction.x, direction.y, direction.z)!;
  assert.ok(Math.abs(back.raDeg - 83.8) < 1e-6 && Math.abs(back.decDeg + 5.4) < 1e-6);
  assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-12);
});
