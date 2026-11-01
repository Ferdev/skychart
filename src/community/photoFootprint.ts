export type Wcs = {
  ra_deg: number;
  dec_deg: number;
  pixel_scale_arcsec: number;
  rotation_deg: number;
  width: number;
  height: number;
  frame: string;
  epoch: string;
  projection: string;
  status: string;
  cd?: number[];
  crpix?: number[];
};
/** The limit of photographed objects with a footprint on one Sky redraw. */
const FOOTPRINT_LIMIT = 24;
/** The lowest alpha of the footprint lines and labels, so that they stay readable at a low photo opacity. */
const MIN_FOOTPRINT_ALPHA = 0.35;
/** The alpha of all Sky footprints, author-supplied and solved, for a photo opacity. */
export function footprintAlpha(opacity: number): number {
  return Math.max(MIN_FOOTPRINT_ALPHA, opacity);
}
/**
 * The WCS of each photographed object to outline, one for each subject, in the order of the
 * points. The scan stops at the limit, so that a redraw looks up no later points.
 */
export function footprintWcs(
  frames: Iterable<{ points: readonly { key: string }[] }>,
  lookup: (key: string) => { subject_id: string; cover?: { wcs?: Wcs | null } | null } | undefined,
): Wcs[] {
  const seen = new Set<string>();
  const result: Wcs[] = [];
  for (const frame of frames)
    for (const point of frame.points) {
      const cover = lookup(point.key);
      const wcs = cover?.cover?.wcs;
      // A solver solution is on the Sky overlay, with the viewer behind it.
      if (!wcs || wcs.status === "solved" || seen.has(cover!.subject_id)) continue;
      seen.add(cover!.subject_id);
      result.push(wcs);
      if (seen.size >= FOOTPRINT_LIMIT) return result;
    }
  return result;
}
/** TAN sky directions. Supplied WCS is explicitly labelled and never changes object coordinates. */
export function footprintDirections(
  wcs: Wcs,
): { x: number; y: number; z: number }[] {
  if (wcs.projection !== "TAN" || wcs.frame !== "ICRS" || wcs.epoch !== "J2000")
    return [];
  const r = Math.PI / 180,
    ra = wcs.ra_deg * r,
    dec = wcs.dec_deg * r,
    rotation = wcs.rotation_deg * r;
  if (
    ![ra, dec, rotation, wcs.width, wcs.height, wcs.pixel_scale_arcsec].every(
      Number.isFinite,
    ) ||
    wcs.width <= 0 ||
    wcs.height <= 0 ||
    wcs.pixel_scale_arcsec <= 0
  )
    return [];
  const center = {
    x: Math.cos(dec) * Math.cos(ra),
    y: Math.cos(dec) * Math.sin(ra),
    z: Math.sin(dec),
  };
  const east = { x: -Math.sin(ra), y: Math.cos(ra), z: 0 };
  const north = {
    x: -Math.sin(dec) * Math.cos(ra),
    y: -Math.sin(dec) * Math.sin(ra),
    z: Math.cos(dec),
  };
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const dx = ((sx * wcs.width * 0.5 * wcs.pixel_scale_arcsec) / 3600) * r,
      dy = ((sy * wcs.height * 0.5 * wcs.pixel_scale_arcsec) / 3600) * r;
    let x = dx * Math.cos(rotation) - dy * Math.sin(rotation),
      y = dx * Math.sin(rotation) + dy * Math.cos(rotation);
    if (wcs.cd?.length === 4 && wcs.crpix?.length === 2) {
      const px = (sx < 0 ? 0.5 : wcs.width + 0.5) - wcs.crpix[0],
        py = (sy < 0 ? 0.5 : wcs.height + 0.5) - wcs.crpix[1];
      x = (wcs.cd[0] * px + wcs.cd[1] * py) * r;
      y = (wcs.cd[2] * px + wcs.cd[3] * py) * r;
    }
    const eq = {
      x: center.x + x * east.x + y * north.x,
      y: center.y + x * east.y + y * north.y,
      z: center.z + x * east.z + y * north.z,
    };
    // J2000 equatorial to ecliptic rotation, matching the atlas J2000 helpers.
    const obliquity = 23.439291111 * r;
    return {
      x: eq.x,
      y: eq.y * Math.cos(obliquity) + eq.z * Math.sin(obliquity),
      z: -eq.y * Math.sin(obliquity) + eq.z * Math.cos(obliquity),
    };
  });
}
