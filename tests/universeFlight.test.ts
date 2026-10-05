import assert from "node:assert/strict";
import { autopilotTravel, MAX_SPEED_AU_S, thrustAxis, thrustScale, turnCameraToward, UniverseFlight } from "../src/navigation/universeFlight.ts";
import { UniverseRenderQuality } from "../src/universe/universeRenderQuality.ts";

const FRAME = 1 / 60;
const run = (seconds: number, step: () => void) => { for (let t = 0; t < seconds - 1e-9; t += FRAME) step(); };

// Held thrust keeps accelerating: the longer the hold, the higher the speed.
const flight = new UniverseFlight();
const speeds: number[] = [];
for (const hold of [0.5, 1, 1, 2]) {
  run(hold, () => flight.thrust(["forward"], 1, FRAME));
  speeds.push(flight.velocity.forward);
}
assert.ok(speeds[0]! > 0.9 && speeds[0]! < 3, `half a second of thrust is near the base speed: ${speeds[0]}`);
assert.ok(speeds.every((speed, index) => index === 0 || speed > speeds[index - 1]! * 2), `speed must keep growing: ${speeds}`);
// Each doubling comes sooner than the last: ten seconds of thrust spans far
// more than ten doublings, and a long hold reaches the absolute speed limit.
const sustained = new UniverseFlight();
run(5, () => sustained.thrust(["forward"], 1, FRAME));
assert.ok(sustained.velocity.forward > 500 && sustained.velocity.forward < 5_000, `five seconds: ${sustained.velocity.forward}`);
run(5, () => sustained.thrust(["forward"], 1, FRAME));
assert.ok(sustained.velocity.forward > 1e8 && sustained.velocity.forward < 1e13, `ten seconds: ${sustained.velocity.forward}`);
run(20, () => flight.thrust(["forward"], 1, FRAME));
assert.equal(flight.velocity.forward, MAX_SPEED_AU_S);
flight.velocity.forward = 4_000;

// The result must not depend on the frame rate.
const coarse = new UniverseFlight();
const fine = new UniverseFlight();
for (let index = 0; index < 20; index++) coarse.thrust(["forward"], 1, 0.1);
for (let index = 0; index < 200; index++) fine.thrust(["forward"], 1, 0.01);
assert.ok(Math.abs(coarse.velocity.forward / fine.velocity.forward - 1) < 1e-3);

// Release coasts smoothly to a full stop; no frame gains speed.
let previous = flight.velocity.forward;
run(0.5, () => {
  flight.thrust([], 1, FRAME);
  assert.ok(flight.velocity.forward < previous);
  previous = flight.velocity.forward;
});
assert.ok(flight.moving);
run(8, () => flight.thrust([], 1, FRAME));
assert.equal(flight.moving, false);

// Reverse thrust brakes faster than drag, then accelerates backward.
assert.ok(thrustAxis(100, -1, 1, 0.25) < thrustAxis(100, 0, 1, 0.25));
const reverse = new UniverseFlight();
reverse.kick("forward", 50);
run(3, () => reverse.thrust(["back"], 1, FRAME));
assert.ok(reverse.velocity.forward < -1);

// Opposite inputs cancel, axes are independent, and position follows the camera.
const strafe = new UniverseFlight();
strafe.thrust(["forward", "back", "right"], 2, 0.5);
assert.equal(strafe.velocity.forward, 0);
assert.ok(strafe.velocity.right > 0);
const moved = strafe.advance({ x: 0, y: 0, z: 0 }, { yawDeg: 0, pitchDeg: 0, fovDeg: 72 }, 1);
assert.ok(moved.y > 0 && Math.abs(moved.x) < 1e-12 && moved.z === 0);

// A tap or wheel notch is an impulse that glides about half a base step.
const tap = new UniverseFlight();
tap.kick("forward", 1);
let glide = 0;
run(6, () => { glide += tap.velocity.forward * FRAME; tap.thrust([], 1, FRAME); });
assert.ok(glide > 0.4 && glide < 0.6, `tap glide ${glide}`);
assert.equal(tap.moving, false);

// Cruise control holds the forward speed and restores at least the base speed.
const cruise = new UniverseFlight();
run(3, () => cruise.thrust([], 5, FRAME, { cruise: true }));
assert.equal(cruise.velocity.forward, 5);
run(1, () => cruise.thrust(["forward"], 5, FRAME, { cruise: true }));
const boosted = cruise.velocity.forward;
assert.ok(boosted > 5);
run(3, () => cruise.thrust([], 5, FRAME, { cruise: true }));
assert.equal(cruise.velocity.forward, boosted);

// Autopilot accelerates, then decelerates into the standoff at every scale.
for (const [distance, standoff] of [[5, 0.0014], [632_000, 0.1], [1.6e11, 2e10], [3e15, 1e9]] as const) {
  let remaining = distance - standoff;
  let speed = 0;
  let peak = 0;
  let seconds = 0;
  const profile: number[] = [];
  while (remaining > 0 && seconds < 60) {
    const travel = autopilotTravel(speed, remaining, standoff * 0.03, FRAME);
    assert.ok(travel > 0 && travel <= remaining);
    speed = travel / FRAME;
    remaining -= travel;
    peak = Math.max(peak, speed);
    profile.push(speed);
    seconds += FRAME;
  }
  assert.equal(remaining, 0, `autopilot must arrive from ${distance} AU`);
  assert.ok(seconds > 2 && seconds < 30, `trip from ${distance} AU took ${seconds} s`);
  assert.ok(profile[0]! < peak * 0.1, "autopilot starts gently");
  assert.ok(profile.at(-1)! <= standoff * 0.03 * 1.0001, "autopilot arrives at approach speed");
  assert.ok(profile.at(-1)! < peak * 0.05, `final speed ${profile.at(-1)} must be far below the peak ${peak}`);
  const peakIndex = profile.indexOf(peak);
  assert.ok(profile.slice(peakIndex).every((value, index, tail) => index === 0 || value <= tail[index - 1]! * 1.0001), "no speed-up after the peak");
}

