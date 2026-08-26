import { clamp } from "../geometry.ts";

export type Vector3 = { x: number; y: number; z: number };

export type SkyCamera = {
  yawDeg: number;
  pitchDeg: number;
  fovDeg: number;
};

export type SkyProjection = {
  x: number;
  y: number;
  depth: number;
};

const DEG_TO_RAD = Math.PI / 180;

export function normalizeVector(vector: Vector3): Vector3 | null {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 1e-12) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

export function relativeDirection(observer: Vector3, target: Vector3): Vector3 | null {
  return normalizeVector({ x: target.x - observer.x, y: target.y - observer.y, z: target.z - observer.z });
}

export function cameraForDirection(direction: Vector3, fovDeg = 72): SkyCamera {
  const normalized = normalizeVector(direction) ?? { x: 1, y: 0, z: 0 };
  return {
    yawDeg: normalizeDegrees(Math.atan2(normalized.y, normalized.x) / DEG_TO_RAD),
    pitchDeg: clamp(Math.asin(clamp(normalized.z, -1, 1)) / DEG_TO_RAD, -89.5, 89.5),
    fovDeg: clamp(fovDeg, 20, 110),
  };
}

export function normalizeCamera(camera: SkyCamera): SkyCamera {
  return {
    yawDeg: normalizeDegrees(camera.yawDeg),
    pitchDeg: clamp(camera.pitchDeg, -89.5, 89.5),
    fovDeg: clamp(camera.fovDeg, 20, 110),
  };
}

export function projectDirection(
  direction: Vector3,
  camera: SkyCamera,
  width: number,
  height: number,
): SkyProjection | null {
  const point = normalizeVector(direction);
  if (!point || width <= 0 || height <= 0) return null;
  const normalizedCamera = normalizeCamera(camera);
  const yaw = normalizedCamera.yawDeg * DEG_TO_RAD;
  const pitch = normalizedCamera.pitchDeg * DEG_TO_RAD;
  const forward = {
    x: Math.cos(pitch) * Math.cos(yaw),
    y: Math.cos(pitch) * Math.sin(yaw),
    z: Math.sin(pitch),
  };
  const right = { x: -Math.sin(yaw), y: Math.cos(yaw), z: 0 };
  const up = {
    x: -Math.sin(pitch) * Math.cos(yaw),
    y: -Math.sin(pitch) * Math.sin(yaw),
    z: Math.cos(pitch),
  };
  const depth = dot(point, forward);
  if (depth <= 1e-4) return null;
  const focalLength = Math.min(width, height) / (2 * Math.tan(normalizedCamera.fovDeg * DEG_TO_RAD / 2));
  const x = width / 2 + dot(point, right) * focalLength / depth;
  const y = height / 2 - dot(point, up) * focalLength / depth;
  if (x < -16 || x > width + 16 || y < -16 || y > height + 16) return null;
  return { x, y, depth };
}

export function directionFromEcliptic(longitudeDeg: number, latitudeDeg: number): Vector3 {
  const longitude = longitudeDeg * DEG_TO_RAD;
  const latitude = latitudeDeg * DEG_TO_RAD;
  return {
    x: Math.cos(latitude) * Math.cos(longitude),
    y: Math.cos(latitude) * Math.sin(longitude),
    z: Math.sin(latitude),
  };
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
