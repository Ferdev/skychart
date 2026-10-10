/**
 * Plain words for an apparent magnitude. A smaller magnitude is a brighter object.
 * The limits are the usual ones for a dark sky: the eye sees to about magnitude 6,
 * binoculars to about 10, and the full Moon is about -12.7.
 */
export type BrightnessGroup = "brighterThanFullMoon" | "nakedEye" | "binoculars" | "telescope";

const FULL_MOON_MAGNITUDE = -12.7;
const NAKED_EYE_LIMIT = 6;
const BINOCULARS_LIMIT = 10;

export function brightnessGroup(magnitude: number): BrightnessGroup {
  if (magnitude < FULL_MOON_MAGNITUDE) return "brighterThanFullMoon";
  if (magnitude <= NAKED_EYE_LIMIT) return "nakedEye";
  if (magnitude <= BINOCULARS_LIMIT) return "binoculars";
  return "telescope";
}

/** Translation key of the word group for a magnitude. */
export function brightnessGroupKey(magnitude: number): string {
  return `universe3d.brightness.${brightnessGroup(magnitude)}`;
}
