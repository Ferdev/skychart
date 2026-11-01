/**
 * Aperture photometry of one frame and the relative light curve of a night.
 * Only the results of this module leave the browser. This module must not import `i18n.ts`.
 */
import { skyToPixel, type FrameWcs, type Pixel } from "./fitsFrame.ts";

export const PIPELINE_VERSION = "browser-aperture-1";
export const MIN_FRAMES = 20;
export const MIN_COMPARISONS = 2;
export const MAX_COMPARISONS = 6;
const EDGE_PIXELS = 24;
const MIN_SIGNAL_TO_NOISE = 5;

export type Detection = Pixel & { peak: number; flux: number; width: number };
export type GaiaStar = { key: string; ra: number; dec: number; magnitude: number | null; bp_rp?: number | null };
export type Placed = Pixel & { key: string; role: "target" | "comparison"; magnitude?: number | null };
export type Measure = Pixel & { flux: number; error: number; sky: number; peak: number };
export type FrameMeasure = { time: number; stars: Measure[] };
export type LightCurve = { points: [number, number, number][]; dropped: number; checkRmsPpt: number | null };

function sorted(values: Float32Array | number[]): Float32Array {
  return Float32Array.from(values).sort();
}

/** The sky level and its scatter, from a sample of the frame. The median and the MAD ignore the stars. */
export function backgroundLevel(pixels: Float32Array, width: number, height: number): { level: number; sigma: number } {
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40_000)));
  const sample: number[] = [];
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) sample.push(pixels[y * width + x]!);
  const values = sorted(sample);
  const level = values[Math.floor(values.length / 2)]!;
  const deviations = sorted(sample.map((value) => Math.abs(value - level)));
  return { level, sigma: Math.max(deviations[Math.floor(deviations.length / 2)]! * 1.4826, 1e-6) };
}

/** The flux-weighted center and the second moment near one pixel. */
function centroid(pixels: Float32Array, width: number, height: number, x0: number, y0: number, box: number, level: number) {
  let total = 0, sumX = 0, sumY = 0, sumR = 0, peak = -Infinity;
  const left = Math.max(0, x0 - box), right = Math.min(width - 1, x0 + box);
  const top = Math.max(0, y0 - box), bottom = Math.min(height - 1, y0 + box);
  for (let y = top; y <= bottom; y += 1)
    for (let x = left; x <= right; x += 1) {
      const raw = pixels[y * width + x]!;
      peak = Math.max(peak, raw);
      const value = Math.max(0, raw - level);
      total += value;
      sumX += value * x;
      sumY += value * y;
    }
  if (total <= 0) return null;
  const x = sumX / total, y = sumY / total;
  for (let row = top; row <= bottom; row += 1)
    for (let column = left; column <= right; column += 1)
      sumR += Math.max(0, pixels[row * width + column]! - level) * ((column - x) ** 2 + (row - y) ** 2);
  return { x, y, flux: total, peak, width: Math.sqrt(sumR / total / 2) };
}

/** The brightest point sources of a frame, for the check of the star field. */
export function detectStars(pixels: Float32Array, width: number, height: number, limit = 150): Detection[] {
  const { level, sigma } = backgroundLevel(pixels, width, height);
  const threshold = level + 8 * sigma;
  const found: Detection[] = [];
  const box = 4;
  for (let y = EDGE_PIXELS; y < height - EDGE_PIXELS; y += 1)
    for (let x = EDGE_PIXELS; x < width - EDGE_PIXELS; x += 1) {
      const value = pixels[y * width + x]!;
      if (value < threshold) continue;
      let highest = true;
      for (let row = y - 2; row <= y + 2 && highest; row += 1)
        for (let column = x - 2; column <= x + 2; column += 1)
          if (pixels[row * width + column]! > value || (row === y && column === x + 1 && pixels[row * width + column]! === value)) {
            highest = false;
            break;
          }
      if (!highest) continue;
      const star = centroid(pixels, width, height, x, y, box, level);
      if (star && star.width >= 0.5) found.push(star);
    }
  return found.sort((a, b) => b.flux - a.flux).slice(0, limit);
}

/** The typical width of a star as a full width at half maximum, in pixels. */
export function typicalWidth(stars: Detection[]): number {
  if (!stars.length) return 3;
  const widths = stars.map((star) => star.width).sort((a, b) => a - b);
  return Math.max(1.5, widths[Math.floor(widths.length / 2)]! * 2.355);
}

export function apertureRadius(fullWidth: number): number {
  return Math.min(24, Math.max(3, fullWidth * 1.5));
}

