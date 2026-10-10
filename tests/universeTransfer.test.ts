import assert from "node:assert/strict";
import {
  centralBody, gravityBodies, planTransfer, playbackTimeFraction, transferPosition, transferSpeed, type GravityBody, type TransferPlan,
} from "../src/navigation/universeTransfer.ts";
import { formatDuration, formatLightSpeeds, formatSpeed, LIGHT_SPEED_AU_S, speedGaugeFraction } from "../src/universe/universeFormat.ts";

const AU_KM = 149_597_870.7;
const DAY = 86_400;
const body = (key: string, x: number, y: number, radius_km: number) => ({ key, name: key, radius_km, position: { x_au: x, y_au: y, z_au: 0 } });
const bodies: GravityBody[] = gravityBodies([
  body("sun", 0, 0, 695_700), body("earth", 1, 0, 6_371), body("mars", -1.524, 0, 3_389.5),
  body("moon", 1.00257, 0, 1_737.4), body("vesta", 2.4, 0, 262),
]);
assert.deepEqual(bodies.map((item) => item.key), ["sun", "earth", "mars"], "only bodies with a known gravitational parameter attract");
const sun = bodies[0]!;
const radius = (plan: TransferPlan, index: number) => Math.hypot(plan.points[index]!.x - plan.center.position.x,
  plan.points[index]!.y - plan.center.position.y, plan.points[index]!.z - plan.center.position.z);
const planned = (start: [number, number, number], end: [number, number, number]) => {
  const result = planTransfer({ x: start[0], y: start[1], z: start[2] }, { x: end[0], y: end[1], z: end[2] }, bodies);
  assert.ok("plan" in result, `expected a plan, got ${JSON.stringify(result)}`);
  return result.plan;
};

// Earth to Mars at opposition is the Hohmann transfer: about 259 days.
const hohmann = planned([1.05, 0, 0], [-1.524, 0, 0]);
assert.equal(hohmann.center.key, "sun");
assert.ok(Math.abs(hohmann.semiMajorAu - (1.05 + 1.524) / 2) < 1e-12);
assert.ok(Math.abs(hohmann.durationSeconds / DAY - 266) < 3, `Hohmann-like duration ${hohmann.durationSeconds / DAY} d`);
assert.equal(hohmann.prograde, true);
const middle = hohmann.points[hohmann.points.length >> 1]!;
assert.ok(middle.y > 1 && Math.abs(middle.z) < 1e-12, "a prograde transfer leaves counterclockwise in the ecliptic plane");
const departure = transferSpeed(hohmann, hohmann.points[0]!) * AU_KM;
assert.ok(departure > 30 && departure < 34, `departure speed ${departure} km/s`);

// Every plan is a Kepler orbit: points lie on one conic and sweep equal areas in equal times.
for (const end of [[0, 1.524, 0], [0, -1.524, 0], [-1.2, 0.6, 0.3], [5.2, 0.1, 0]] as const) {
  const plan = planned([1.05, 0, 0], [...end]);
  assert.deepEqual(plan.points[0], { x: 1.05, y: 0, z: 0 });
  assert.deepEqual(plan.points.at(-1), { x: end[0], y: end[1], z: end[2] });
  const arealRate = Math.sqrt(sun.muAu3S2 * plan.semiMajorAu * (1 - plan.eccentricity ** 2)) / 2;
  for (let index = 1; index < plan.points.length; index += 1) {
    const a = plan.points[index - 1]!;
    const b = plan.points[index]!;
    assert.ok(plan.times[index]! > plan.times[index - 1]!, "time must increase along the arc");
    const area = Math.hypot(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x) / 2;
    const rate = area / (plan.times[index]! - plan.times[index - 1]!);
    assert.ok(Math.abs(rate / arealRate - 1) < 0.01, `areal rate ${rate} vs ${arealRate}`);
    const energy = transferSpeed(plan, b) ** 2 / 2 - sun.muAu3S2 / radius(plan, index);
    assert.ok(Math.abs(energy / (-sun.muAu3S2 / (2 * plan.semiMajorAu)) - 1) < 1e-9);
  }
  assert.ok(plan.prograde);
  const angularMomentumZ = plan.points[0]!.x * plan.points[1]!.y - plan.points[0]!.y * plan.points[1]!.x;
  assert.ok(angularMomentumZ > 0, "prograde plans turn counterclockwise seen from ecliptic north");
}
const quarter = planned([1.05, 0, 0], [0, 1.524, 0]);
const threeQuarter = planned([1.05, 0, 0], [0, -1.524, 0]);
// The two targets mirror each other, so the short and long arcs together make one full orbit.
assert.ok(threeQuarter.durationSeconds > quarter.durationSeconds, "the long way around takes longer");
const period = 2 * Math.PI * Math.sqrt(quarter.semiMajorAu ** 3 / sun.muAu3S2);
assert.ok(Math.abs((quarter.durationSeconds + threeQuarter.durationSeconds) / period - 1) < 1e-9);

