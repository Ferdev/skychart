import { clamp } from "../geometry.ts";
import type { SkyCamera, Vector3 } from "../sky/skyProjection.ts";
import { cameraForDirection } from "../sky/skyProjection.ts";
import { universeCameraBasis, type UniverseMove } from "./universeNavigation.ts";

type FlightAxis = "forward" | "right" | "up";
export type FlightVelocity = Record<FlightAxis, number>;

/** Seconds for thrust from rest to reach roughly the base speed. */
const RAMP_SECONDS = 0.4;
/** Held thrust doubles the speed this often, so one control spans cosmic scales. */
const DOUBLING_RATE = Math.LN2 / 0.8;
const BRAKE_RATE = 6;
const DRAG_SECONDS = 0.5;
const REST_FACTOR = 0.01;
/** Each doubling above the base speed shortens the next one, so a single long
 * hold reaches from planetary to intergalactic speeds in about twelve seconds. */
const DOUBLING_GAIN = 0.1;
const THRUST_SUBSTEP_SECONDS = 1 / 240;
/** Crosses the observable universe in under a second; nothing needs more. */
export const MAX_SPEED_AU_S = 1e16;
const AU_KM = 149_597_870.7;
/** Autopilot closes this fraction of the remaining distance per second. */
const APPROACH_RATE = 2;
const AUTOPILOT_RAMP_SECONDS = 0.8;
/** Seconds a direct autopilot leg would take at its steady cruise speed. */
const AUTOPILOT_CRUISE_SECONDS = 4;
const TURN_SECONDS = 0.25;
const MIN_THROTTLE = 0.25;
const MAX_THROTTLE = 4;

const AXES: Record<UniverseMove, readonly [FlightAxis, 1 | -1]> = {
  forward: ["forward", 1], back: ["forward", -1], right: ["right", 1],
  left: ["right", -1], up: ["up", 1], down: ["up", -1],
};

/** One thruster axis: held input accelerates, opposite input brakes, release
 * coasts down to rest (or holds the speed under cruise control). */
export function thrustAxis(speed: number, input: number, baseSpeed: number, seconds: number, cruise = false): number {
  const magnitude = Math.abs(speed);
  if (input === 0) {
    if (cruise) return Math.sign(speed) * Math.min(magnitude, MAX_SPEED_AU_S);
    const next = magnitude * Math.exp(-seconds / DRAG_SECONDS);
    return next < baseSpeed * REST_FACTOR ? 0 : Math.sign(speed) * next;
  }
  const push = baseSpeed / RAMP_SECONDS;
  if (speed * input < 0) {
    const braked = (magnitude + push / BRAKE_RATE) * Math.exp(-BRAKE_RATE * seconds) - push / BRAKE_RATE;
    return braked <= 0 ? 0 : Math.sign(speed) * braked;
  }
  // The growth rate depends on the speed, so integrate in short fixed steps to
  // keep the result independent of the display frame rate.
  const steps = Math.max(1, Math.ceil(seconds / THRUST_SUBSTEP_SECONDS));
  let next = magnitude;
  for (let step = 0; step < steps && next < MAX_SPEED_AU_S; step += 1) {
    const rate = DOUBLING_RATE * (1 + DOUBLING_GAIN * Math.max(0, Math.log2(next / baseSpeed)));
    next = (next + push / rate) * Math.exp(rate * seconds / steps) - push / rate;
  }
  return input * Math.min(MAX_SPEED_AU_S, next);
}

/** Thruster base speed for the surroundings: a quarter of the gap to the nearest
 * object per second (to its surface when the radius is known). A tap then moves
 * a sensible step beside a moon and between galaxies alike. */
export function thrustScale(position: Vector3, landmarks: Iterable<{ position: Vector3; radiusKm?: number | null }>, fallback: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const landmark of landmarks) {
    const distance = Math.hypot(landmark.position.x - position.x, landmark.position.y - position.y, landmark.position.z - position.z);
    const radius = Math.max(0, landmark.radiusKm ?? 0) / AU_KM;
    const gap = Math.max(Math.abs(distance - radius), radius * 0.01);
    if (gap > 0 && gap < nearest) nearest = gap;
  }
  return Number.isFinite(nearest) ? nearest * 0.25 : fallback;
}

/** Distance an autopilot leg covers this frame: it ramps up from the current
 * speed, then sheds speed in proportion to the remaining distance so arrival is
 * a smooth stop instead of a constant-speed halt. */
