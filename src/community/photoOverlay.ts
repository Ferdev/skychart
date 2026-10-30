import { eclipticCartesianToEquatorial } from "../coordinates.ts";
import { createSkyProjector, directionFromEcliptic, type SkyCamera } from "../sky/skyProjection.ts";
import type { OverlayPhoto } from "./api.ts";
import { footprintDirections } from "./photoFootprint.ts";

type Point = { x: number; y: number };

export type OverlayArea = { key: string; ra: number; dec: number; radius: number };
export type OverlayPlacement = {
  photo: OverlayPhoto;
  /** In the order of `planeTransform`: the top left, top right, bottom right, and bottom left of the image. */
  corners: [Point, Point, Point, Point];
  center: Point;
  /** The longer side on the screen, in pixels. */
  size: number;
  image: boolean;
  labelled: boolean;
  focusable: boolean;
};

/** The center of the query area moves in steps of this size, so a small movement of the view makes no request. */
const AREA_STEP_DEG = 10;
const RADIUS_STEP_DEG = 30;
/** A photo with this size on the screen is an aligned image. A smaller photo is a footprint. */
const IMAGE_MIN_SIZE_PX = 48;
/** Decoded images are the cost of a frame, so few are in view at one time. */
const IMAGE_LIMIT = 6;
const LABEL_MIN_SIZE_PX = 96;
/** A footprint in this list has a keyboard stop. Tab order stays usable with many footprints. */
const FOCUSABLE_LIMIT = 24;

/** The area of the sky that the view shows, as the steps of the query. It is larger than the view by one step. */
export function overlayArea(camera: SkyCamera, width: number, height: number): OverlayArea {
  const center = directionFromEcliptic(camera.yawDeg, camera.pitchDeg);
  const { raDeg, decDeg } = eclipticCartesianToEquatorial(center.x, center.y, center.z) ?? { raDeg: 0, decDeg: 0 };
  const diagonal = Math.hypot(width, height) / Math.max(1, Math.min(width, height));
  const halfView = Math.atan(Math.tan(camera.fovDeg * Math.PI / 360) * diagonal) * 180 / Math.PI;
  const ra = (Math.round(raDeg / AREA_STEP_DEG) * AREA_STEP_DEG) % 360;
  const dec = Math.round(decDeg / AREA_STEP_DEG) * AREA_STEP_DEG;
  const radius = Math.min(180, Math.ceil((halfView + AREA_STEP_DEG) / RADIUS_STEP_DEG) * RADIUS_STEP_DEG);
  return { key: `${ra}:${dec}:${radius}`, ra, dec, radius };
}

/** The photos in view on the screen, from the largest to the smallest. */
export function overlayPlacements(photos: readonly OverlayPhoto[], camera: SkyCamera, width: number, height: number): OverlayPlacement[] {
  // A photo at the edge of the view has corners outside it, so the projection has no clip margin.
  const project = createSkyProjector(camera, width, height, Number.POSITIVE_INFINITY);
  const placed: Omit<OverlayPlacement, "image" | "labelled" | "focusable">[] = [];
  for (const photo of photos) {
    const rays = footprintDirections(photo.wcs);
    if (rays.length !== 4) continue;
    // The rays are the bottom left, bottom right, top right, and top left of a FITS image.
    const corners = [rays[3], rays[2], rays[1], rays[0]].map((ray) => project(ray!));
    if (corners.some((corner) => !corner)) continue;
    const quad = corners as unknown as [Point, Point, Point, Point];
    if (quad.every((p) => p.x < 0) || quad.every((p) => p.x > width) || quad.every((p) => p.y < 0) || quad.every((p) => p.y > height)) continue;
    const size = Math.max(distance(quad[0], quad[1]), distance(quad[1], quad[2]));
    placed.push({ photo, corners: quad, size, center: { x: quad.reduce((sum, p) => sum + p.x, 0) / 4, y: quad.reduce((sum, p) => sum + p.y, 0) / 4 } });
  }
  placed.sort((a, b) => b.size - a.size);
  return placed.map((item, index) => ({
    ...item,
    image: index < IMAGE_LIMIT && item.size >= IMAGE_MIN_SIZE_PX,
    labelled: index < FOCUSABLE_LIMIT && item.size >= LABEL_MIN_SIZE_PX,
    focusable: index < FOCUSABLE_LIMIT,
  }));
}

/** True when the point is inside a convex quadrilateral, in either winding direction. */
export function quadContains(quad: readonly Point[], point: Point): boolean {
  let sign = 0;
  for (let index = 0; index < quad.length; index += 1) {
    const a = quad[index]!, b = quad[(index + 1) % quad.length]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross === 0) continue;
    if (sign !== 0 && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return sign !== 0;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
