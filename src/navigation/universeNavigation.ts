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

/** Enter 3D from the 2D map center and aim at its selected object when possible. */
export function universeEntryState(
  center: { x: number; y: number }, moveStepAu: number, selected?: Vector3,
): UniverseViewState {
  const step = clamp(moveStepAu, 1e-12, 1e18);
  const position = { x: center.x, y: center.y, z: 0 };
  if (selected && [selected.x, selected.y, selected.z].every(Number.isFinite)) {
    let direction = relativeDirection(position, selected);
    if (!direction) {
      position.x += step;
      direction = relativeDirection(position, selected);
    }
    if (direction) return { positionAu: position, ...cameraForDirection(direction), moveStepAu: step };
  }
  return { positionAu: position, yawDeg: 180, pitchDeg: 0, fovDeg: 72, moveStepAu: step };
}
