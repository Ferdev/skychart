/**
 * The place of a photo in the blink stage: north up and east left, as in a survey cutout.
 * This module must not import `i18n.ts`, so that node tests can import it.
 */
import type { Wcs } from "./photoFootprint.ts";

/** The size of a survey cutout of the image proxy. */
export const BLINK_WIDTH = 512;
export const BLINK_HEIGHT = 320;
const STAGE_PIXELS_PER_PHOTO_PIXEL = 2;
const R = Math.PI / 180;

/** The width of the survey cutout, in degrees: a small part of the sky around the finding. */
export function surveyFov(wcs: Pick<Wcs, "pixel_scale_arcsec">): number {
  return Math.max(0.01, Math.min(5, (BLINK_WIDTH / STAGE_PIXELS_PER_PHOTO_PIXEL) * wcs.pixel_scale_arcsec / 3600));
}

/**
 * A CSS matrix that puts the fraction (x, y) of the photo at the center of the stage.
 * The CD matrix takes photo pixels to east and north, with the row axis upward.
 */
export function blinkTransform(wcs: Wcs, x: number, y: number, fov: number): string {
  const scale = wcs.pixel_scale_arcsec / 3600;
  const rotation = (wcs.rotation_deg ?? 0) * R;
  const [a, b, c, d] = wcs.cd ?? [scale * Math.cos(rotation), -scale * Math.sin(rotation), scale * Math.sin(rotation), scale * Math.cos(rotation)];
  const k = BLINK_WIDTH / fov;
  const originX = x * wcs.width;
  const originY = y * wcs.height;
  const [m11, m12, m21, m22] = [-k * a, -k * c, k * b, k * d];
  return `matrix(${m11},${m12},${m21},${m22},${BLINK_WIDTH / 2 - m11 * originX - m21 * originY},${BLINK_HEIGHT / 2 - m12 * originX - m22 * originY})`;
}
