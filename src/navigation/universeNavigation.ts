import { clamp } from "../geometry.ts";
import type { SkyCamera, Vector3 } from "../sky/skyProjection.ts";
import { cameraForDirection, normalizeFreeCamera, relativeDirection } from "../sky/skyProjection.ts";
import type { UniverseViewState } from "../viewState.ts";

export type UniverseMove = "forward" | "back" | "left" | "right" | "up" | "down";

const DEG_TO_RAD = Math.PI / 180;

export function universeCameraBasis(yawDeg: number, pitchDeg: number) {
  const yaw = yawDeg * DEG_TO_RAD;
  // No pitch limit: past 90 degrees the camera has turned over the pole and is upside down.
  const pitch = pitchDeg * DEG_TO_RAD;
  return {
    forward: {
      x: Math.cos(pitch) * Math.cos(yaw),
      y: Math.cos(pitch) * Math.sin(yaw),
      z: Math.sin(pitch),
    },
    right: { x: -Math.sin(yaw), y: Math.cos(yaw), z: 0 },
    up: {
      x: -Math.sin(pitch) * Math.cos(yaw),
      y: -Math.sin(pitch) * Math.sin(yaw),
      z: Math.cos(pitch),
    },
  };
}

/** True when the camera has turned over a pole, so the view is upside down. */
export function cameraUpsideDown(pitchDeg: number): boolean {
  return Math.cos(pitchDeg * DEG_TO_RAD) < 0;
}

/**
 * Yaw change for a horizontal look input (a drag or an arrow key).
 * Upside down, a turn about the ecliptic pole moves the view the other way on the screen,
 * so the sign changes and the sky still follows the pointer.
 */
export function lookYawDelta(pitchDeg: number, screenDeltaDeg: number): number {
  return cameraUpsideDown(pitchDeg) ? screenDeltaDeg : -screenDeltaDeg;
}

/** Ecliptic direction of flight, in degrees, for the trip map. Over a pole it is opposite to the yaw. */
export function cameraHeadingDeg(yawDeg: number, pitchDeg: number): number {
  return cameraUpsideDown(pitchDeg) ? (yawDeg + 180) % 360 : yawDeg;
}

/**
 * Turn the camera for a look input: `rightDeg` is a drag to the right, `downDeg` a drag down.
 * There is no pitch limit: a turn past a pole continues over it.
 */
export function lookCamera(camera: SkyCamera, rightDeg: number, downDeg: number): SkyCamera {
  return normalizeFreeCamera({ ...camera,
    yawDeg: camera.yawDeg + lookYawDelta(camera.pitchDeg, rightDeg), pitchDeg: camera.pitchDeg + downDeg });
}

const ARROW_LOOK: Record<string, readonly [number, number]> = {
  ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
};

/** The camera after an arrow key: 3 degrees, or 10 with Shift. Null for other keys. */
export function arrowLookCamera(camera: SkyCamera, key: string, shift: boolean): SkyCamera | null {
  const look = ARROW_LOOK[key];
  const step = shift ? 10 : 3;
  return look ? lookCamera(camera, look[0] * step, look[1] * step) : null;
}

export function moveUniversePosition(
  position: Vector3,
  yawDeg: number,
  pitchDeg: number,
  movement: UniverseMove,
  distanceAu: number,
): Vector3 {
  const basis = universeCameraBasis(yawDeg, pitchDeg);
  const [axis, sign] = movement === "forward" ? [basis.forward, 1]
    : movement === "back" ? [basis.forward, -1]
      : movement === "right" ? [basis.right, 1]
        : movement === "left" ? [basis.right, -1]
          : movement === "up" ? [basis.up, 1]
            : [basis.up, -1];
  return {
    x: position.x + axis.x * distanceAu * sign,
    y: position.y + axis.y * distanceAu * sign,
    z: position.z + axis.z * distanceAu * sign,
  };
}

export type EntryAimCandidate = { key: string; position: Vector3; major: boolean };

/**
 * What the 3D view looks at when it starts with no selected object:
 * the Sun when the Sun is in the 2D view, and the nearest major object in other cases.
 * `viewHalfWidthAu` is half of the width of the 2D view.
 */
export function universeEntryAim(
  center: { x: number; y: number }, viewHalfWidthAu: number, candidates: Iterable<EntryAimCandidate>,
): Vector3 | undefined {
  let nearest: { position: Vector3; distance: number } | null = null;
  for (const candidate of candidates) {
    const { x, y, z } = candidate.position;
    if (![x, y, z].every(Number.isFinite)) continue;
    if (candidate.key === "sun" && Math.abs(x - center.x) <= viewHalfWidthAu && Math.abs(y - center.y) <= viewHalfWidthAu) return candidate.position;
    if (!candidate.major) continue;
    const distance = Math.hypot(x - center.x, y - center.y, z);
    if (distance > 0 && (!nearest || distance < nearest.distance)) nearest = { position: candidate.position, distance };
  }
  return nearest?.position;
}

/**
 * Enter 3D from the 2D map center. The view aims at the selected object.
 * With no selected object it aims at `fallbackAim` (see `universeEntryAim`).
 */
export function universeEntryState(
  center: { x: number; y: number }, moveStepAu: number, selected?: Vector3, fallbackAim?: Vector3,
): UniverseViewState {
  const step = clamp(moveStepAu, 1e-12, 1e18);
  const position = { x: center.x, y: center.y, z: 0 };
  const aim = selected && [selected.x, selected.y, selected.z].every(Number.isFinite) ? selected : fallbackAim;
  if (aim && [aim.x, aim.y, aim.z].every(Number.isFinite)) {
    let direction = relativeDirection(position, aim);
    if (!direction) {
      position.x += step;
      direction = relativeDirection(position, aim);
    }
    if (direction) return { positionAu: position, ...cameraForDirection(direction), moveStepAu: step };
  }
  return { positionAu: position, yawDeg: 180, pitchDeg: 0, fovDeg: 72, moveStepAu: step };
}