/** The count of Gaia stars that land on a detected star with this solution. */
function matchCount(wcs: FrameWcs, stars: GaiaStar[], detections: Detection[], tolerance: number, flip: (pixel: Pixel) => Pixel): number {
  let count = 0;
  for (const star of stars) {
    const pixel = skyToPixel(wcs, star.ra, star.dec);
    if (!pixel) continue;
    const { x, y } = flip(pixel);
    if (detections.some((item) => Math.hypot(item.x - x, item.y - y) <= tolerance)) count += 1;
  }
  return count;
}

/**
 * A solution can count rows from the top or from the bottom of a frame.
 * The direction with more Gaia stars on detected stars is the correct one.
 */
export function pixelMapping(wcs: FrameWcs, height: number, stars: GaiaStar[], detections: Detection[], tolerance: number): (pixel: Pixel) => Pixel {
  const same = (pixel: Pixel) => pixel;
  const flipped = (pixel: Pixel) => ({ x: pixel.x, y: height - 1 - pixel.y });
  return matchCount(wcs, stars, detections, tolerance, flipped) > matchCount(wcs, stars, detections, tolerance, same) ? flipped : same;
}

/** The target and the comparison stars. A comparison star is near the target in brightness and in color, and has no close neighbour. */
export function placeStars(
  target: { ra: number; dec: number; magnitude: number },
  stars: GaiaStar[],
  detections: Detection[],
  wcs: FrameWcs,
  width: number,
  height: number,
  radius: number,
): Placed[] {
  const mapping = pixelMapping(wcs, height, stars, detections, radius * 2);
  const nearest = (pixel: Pixel) => detections.reduce<Detection | null>((best, item) => (!best || Math.hypot(item.x - pixel.x, item.y - pixel.y) < Math.hypot(best.x - pixel.x, best.y - pixel.y) ? item : best), null);
  const aim = skyToPixel(wcs, target.ra, target.dec);
  if (!aim) return [];
  const targetPixel = mapping(aim);
  const hit = nearest(targetPixel);
  if (!hit || Math.hypot(hit.x - targetPixel.x, hit.y - targetPixel.y) > radius * 3) return [];
  const targetColor = stars.reduce<GaiaStar | null>((best, star) => {
    const pixel = skyToPixel(wcs, star.ra, star.dec);
    if (!pixel) return best;
    const place = mapping(pixel);
    return Math.hypot(place.x - hit.x, place.y - hit.y) <= radius * 2 ? star : best;
  }, null)?.bp_rp ?? null;
  const ranked: (Placed & { score: number })[] = [];
  for (const star of stars) {
    if (star.magnitude === null) continue;
    const pixel = skyToPixel(wcs, star.ra, star.dec);
    if (!pixel) continue;
    const place = mapping(pixel);
    const detected = nearest(place);
    if (!detected || Math.hypot(detected.x - place.x, detected.y - place.y) > radius * 2) continue;
    if (detected.x < EDGE_PIXELS || detected.y < EDGE_PIXELS || detected.x >= width - EDGE_PIXELS || detected.y >= height - EDGE_PIXELS) continue;
    if (Math.hypot(detected.x - hit.x, detected.y - hit.y) < radius * 4) continue;
    if (detections.some((item) => item !== detected && Math.hypot(item.x - detected.x, item.y - detected.y) < radius * 3)) continue;
    const brightness = Math.abs(star.magnitude - target.magnitude);
    if (brightness > 1.5) continue;
    const color = targetColor !== null && typeof star.bp_rp === "number" ? Math.abs(star.bp_rp - targetColor) : 0.4;
    if (color > 0.8) continue;
    ranked.push({ key: star.key, role: "comparison", x: detected.x, y: detected.y, magnitude: star.magnitude, score: brightness + color });
  }
  ranked.sort((a, b) => a.score - b.score);
  return [
    { key: "target", role: "target", x: hit.x, y: hit.y, magnitude: target.magnitude },
    ...ranked.slice(0, MAX_COMPARISONS).map(({ score: _score, ...star }) => star),
  ];
}