export function autopilotTravel(speed: number, remaining: number, floorSpeed: number, seconds: number, throttle = 1,
  legDistance = 0): number {
  if (remaining <= 0 || seconds <= 0) return 0;
  const rate = APPROACH_RATE * throttle;
  // Cruise: most of a long leg is flown at a steady speed, so the progress is
  // visible on the trip map instead of being over in the first instant.
  const cruise = legDistance > 0 ? Math.max(legDistance * throttle / AUTOPILOT_CRUISE_SECONDS, floorSpeed) : Number.POSITIVE_INFINITY;
  const desired = Math.min(Math.max(remaining * rate, floorSpeed), cruise);
  const ramped = speed + (desired - speed) * (1 - Math.exp(-seconds / AUTOPILOT_RAMP_SECONDS));
  const closing = Math.min(remaining * (1 - Math.exp(-rate * seconds)), cruise * seconds);
  return Math.min(remaining, Math.max(Math.min(ramped * seconds, closing), floorSpeed * seconds));
}

/** Ease the camera toward a direction along the shortest yaw arc. */
export function turnCameraToward(camera: SkyCamera, direction: Vector3, seconds: number): SkyCamera {
  const goal = cameraForDirection(direction, camera.fovDeg);
  const yawDelta = ((goal.yawDeg - camera.yawDeg) % 360 + 540) % 360 - 180;
  const pitchDelta = goal.pitchDeg - camera.pitchDeg;
  if (Math.abs(yawDelta) < 0.02 && Math.abs(pitchDelta) < 0.02) return goal;
  const blend = 1 - Math.exp(-seconds / TURN_SECONDS);
  return { ...goal, yawDeg: camera.yawDeg + yawDelta * blend, pitchDeg: camera.pitchDeg + pitchDelta * blend };
}

/** Camera-relative velocity of the free-flight observer, in AU per second. */
export class UniverseFlight {
  readonly velocity: FlightVelocity = { forward: 0, right: 0, up: 0 };
  /** Autopilot rate multiplier, adjusted with the forward/back thrusters. */
  throttle = 1;

  get moving(): boolean {
    return this.velocity.forward !== 0 || this.velocity.right !== 0 || this.velocity.up !== 0;
  }

  stop(): void {
    this.velocity.forward = this.velocity.right = this.velocity.up = 0;
    this.throttle = 1;
  }

  /** Add an impulse, as from a wheel notch or a key tap. */
  kick(movement: UniverseMove, speed: number): void {
    const [axis, sign] = AXES[movement];
    this.velocity[axis] = clamp(this.velocity[axis] + sign * speed, -MAX_SPEED_AU_S, MAX_SPEED_AU_S);
  }

  /** Advance the velocity for one frame. `cruise` holds the forward speed with
   * no input; `tracking` hands the forward axis to an autopilot leg, where
   * forward/back thrust changes the throttle instead. */
  thrust(held: Iterable<UniverseMove>, baseSpeed: number, seconds: number,
    mode: { cruise?: boolean; tracking?: boolean } = {}): void {
    const input: FlightVelocity = { forward: 0, right: 0, up: 0 };
    for (const movement of held) input[AXES[movement][0]] += AXES[movement][1];
    this.velocity.right = thrustAxis(this.velocity.right, input.right, baseSpeed, seconds);
    this.velocity.up = thrustAxis(this.velocity.up, input.up, baseSpeed, seconds);
    if (mode.tracking) {
      this.velocity.forward = 0;
      this.adjustThrottle(input.forward * seconds * 2);
    } else if (mode.cruise && input.forward === 0 && this.velocity.forward < baseSpeed) {
      this.velocity.forward = Math.min(baseSpeed, thrustAxis(this.velocity.forward, 1, baseSpeed, seconds));
    } else {
      this.velocity.forward = thrustAxis(this.velocity.forward, input.forward, baseSpeed, seconds, mode.cruise);
    }
  }

  /** Scale the autopilot throttle by a power of two. */
  adjustThrottle(octaves: number): void {
    this.throttle = clamp(this.throttle * 2 ** octaves, MIN_THROTTLE, MAX_THROTTLE);
  }

  /** Position after coasting along the current camera axes for one frame. */
  advance(position: Vector3, camera: SkyCamera, seconds: number): Vector3 {
    if (!this.moving) return position;
    const basis = universeCameraBasis(camera.yawDeg, camera.pitchDeg);
    const { forward, right, up } = this.velocity;
    return {
      x: position.x + (basis.forward.x * forward + basis.right.x * right + basis.up.x * up) * seconds,
      y: position.y + (basis.forward.y * forward + basis.right.y * right + basis.up.y * up) * seconds,
      z: position.z + (basis.forward.z * forward + basis.right.z * right + basis.up.z * up) * seconds,
    };
  }
}
