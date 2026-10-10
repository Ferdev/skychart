import { canvasFont } from "../format/fonts";
import { labelClass, placeLabels, rankLabels, type LabelRect } from "../labels/labelRank";
import { numericMagnitude, type RenderedHit, type SkyPoint } from "./skyPoint";

export type SkyConstellationLabel = { name: string; x: number; y: number };

export type SkyLabelRule = {
  /** Field of view of the camera, in degrees. */
  fovDeg: number;
  /** Key of the selected object, which always gets a label. */
  selectedKey: string | null;
};

export type SkyLabelArea = {
  /** A label must be fully inside this rectangle: below the header and above the footer. */
  bounds: LabelRect;
  /** Areas of panels. A label must not touch them. */
  exclusions: readonly LabelRect[];
  /** One list for object labels and constellation names, so that they do not overlap. */
  occupied: LabelRect[];
  limit: number;
};

const LABEL_MAGNITUDE_LIMIT = 4.5;
const DETAIL_MAGNITUDE_LIMIT = 6.5;
/**
 * At this field of view, minor bodies and catalog designations can get a label.
 * It is the smallest field of view of the Sky camera (`skyProjection.ts`).
 */
export const SKY_DETAIL_FOV_DEG = 20;
const LABEL_LIMIT = 28;
const NARROW_LABEL_LIMIT = 12;
const NARROW_WIDTH_PX = 520;
/** A moving body with no magnitude gets its label together with the bright stars. */
const DYNAMIC_DEFAULT_MAGNITUDE = 1;

export function skyLabelLimit(viewWidth: number): number {
  return viewWidth <= NARROW_WIDTH_PX ? NARROW_LABEL_LIMIT : LABEL_LIMIT;
}

function labelPoint(point: SkyPoint, rule: SkyLabelRule) {
  return { key: point.key, name: point.name, objectType: point.object_type, selected: point.key === rule.selectedKey };
}

/**
 * A point can get a label when it is selected, when it is the Sun, a planet, or the Moon,
 * or when it is a bright object with a name. A minor body or a catalog designation
 * gets a label only at the smallest field of view.
 */
export function isSkyLabelCandidate(point: SkyPoint, rule: SkyLabelRule): boolean {
  const detail = rule.fovDeg <= SKY_DETAIL_FOV_DEG;
  const pointClass = labelClass(labelPoint(point, rule));
  if (pointClass === "selected" || pointClass === "major") return true;
  if ((pointClass === "minor" || pointClass === "designation") && !detail) return false;
  if (point.dynamic && pointClass === "named") return true;
  return numericMagnitude(point.apparent_magnitude) <= (detail ? DETAIL_MAGNITUDE_LIMIT : LABEL_MAGNITUDE_LIMIT);
}

/** Orders the candidates: the label class first, then the magnitude (a bright object is first). */
export function rankSkyLabelCandidates(candidates: readonly RenderedHit[], rule: SkyLabelRule): RenderedHit[] {
  return rankLabels(
    candidates.map((hit) => ({ ...labelPoint(hit.point, rule), hit })),
    ({ hit }) => {
      const magnitude = numericMagnitude(hit.point.apparent_magnitude);
      return Number.isFinite(magnitude) ? magnitude : hit.point.dynamic ? DYNAMIC_DEFAULT_MAGNITUDE : magnitude;
    },
  ).map((entry) => entry.hit);
}

export type DrawnSkyLabel = { key: string; name: string; rect: LabelRect };

/** Draws the object labels in rank order. A label goes to the right of its point, or to the left, above, or below it. */
export function drawSkyObjectLabels(context: CanvasRenderingContext2D, ranked: readonly RenderedHit[], area: SkyLabelArea): DrawnSkyLabel[] {
  context.save();
  context.font = canvasFont(12, 600);
  context.textAlign = "left";
  context.textBaseline = "middle";
  const placed = placeLabels(ranked, {
    bounds: area.bounds,
    exclusions: area.exclusions,
    occupied: area.occupied,
    limit: area.limit,
    rectsFor: (hit) => {
      const width = context.measureText(hit.point.name).width + 14;
      const gap = Math.max(8, hit.radius);
      return [
        { left: hit.x + gap, top: hit.y - 10, right: hit.x + gap + width, bottom: hit.y + 10 },
        { left: hit.x - gap - width, top: hit.y - 10, right: hit.x - gap, bottom: hit.y + 10 },
        { left: hit.x - width / 2, top: hit.y - gap - 20, right: hit.x + width / 2, bottom: hit.y - gap },
        { left: hit.x - width / 2, top: hit.y + gap, right: hit.x + width / 2, bottom: hit.y + gap + 20 },
      ];
    },
  });
  for (const { item, rect } of placed) {
    context.fillStyle = "rgba(3, 6, 7, 0.68)";
    context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    context.fillStyle = "rgba(238, 242, 234, 0.86)";
    context.fillText(item.point.name, rect.left + 7, (rect.top + rect.bottom) / 2);
  }
  context.restore();
  return placed.map(({ item, rect }) => ({ key: item.point.key, name: item.point.name, rect }));
}

/** Draws the constellation names in the space that the object labels did not use. */
export function drawSkyConstellationLabels(context: CanvasRenderingContext2D, labels: readonly SkyConstellationLabel[], area: SkyLabelArea): DrawnSkyLabel[] {
  context.save();
  context.font = canvasFont(12, 700);
  context.textAlign = "center";
  context.textBaseline = "middle";
  const placed = placeLabels(labels, {
    bounds: area.bounds,
    exclusions: area.exclusions,
    occupied: area.occupied,
    // The name is at the centre of its stars, or one or two rows above or below it when a star label is there.
    rectsFor: (label) => {
      const width = context.measureText(label.name).width + 12;
      return [0, -24, 24, -48, 48].map((shift) => ({ left: label.x - width / 2, top: label.y + shift - 10, right: label.x + width / 2, bottom: label.y + shift + 10 }));
    },
  });
  for (const { item, rect } of placed) {
    context.fillStyle = "rgba(3, 6, 7, 0.72)";
    context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    context.fillStyle = "rgba(248, 203, 101, 0.76)";
    context.fillText(item.name, item.x, (rect.top + rect.bottom) / 2);
  }
  context.restore();
  return placed.map(({ item, rect }) => ({ key: `constellation:${item.name}`, name: item.name, rect }));
}
