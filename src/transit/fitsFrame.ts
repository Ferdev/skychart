/**
 * Reader for one FITS frame in the browser: the header, the pixels, the time, and the sky coordinates.
 * A frame stays in the browser. This module must not import `i18n.ts`, so that node tests can import it.
 */
export type FitsHeader = Record<string, string | number | boolean>;
export type FitsFrame = { header: FitsHeader; width: number; height: number; pixels: Float32Array };
export type FrameWcs = { crval: [number, number]; crpix: [number, number]; cd: [number, number, number, number] };
export type Pixel = { x: number; y: number };

const BLOCK = 2880;
const CARD = 80;
const MAX_PIXELS = 120_000_000;
const R = Math.PI / 180;

export class FitsError extends Error {
  constructor(readonly code: "not_fits" | "too_large") {
    super(code);
  }
}

function cardValue(text: string): string | number | boolean {
  const value = text.trimStart();
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    return value.slice(1, end < 0 ? undefined : end).replace(/\s+$/, "");
  }
  const raw = value.split("/")[0]!.trim();
  if (raw === "T") return true;
  if (raw === "F") return false;
  const number = Number(raw.replace(/[dD]/, "E"));
  return raw !== "" && Number.isFinite(number) ? number : raw;
}

/** The cards of the primary header and the offset of its data. */
export function readHeader(buffer: ArrayBuffer): { header: FitsHeader; dataOffset: number } {
  const bytes = new Uint8Array(buffer);
  const header: FitsHeader = {};
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length < BLOCK || !text(0, 9).startsWith("SIMPLE")) throw new FitsError("not_fits");
  for (let offset = 0; offset + CARD <= bytes.length; offset += CARD) {
    const key = text(offset, 8).trim();
    if (key === "END") return { header, dataOffset: Math.ceil((offset + CARD) / BLOCK) * BLOCK };
    if (text(offset + 8, 2) === "= ") header[key] = cardValue(text(offset + 10, CARD - 10));
  }
  throw new FitsError("not_fits");
}

const SAMPLE_BYTES: Record<number, number> = { 8: 1, 16: 2, 32: 4, [-32]: 4, [-64]: 8 };

export function readFrame(buffer: ArrayBuffer): FitsFrame {
  const { header, dataOffset } = readHeader(buffer);
  const axes = Number(header.NAXIS);
  const width = Number(header.NAXIS1);
  const height = Number(header.NAXIS2);
  const planes = axes === 3 ? Number(header.NAXIS3) : 1;
  const bitpix = Number(header.BITPIX);
  const size = SAMPLE_BYTES[bitpix];
  if (!size || (axes !== 2 && axes !== 3) || !(width > 0) || !(height > 0) || !(planes >= 1 && planes <= 3)) throw new FitsError("not_fits");
  if (width * height > MAX_PIXELS) throw new FitsError("too_large");
  if (dataOffset + width * height * planes * size > buffer.byteLength) throw new FitsError("not_fits");
  // A colour cube has the green plane in the middle. It has the most signal of the three.
  const start = dataOffset + (planes === 3 ? width * height * size : 0);
  const view = new DataView(buffer);
  const scale = typeof header.BSCALE === "number" ? header.BSCALE : 1;
  const zero = typeof header.BZERO === "number" ? header.BZERO : 0;
  const pixels = new Float32Array(width * height);
  for (let index = 0; index < pixels.length; index += 1) {
    const at = start + index * size;
    const raw = bitpix === 8 ? view.getUint8(at)
      : bitpix === 16 ? view.getInt16(at)
      : bitpix === 32 ? view.getInt32(at)
      : bitpix === -32 ? view.getFloat32(at)
      : view.getFloat64(at);
    pixels[index] = raw * scale + zero;
  }
  return { header, width, height, pixels };
}

/** A pixel at or above this part of the full range can be clipped, so the measure of its star is not linear. */
const SATURATION_FRACTION = 0.95;
const INT16_MAX = 32_767;

/**
 * The pixel value from which a star is too bright to measure. DATAMAX gives the full range when the camera
 * writes it. Without it, a 16-bit frame has its full range from the format: the largest stored value with
 * BSCALE and BZERO. A camera that writes unsigned data (BZERO = 32768) gives 65,535. Other frames have no limit.
 */
