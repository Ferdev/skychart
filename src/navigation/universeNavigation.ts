import { clamp } from "../geometry.ts";
import type { Vector3 } from "../sky/skyProjection.ts";
import { cameraForDirection, relativeDirection } from "../sky/skyProjection.ts";
import type { UniverseViewState } from "../viewState.ts";

export type UniverseMove = "forward" | "back" | "left" | "right" | "up" | "down";

const DEG_TO_RAD = Math.PI / 180;

export function universeCameraBasis(yawDeg: number, pitchDeg: number) {
  const yaw = yawDeg * DEG_TO_RAD;
  const pitch = clamp(pitchDeg, -89.5, 89.5) * DEG_TO_RAD;
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