// Positions interpolate along the plan, clamped to its ends.
assert.deepEqual(transferPosition(hohmann, -1), hohmann.points[0]);
assert.deepEqual(transferPosition(hohmann, 2), hohmann.points.at(-1));
const halfway = transferPosition(hohmann, 0.5);
assert.ok(halfway.y > 0.5 && Math.hypot(halfway.x, halfway.y) > 1.05 && Math.hypot(halfway.x, halfway.y) < 1.524);

// A leg inside a planet's sphere of influence orbits the planet, not the Sun.
assert.equal(centralBody({ x: 1.0005, y: 0, z: 0 }, { x: 1.0025, y: 0.0001, z: 0 }, bodies)!.key, "earth");
const lunar = planned([1.0005, 0, 0], [1, 0.00257, 0]);
assert.equal(lunar.center.key, "earth");
assert.ok(lunar.durationSeconds / DAY > 1 && lunar.durationSeconds / DAY < 10, `Earth-Moon coast ${lunar.durationSeconds / DAY} d`);

// An arc that would dip into the Sun flies the other way around instead.
const grazing = planned([1.05, 0, 0], [0.3 * Math.cos(-0.17), 0.3 * Math.sin(-0.17), 0]);
assert.equal(grazing.prograde, false);
assert.ok(grazing.points.every((_, index) => radius(grazing, index) >= 0.3 - 1e-9), "the retrograde arc avoids periapsis");

// Outside the Sun's reach, or straight toward the body, there is no transfer orbit.
assert.deepEqual(planTransfer({ x: 1.05, y: 0, z: 0 }, { x: 250_000, y: 0, z: 0 }, bodies), { unavailable: "range" });
assert.deepEqual(planTransfer({ x: 2, y: 0, z: 0 }, { x: 1.2, y: 0, z: 0 }, bodies), { unavailable: "radial" });
assert.deepEqual(planTransfer({ x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, bodies), { unavailable: "radial" });
assert.deepEqual(planTransfer({ x: 2, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, []), { unavailable: "range" });

// Playback eases in and out but always covers the whole flight.
assert.equal(playbackTimeFraction(0), 0);
assert.equal(playbackTimeFraction(1), 1);
assert.equal(playbackTimeFraction(7), 1);
assert.ok(playbackTimeFraction(0.01) < 0.001 && 1 - playbackTimeFraction(0.99) < 0.001);
for (let step = 1; step <= 100; step += 1) assert.ok(playbackTimeFraction(step / 100) > playbackTimeFraction((step - 1) / 100));

// Speeds read as multiples of light speed, and the gauge is logarithmic.
assert.ok(Math.abs(LIGHT_SPEED_AU_S - 0.0020039888) < 1e-9);
assert.equal(formatLightSpeeds(LIGHT_SPEED_AU_S), "1 c");
assert.equal(formatLightSpeeds(1), "499 c");
assert.equal(formatLightSpeeds(0), "0 c");
assert.equal(formatLightSpeeds(1e9), "499 billion c");
assert.equal(formatLightSpeeds(2e-7), "0.0000998 c");
assert.equal(formatSpeed(1), "1 AU/s · 499 c");
assert.equal(formatSpeed(0), "0 km/s · 0 c");
assert.equal(speedGaugeFraction(0), 0);
assert.equal(speedGaugeFraction(1e-30), 0);
assert.equal(speedGaugeFraction(1e30), 1);
assert.equal(speedGaugeFraction(1), 9 / 25);
assert.ok(speedGaugeFraction(LIGHT_SPEED_AU_S) > 0.25 && speedGaugeFraction(LIGHT_SPEED_AU_S) < 0.26);
assert.equal(formatDuration(259 * DAY), "259 d");
assert.equal(formatDuration(5 * 3_600), "5 h");
assert.equal(formatDuration(12 * 365.25 * DAY), "12 yr");

console.log("universe transfer tests passed");