// A long leg cruises at a steady speed for most of the distance, so the craft
// moves visibly across the trip map, and it still decelerates into the standoff.
for (const [distance, standoff] of [[5, 0.0014], [632_000, 0.1], [1.6e11, 2e10], [3e15, 1e9]] as const) {
  const leg = distance - standoff;
  let remaining = leg;
  let speed = 0;
  let seconds = 0;
  let cruiseSeconds = 0;
  let halfwayAt = 0;
  const profile: number[] = [];
  while (remaining > 0 && seconds < 60) {
    const travel = autopilotTravel(speed, remaining, standoff * 0.03, FRAME, 1, leg);
    speed = travel / FRAME;
    remaining -= travel;
    seconds += FRAME;
    profile.push(speed);
    assert.ok(speed <= Math.max(leg / 4, standoff * 0.03) * 1.0001, "cruise speed is never exceeded");
    if (speed > leg / 4 * 0.98) cruiseSeconds += FRAME;
    if (!halfwayAt && remaining <= leg / 2) halfwayAt = seconds;
  }
  assert.equal(remaining, 0, `cruising autopilot must arrive from ${distance} AU`);
  assert.ok(seconds < 30, `cruising trip from ${distance} AU took ${seconds} s`);
  if (leg / 4 > standoff) {
    assert.ok(halfwayAt > 1.5 && halfwayAt < 4, `half of the leg takes seconds, not an instant: ${halfwayAt}`);
    assert.ok(cruiseSeconds > 1, `steady cruise lasted ${cruiseSeconds} s`);
    assert.ok(profile.at(-1)! < leg / 4 * 0.05, "the craft still decelerates into the standoff");
  }
}
assert.ok(autopilotTravel(0, 1000, 1, FRAME, 4, 1000) > autopilotTravel(0, 1000, 1, FRAME, 1, 1000), "throttle raises the cruise speed");

// The forward/back thrusters change the autopilot throttle within bounds.
const tracking = new UniverseFlight();
run(10, () => tracking.thrust(["forward"], 1, FRAME, { tracking: true }));
assert.equal(tracking.throttle, 4);
assert.equal(tracking.velocity.forward, 0);
assert.ok(autopilotTravel(100, 1000, 1, FRAME, 4) > autopilotTravel(100, 1000, 1, FRAME, 1));
run(10, () => tracking.thrust(["back"], 1, FRAME, { tracking: true }));
assert.equal(tracking.throttle, 0.25);
tracking.stop();
assert.equal(tracking.throttle, 1);

// The camera turns the short way through the 0°/360° seam and settles on the target.
let camera = { yawDeg: 350, pitchDeg: 0, fovDeg: 60 };
const target = { x: Math.cos(Math.PI / 18), y: Math.sin(Math.PI / 18), z: 0 };
const first = turnCameraToward(camera, target, FRAME);
assert.ok(first.yawDeg > 350 && first.yawDeg < 352, `first turn step ${first.yawDeg}`);
run(4, () => { camera = turnCameraToward(camera, target, FRAME); });
assert.ok(Math.abs(camera.yawDeg - 10) < 1e-9 && camera.fovDeg === 60);

// With no manual speed control, the thrusters scale to the nearest object:
// to its surface when it has a radius, to its position otherwise.
const AU_KM = 149_597_870.7;
const landmarks = [
  { position: { x: 5, y: 0, z: 0 }, radiusKm: AU_KM },
  { position: { x: 0, y: 2, z: 0 } },
  { position: { x: 0, y: 0, z: 0 } },
];
assert.equal(thrustScale({ x: 0, y: 0, z: 0 }, landmarks, 7), 0.5);
assert.ok(Math.abs(thrustScale({ x: 3.6, y: 0, z: 0 }, landmarks, 7) - 0.1) < 1e-12);
assert.ok(thrustScale({ x: 5, y: 0, z: 0 }, landmarks, 7) > 0, "inside a body the scale stays positive");
assert.equal(thrustScale({ x: 0, y: 0, z: 0 }, [], 7), 7);

// Render detail stays full in motion on a fast device, drops only after a run
// of slow frames, recovers slowly, and is always full for a still scene.
let clock = 0;
const frames = (quality: UniverseRenderQuality, count: number, interval: number, animating = true) => {
  let level = 1;
  for (let index = 0; index < count; index += 1) level = quality.frame(clock += interval, animating);
  return level;
};
const fastDevice = new UniverseRenderQuality();
assert.equal(frames(fastDevice, 600, 16.7), 1);
frames(fastDevice, 1, 300);
assert.equal(frames(fastDevice, 5, 16.7), 1, "a single long frame does not lower the detail");
const slowDevice = new UniverseRenderQuality();
assert.ok(frames(slowDevice, 12, 60) < 0.7, "a run of slow frames lowers the detail");
assert.ok(frames(slowDevice, 200, 120) >= 0.4, "the detail has a floor");
assert.equal(frames(slowDevice, 1, 16.7, false), 1, "a still scene is always drawn at full detail");
frames(slowDevice, 1, 16.7);
const recovering = frames(slowDevice, 60, 16.7);
assert.ok(recovering < 0.5, "the detail does not bounce back at once");
assert.ok(frames(slowDevice, 1200, 16.7) > recovering, "sustained fast frames raise the detail again");
assert.equal(frames(new UniverseRenderQuality(true), 2, 16.7), 0.4, "a software rasterizer starts low");

console.log("universe flight tests passed");
