import type { Body, Camera, ZoomPreset } from "../atlas/contracts";

/** Share of the short side of the free map area that an object of known size fills. */
export const FIT_FILL_RATIO = 0.35;

const AU_PER_LIGHT_YEAR = 63_241.077;
const MIN_ZOOM = 1e-14;
const MAX_ZOOM = 50_000_000;
/** A deep-sky object of unknown size gets a view that is 1/40 of its distance wide, and not narrower than this. */
const DEEP_SKY_DISTANCE_DIVISOR = 40;
const DEEP_SKY_MIN_VIEW_WIDTH_AU = 1_000;

/** Nominal view width of each scale preset. The toolbar buttons show the same values. */
export const ZOOM_PRESET_VIEW_WIDTH_AU: Partial<Record<ZoomPreset, number>> = {
  inner: 4,
  solar: 80,
  nearby: 25 * AU_PER_LIGHT_YEAR,
  galaxy: 100_000 * AU_PER_LIGHT_YEAR,
  localGroup: 5_000_000 * AU_PER_LIGHT_YEAR,
  cosmicWeb: 4_000_000_000 * AU_PER_LIGHT_YEAR,
};

const DEEP_SKY_TYPES = new Set([
  "galaxy", "quasar", "active_galaxy", "black_hole", "pulsar", "nebula", "star_cluster",
  "asterism", "milky_way_patch", "xray_source", "xray_extended",
]);

export type CameraFitBody = Pick<Body, "position" | "radius_km" | "distance_from_earth_km"> & {
  deep_sky?: { physical_diameter_ly?: number | null } | null;
};

export type CameraFitOptions = {
  auKm: number;
  /** Object type from the classifier, for example "planet" or "galaxy". */
  type: string;
  /** Scale preset of the type. Used only when the size and the distance give no scale. */
  typePreset?: ZoomPreset;
  /** Scale that stays when no rule applies. */
  currentPxPerAu: number;
};

/** Physical diameter of the object in AU, or null when the catalog gives no size. */
export function bodyDiameterAu(body: CameraFitBody, auKm: number): number | null {
  const deepSkyDiameterLy = body.deep_sky?.physical_diameter_ly;
  if (typeof deepSkyDiameterLy === "number" && Number.isFinite(deepSkyDiameterLy) && deepSkyDiameterLy > 0) return deepSkyDiameterLy * AU_PER_LIGHT_YEAR;
  if (Number.isFinite(body.radius_km) && body.radius_km > 0) return (body.radius_km * 2) / auKm;
  return null;
}

/**
 * The camera that shows one object in full, with its centre at the map centre.
 *
 * 1. Known size: the object fills about 35% of the short side of the free map area.
 * 2. Deep-sky object of unknown size: the view is 1/40 of its distance wide.
 * 3. Other objects of unknown size: the scale preset of the object type.
 */
export function fitCameraForBody(body: CameraFitBody, viewport: { width: number; height: number }, options: CameraFitOptions): Camera {
  const center = { xAu: body.position.x_au, yAu: body.position.y_au };
  const width = Math.max(1, viewport.width);
  const shortSide = Math.max(1, Math.min(viewport.width, viewport.height));
  const diameterAu = bodyDiameterAu(body, options.auKm);
  if (diameterAu !== null) return { ...center, pxPerAu: clampZoom((shortSide * FIT_FILL_RATIO) / diameterAu) };

  const distanceAu = body.distance_from_earth_km / options.auKm;
  if (DEEP_SKY_TYPES.has(options.type) && Number.isFinite(distanceAu) && distanceAu > 0) {
    return { ...center, pxPerAu: clampZoom(width / Math.max(distanceAu / DEEP_SKY_DISTANCE_DIVISOR, DEEP_SKY_MIN_VIEW_WIDTH_AU)) };
  }

  const presetWidthAu = options.typePreset ? ZOOM_PRESET_VIEW_WIDTH_AU[options.typePreset] : undefined;
  return { ...center, pxPerAu: clampZoom(presetWidthAu ? width / presetWidthAu : options.currentPxPerAu) };
}

function clampZoom(pxPerAu: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pxPerAu));
}
