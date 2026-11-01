/**
 * The view of a deep field: the zoom of the image and the text of the state of a frame. This
 * module must not import `i18n.ts`, so that node tests can import it.
 */
import type { Wcs } from "./photoFootprint.ts";

export type DeepFieldContributor = {
  handle: string;
  name: string;
  frames: number;
  photos: { id: string; title: string; licence: string }[];
};
export type DeepFieldData = {
  slug: string;
  title: string;
  key: string;
  status: "open" | "closed";
  opened_at: string;
  wcs: Wcs;
  build: null | {
    version: number;
    built_at: string;
    frames: number;
    max_coverage: number;
    limiting_mag: number | null;
    best_limiting_mag: number | null;
    gain_mag: number | null;
    stack_url: string;
    best_url: string;
    depth_url: string;
  };
  contributors: DeepFieldContributor[];
};
/** The frame of one photo, for its owner. */
export type DeepFrame = {
  slug: string;
  title: string;
  consent_at: string;
  withdrawn_at: string | null;
  weight: number | null;
  rejection_reason: string | null;
};
export type DeepFieldSummary = { slug: string; title: string };
/** The row of the object inspector. */
export type DeepFieldRow = DeepFieldSummary & { frames: number; contributors: number; limiting_mag: number | null; thumbnail_url: string };

export type ImageView = { scale: number; x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 12;

/** The image always fills the stage, so a pan stops at the edge of the image. */
export function clampView(view: ImageView, width: number, height: number): ImageView {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  return {
    scale,
    x: Math.min(0, Math.max(width * (1 - scale), view.x)),
    y: Math.min(0, Math.max(height * (1 - scale), view.y)),
  };
}

/** A zoom keeps the image point below the pointer at the same place on the screen. */
export function zoomAt(view: ImageView, factor: number, pointX: number, pointY: number, width: number, height: number): ImageView {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  return clampView({ scale, x: pointX - (pointX - view.x) * ratio, y: pointY - (pointY - view.y) * ratio }, width, height);
}

export function panBy(view: ImageView, deltaX: number, deltaY: number, width: number, height: number): ImageView {
  return clampView({ ...view, x: view.x + deltaX, y: view.y + deltaY }, width, height);
}

/** The translation key and the parameters of the state of a frame. */
export function frameStateKey(frame: DeepFrame): { key: string; percent?: number } {
  if (frame.withdrawn_at) return { key: "deep.state.withdrawn" };
  if (frame.rejection_reason) return { key: `deep.rejected.${frame.rejection_reason}` };
  if (frame.weight === null) return { key: "deep.state.waiting" };
  return { key: "deep.state.weight", percent: frame.weight * 100 };
}