/** The flux in a circle less the median of the ring around it. The error has photon noise and sky noise. */
export function measureAperture(pixels: Float32Array, width: number, height: number, x: number, y: number, radius: number, gain = 1): Omit<Measure, "x" | "y"> | null {
  const inner = radius * 1.8, outer = radius * 2.8;
  const reach = Math.ceil(outer);
  const ring: number[] = [];
  let sum = 0, count = 0, peak = -Infinity;
  for (let row = Math.floor(y) - reach; row <= Math.ceil(y) + reach; row += 1)
    for (let column = Math.floor(x) - reach; column <= Math.ceil(x) + reach; column += 1) {
      if (row < 0 || column < 0 || row >= height || column >= width) return null;
      const distance = Math.hypot(column - x, row - y);
      const value = pixels[row * width + column]!;
      if (distance <= radius) {
        sum += value;
        count += 1;
        peak = Math.max(peak, value);
      } else if (distance >= inner && distance <= outer) ring.push(value);
    }
  if (ring.length < 8 || !count) return null;
  ring.sort((a, b) => a - b);
  const sky = ring[Math.floor(ring.length / 2)]!;
  const deviations = ring.map((value) => Math.abs(value - sky)).sort((a, b) => a - b);
  const sigma = deviations[Math.floor(deviations.length / 2)]! * 1.4826;
  const flux = sum - sky * count;
  if (flux <= 0) return null;
  const error = Math.sqrt(flux / gain + count * sigma ** 2 * (1 + count / ring.length));
  return { flux, error, sky, peak };
}

/** One frame: each star moves from the last place, so slow drift and field rotation are followed. */
export function measureFrame(pixels: Float32Array, width: number, height: number, places: Pixel[], radius: number, gain = 1, saturation = Infinity): Measure[] | null {
  const { level } = backgroundLevel(pixels, width, height);
  const box = Math.ceil(radius * 2);
  const stars: Measure[] = [];
  for (const place of places) {
    const moved = centroid(pixels, width, height, Math.round(place.x), Math.round(place.y), box, level);
    if (!moved) return null;
    const measure = measureAperture(pixels, width, height, moved.x, moved.y, radius, gain);
    if (!measure || measure.flux / measure.error < MIN_SIGNAL_TO_NOISE || measure.peak >= saturation) return null;
    stars.push({ x: moved.x, y: moved.y, ...measure });
  }
  return stars;
}

function detrendedRms(values: number[]): number {
  const count = values.length;
  const meanX = (count - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / count;
  let top = 0, bottom = 0;
  values.forEach((value, index) => {
    top += (index - meanX) * (value - meanY);
    bottom += (index - meanX) ** 2;
  });
  const slope = bottom ? top / bottom : 0;
  const residuals = values.map((value, index) => value - meanY - slope * (index - meanX));
  return Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / count) / meanY;
}

/**
 * The target over the sum of the comparison stars. The first comparison star over the
 * others is a check: it must stay flat, so a moderator can see a bad night.
 */
export function relativeLightCurve(frames: FrameMeasure[], dropped: number): LightCurve {
  const points = frames.map(({ time, stars }): [number, number, number] => {
    const [target, ...comparisons] = stars;
    const total = comparisons.reduce((sum, star) => sum + star.flux, 0);
    const variance = comparisons.reduce((sum, star) => sum + star.error ** 2, 0);
    const ratio = target!.flux / total;
    return [time, ratio, ratio * Math.sqrt((target!.error / target!.flux) ** 2 + variance / total ** 2)];
  });
  const usable = frames.length >= 3 && frames[0]!.stars.length >= 3;
  const check = usable ? frames.map(({ stars }) => stars[1]!.flux / stars.slice(2).reduce((sum, star) => sum + star.flux, 0)) : [];
  return { points, dropped, checkRmsPpt: usable ? detrendedRms(check) * 1000 : null };
}

/** The frame as 8-bit gray values with a sky-based stretch, reduced to fit `size`, for the check of the star field. */
export function stretchedPreview(pixels: Float32Array, width: number, height: number, size: number): { data: Uint8ClampedArray; width: number; height: number; scale: number } {
  const scale = Math.max(1, Math.ceil(Math.max(width, height) / size));
  const small = { width: Math.floor(width / scale), height: Math.floor(height / scale) };
  const { level, sigma } = backgroundLevel(pixels, width, height);
  const data = new Uint8ClampedArray(small.width * small.height);
  for (let y = 0; y < small.height; y += 1)
    for (let x = 0; x < small.width; x += 1) {
      let peak = -Infinity;
      for (let row = 0; row < scale; row += 1) for (let column = 0; column < scale; column += 1) peak = Math.max(peak, pixels[(y * scale + row) * width + x * scale + column]!);
      data[y * small.width + x] = 255 * Math.min(1, Math.max(0, Math.asinh((peak - level + sigma) / (6 * sigma)) / 6));
    }
  return { data, ...small, scale };
}
