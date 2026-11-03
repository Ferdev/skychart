import assert from "node:assert/strict";
import { SpacecraftLoader, spacecraftBodies, hasBodyPosition, inSpacecraftCoverage, normalizeSpacecraftBody } from "../src/catalog/spacecraftCatalog.ts";
import type { Body } from "../src/atlas/contracts.ts";
import { SPACECRAFT_TRANSLATIONS, voyagerMilestoneKey } from "../src/catalog/spacecraftTranslations.ts";

const oldEpoch = "2026-09-06T00:00:00Z";
const newEpoch = "2010-01-01T00:00:00Z";
const missions = spacecraftBodies(oldEpoch);
assert.ok(missions.length >= 90);
assert.equal(new Set(missions.map(b => b.key)).size, missions.length);
assert.ok(missions.every(b => !hasBodyPosition(b)));
assert.ok(missions.every(b => Number.isNaN(b.radius_km)));
const mission = missions.find(b => b.key === "spacecraft-31")!;
const missing = normalizeSpacecraftBody({ ...mission, position: null, distance_from_earth_km: null } as never);
assert.equal(hasBodyPosition(missing), false);
assert.ok(Number.isNaN(missing.distance_from_earth_km));
for (const strings of Object.values(SPACECRAFT_TRANSLATIONS)) assert.deepEqual(Object.keys(strings), Object.keys(SPACECRAFT_TRANSLATIONS.en));
assert.equal(Object.keys(SPACECRAFT_TRANSLATIONS).length, 9);
for (const strings of Object.values(SPACECRAFT_TRANSLATIONS)) assert.ok(strings["mission.availability"]?.trim(), "each locale labels the availability row");
// The Voyager 1 light-day text follows the atlas time: a prediction before November 18, 2026, the past after it.
assert.equal(voyagerMilestoneKey("2026-11-17T23:59:59Z"), "mission.milestone");
assert.equal(voyagerMilestoneKey("2026-11-18T00:00:00Z"), "mission.milestoneReached");
assert.equal(voyagerMilestoneKey("2026-11-20T00:00:00+00:00"), "mission.milestoneReached");
assert.equal(voyagerMilestoneKey("not a time"), null);
for (const strings of Object.values(SPACECRAFT_TRANSLATIONS)) {
  assert.ok(strings["mission.milestoneReached"]?.includes("2026"));
  assert.notEqual(strings["mission.milestoneReached"], strings["mission.milestone"]);
}

const pending: { resolve: (r: Response) => void; url: string; signal?: AbortSignal | null }[] = [];
const applied: unknown[] = [];
const fetcher = ((url: string, options: RequestInit) => new Promise<Response>(resolve => pending.push({ resolve, url, signal: options.signal }))) as typeof fetch;
const loader = new SpacecraftLoader(bodies => applied.push(bodies), () => mission.key, fetcher);
loader.start(oldEpoch);
loader.start(newEpoch);
assert.equal(pending[0].signal?.aborted, true);
assert.ok(pending[1].url.includes("key=spacecraft-31"));
pending[0].resolve(new Response(JSON.stringify({ timestamp_utc: oldEpoch, bodies: [] })));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(applied.length, 0, "late old epoch must not be merged");
pending[1].resolve(new Response(JSON.stringify({ timestamp_utc: newEpoch, bodies: [] })));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(applied.length, 1);
loader.stop();

// A failed poll keeps a mission outside its trajectory coverage outside it.
const cassini = missions.find(b => b.key === "spacecraft-82")!.spacecraft!;
assert.equal(inSpacecraftCoverage(cassini, "2010-01-01T00:00:00Z"), true);
assert.equal(inSpacecraftCoverage(cassini, "2026-09-06T00:00:00Z"), false);
assert.equal(inSpacecraftCoverage(cassini, "1997-10-15T09:00:00Z"), false);
// The mission ended at 10:31 UTC, before the end of the trajectory.
assert.equal(inSpacecraftCoverage(cassini, "2017-09-15T10:30:00Z"), true);
assert.equal(inSpacecraftCoverage(cassini, "2017-09-15T10:31:00Z"), false);
// The trajectory ends at 2017-09-15 11:58:00 TDB, which is 11:56:51 UTC.
const trajectoryOnly = { ...cassini, end_utc: undefined };
assert.equal(inSpacecraftCoverage(trajectoryOnly, "2017-09-15T11:56:30Z"), true);
assert.equal(inSpacecraftCoverage(trajectoryOnly, "2017-09-15T11:57:30Z"), false);
const failed: Body[][] = [];
const failing = new SpacecraftLoader(bodies => failed.push(bodies), () => "", (() => Promise.resolve(new Response("", { status: 500 }))) as typeof fetch);
failing.start(oldEpoch);
await new Promise(resolve => setTimeout(resolve, 0));
failing.stop();
assert.equal(failed.length, 1);
const availability = (bodies: Body[], key: string) => bodies.find(b => b.key === key)?.spacecraft?.availability;
assert.equal(availability(failed[0], "spacecraft-82"), "out_of_coverage");
assert.equal(availability(failed[0], "spacecraft-31"), "temporarily_unavailable");
for (const body of failed[0]) assert.equal(body.spacecraft!.availability, inSpacecraftCoverage(body.spacecraft!, oldEpoch) ? "temporarily_unavailable" : "out_of_coverage");
console.log("Spacecraft metadata, missing positions, translations and obsolete responses passed.");
