/// <reference lib="webworker" />
/**
 * Reads FITS frames and measures stars outside the main thread. Frames stay here: the
 * worker returns numbers and a small preview. It reads one file at a time to keep memory low.
 */
import { FitsError, frameMidTimeJd, headerWcs, readFrame, type FrameWcs } from "./fitsFrame.ts";
import { apertureRadius, detectStars, measureFrame, relativeLightCurve, stretchedPreview, typicalWidth, type Detection, type FrameMeasure, type LightCurve } from "./photometry.ts";

export type WorkerRequest =
  | { type: "inspect"; file: File }
  | { type: "measure"; files: File[]; places: { x: number; y: number }[]; radius: number };
export type WorkerReply =
  | { type: "inspected"; width: number; height: number; wcs: FrameWcs | null; hasTime: boolean; radius: number; detections: Detection[]; preview: { data: Uint8ClampedArray; width: number; height: number; scale: number } }
  | { type: "progress"; current: number; total: number }
  | { type: "measured"; curve: LightCurve; frames: number }
  | { type: "failed"; code: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const PREVIEW_SIZE = 1600;

async function inspect(file: File): Promise<WorkerReply> {
  const frame = readFrame(await file.arrayBuffer());
  const detections = detectStars(frame.pixels, frame.width, frame.height);
  return {
    type: "inspected",
    width: frame.width,
    height: frame.height,
    wcs: headerWcs(frame.header),
    hasTime: frameMidTimeJd(frame.header) !== null,
    radius: apertureRadius(typicalWidth(detections)),
    detections,
    preview: stretchedPreview(frame.pixels, frame.width, frame.height, PREVIEW_SIZE),
  };
}

async function measure(files: File[], start: { x: number; y: number }[], radius: number): Promise<WorkerReply> {
  const frames: FrameMeasure[] = [];
  let places = start;
  let dropped = 0;
  for (const [index, file] of files.entries()) {
    scope.postMessage({ type: "progress", current: index + 1, total: files.length } satisfies WorkerReply);
    const frame = readFrame(await file.arrayBuffer());
    const time = frameMidTimeJd(frame.header);
    const gain = [frame.header.GAIN, frame.header.EGAIN].find((value) => typeof value === "number" && value > 0) as number | undefined;
    const limit = typeof frame.header.DATAMAX === "number" ? frame.header.DATAMAX * 0.95 : frame.header.BITPIX === 16 ? 62_000 : Infinity;
    const stars = time === null ? null : measureFrame(frame.pixels, frame.width, frame.height, places, radius, gain, limit);
    if (time === null || !stars) {
      dropped += 1;
      continue;
    }
    places = stars.map(({ x, y }) => ({ x, y }));
    frames.push({ time, stars });
  }
  frames.sort((a, b) => a.time - b.time);
  return { type: "measured", curve: relativeLightCurve(frames, dropped), frames: frames.length };
}

scope.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    scope.postMessage(data.type === "inspect" ? await inspect(data.file) : await measure(data.files, data.places, data.radius));
  } catch (error) {
    scope.postMessage({ type: "failed", code: error instanceof FitsError ? error.code : "not_fits" } satisfies WorkerReply);
  }
};