export function saturationLimit(header: FitsHeader): number {
  if (typeof header.DATAMAX === "number") return header.DATAMAX * SATURATION_FRACTION;
  if (Number(header.BITPIX) !== 16) return Infinity;
  const scale = typeof header.BSCALE === "number" ? header.BSCALE : 1;
  const zero = typeof header.BZERO === "number" ? header.BZERO : 0;
  return (INT16_MAX * scale + zero) * SATURATION_FRACTION;
}

const JD_UNIX_EPOCH = 2440587.5;

function isoToJd(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(text)) return null;
  const time = Date.parse(/(Z|[+-]\d{2}:\d{2})$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(time) ? null : time / 86_400_000 + JD_UNIX_EPOCH;
}

/** The Julian date (UTC) of the middle of the exposure. A frame with an unknown time scale has no time. */
export function frameMidTimeJd(header: FitsHeader): number | null {
  const system = String(header.TIMESYS ?? "UTC").trim().toUpperCase();
  if (system !== "UTC") return null;
  const middle = isoToJd(header["DATE-AVG"]);
  if (middle !== null) return middle;
  const exposure = [header.EXPTIME, header.EXPOSURE, header.EXP_TIME].find((value) => typeof value === "number" && value >= 0) as number | undefined;
  if (exposure === undefined) return null;
  const start = isoToJd(header["DATE-OBS"]) ?? isoToJd(typeof header["DATE-OBS"] === "string" && typeof header["TIME-OBS"] === "string" ? `${header["DATE-OBS"]}T${header["TIME-OBS"]}` : null)
    ?? (typeof header["JD-OBS"] === "number" ? header["JD-OBS"] : typeof header["MJD-OBS"] === "number" ? header["MJD-OBS"] + 2400000.5 : null);
  return start === null ? null : start + exposure / 2 / 86_400;
}

/** A tangent-plane solution of the header, with a CD matrix or with CDELT and CROTA2. */
export function headerWcs(header: FitsHeader): FrameWcs | null {
  const number = (name: string) => (typeof header[name] === "number" ? (header[name] as number) : null);
  if (String(header.CTYPE1 ?? "").slice(0, 8) !== "RA---TAN" || String(header.CTYPE2 ?? "").slice(0, 8) !== "DEC--TAN") return null;
  const crval: [number | null, number | null] = [number("CRVAL1"), number("CRVAL2")];
  const crpix: [number | null, number | null] = [number("CRPIX1"), number("CRPIX2")];
  if (crval.includes(null) || crpix.includes(null)) return null;
  let cd: [number, number, number, number] | null = null;
  const matrix = ["CD1_1", "CD1_2", "CD2_1", "CD2_2"].map(number);
  if (!matrix.includes(null)) cd = matrix as [number, number, number, number];
  else {
    const dx = number("CDELT1");
    const dy = number("CDELT2");
    const angle = (number("CROTA2") ?? 0) * R;
    if (dx !== null && dy !== null) cd = [dx * Math.cos(angle), -dy * Math.sin(angle), dx * Math.sin(angle), dy * Math.cos(angle)];
  }
  return cd ? { crval: crval as [number, number], crpix: crpix as [number, number], cd } : null;
}

/** A sky position in zero-based pixels of the data array. A position behind the tangent plane has no pixel. */
export function skyToPixel(wcs: FrameWcs, ra: number, dec: number): Pixel | null {
  const [ra0, dec0] = wcs.crval;
  const delta = (ra - ra0) * R;
  const sin = Math.sin(dec * R);
  const cos = Math.cos(dec * R);
  const denominator = sin * Math.sin(dec0 * R) + cos * Math.cos(dec0 * R) * Math.cos(delta);
  if (denominator <= 0) return null;
  const east = (cos * Math.sin(delta)) / denominator / R;
  const north = (sin * Math.cos(dec0 * R) - cos * Math.sin(dec0 * R) * Math.cos(delta)) / denominator / R;
  const [a, b, c, d] = wcs.cd;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-20) return null;
  return { x: (d * east - b * north) / determinant + wcs.crpix[0] - 1, y: (-c * east + a * north) / determinant + wcs.crpix[1] - 1 };
}

/** The same solution for a copy of the frame that is `scale` times larger. The solver works on a small copy. */
export function scaledWcs(wcs: FrameWcs, scale: number): FrameWcs {
  return {
    crval: wcs.crval,
    crpix: [(wcs.crpix[0] - 0.5) * scale + 0.5, (wcs.crpix[1] - 0.5) * scale + 0.5],
    cd: wcs.cd.map((value) => value / scale) as [number, number, number, number],
  };
}
