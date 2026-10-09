import { directionFromEcliptic, type createSkyProjector, type Vector3 } from "../sky/skyProjection";
import { labelClass, placeLabels, rankLabels, type LabelRect } from "../labels/labelRank";
import type { UniverseLabelArea } from "./universeLabelAreas";
import { rankUniverseLabels } from "./universePhotometry";
import type { UniversePoint } from "./universePointModel";
import { canvasFont } from "../format/fonts";

type Projector = ReturnType<typeof createSkyProjector>;
export type RenderedHit = { point: UniversePoint; x: number; y: number; radius: number };
export type RenderedLabel = RenderedHit & { magnitude: number | null; distance: number };
export type DrawnUniverseLabel = { key: string; name: string; rect: LabelRect };


/** Ecliptic longitude and latitude lines that show the camera orientation. */
export function drawOrientationGrid(context: CanvasRenderingContext2D, width: number, height: number, project: Projector): void {
  context.save();
  context.lineWidth = 1;
  for (let longitude = 0; longitude < 360; longitude += 30) {
    drawDirectionLine(context, width, Array.from({ length: 49 }, (_, index) =>
      directionFromEcliptic(longitude, -90 + index * 3.75)), longitude % 90 === 0 ? 0.2 : 0.08, project);
  }
  for (const latitude of [-60, -30, 0, 30, 60]) {
    drawDirectionLine(context, width, Array.from({ length: 97 }, (_, index) =>
      directionFromEcliptic(index * 3.75, latitude)), latitude === 0 ? 0.24 : 0.1, project);
  }
  context.restore();
}

/** Screen-center aiming mark. */
export function drawReticle(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  context.strokeStyle = "rgba(248, 203, 101, 0.4)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(width / 2 - 9, height / 2);
  context.lineTo(width / 2 + 9, height / 2);
  context.moveTo(width / 2, height / 2 - 9);
  context.lineTo(width / 2, height / 2 + 9);
  context.stroke();
  context.restore();
}

function drawDirectionLine(context: CanvasRenderingContext2D, width: number, directions: Vector3[], opacity: number, project: Projector): void {
  context.beginPath();
  context.strokeStyle = `rgba(116, 184, 183, ${opacity})`;
  let previous: { x: number; y: number } | null = null;
  for (const direction of directions) {
    const projected = project(direction);
    if (!projected || (previous && Math.hypot(projected.x - previous.x, projected.y - previous.y) > width * 0.3)) {
      previous = null;
      continue;
    }
    if (previous) context.lineTo(projected.x, projected.y); else context.moveTo(projected.x, projected.y);
    previous = projected;
  }
  context.stroke();
}

/**
 * Object labels and the ring on the selected object.
 * The label rule is the rule of the 2D map and Sky view: the selected object, the major bodies,
 * and the named objects get labels, in that order. A small body or a catalog designation gets a label
 * only when it is selected. A label shows the name only, and it stays out of the control areas.
 */
export function drawUniverseLabels(context: CanvasRenderingContext2D, candidates: RenderedLabel[], hits: readonly RenderedHit[],
observer: Vector3, selectedKey: string | undefined, area: UniverseLabelArea): DrawnUniverseLabel[] {
  const ranked = rankUniverseLabels(candidates, observer, selectedKey);
  const order = new Map(ranked.map((hit, index) => [hit, index]));
  const labels = rankLabels(
    ranked.map((hit) => ({ key: hit.point.key, name: hit.point.name, objectType: hit.point.object_type, selected: hit.point.key === selectedKey, hit })),
    (entry) => order.get(entry.hit) ?? 0,
  ).filter((entry) => {
    const entryClass = labelClass(entry);
    return entryClass !== "minor" && entryClass !== "designation";
  });
  context.save();
  context.font = canvasFont(12, 600);
  context.textAlign = "left";
  context.textBaseline = "middle";
  const placed = placeLabels(labels, {
    bounds: area.bounds,
    exclusions: area.exclusions,
    limit: area.limit,
    rectsFor: ({ hit }) => {
      const width = context.measureText(hit.point.name).width + 12;
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
    context.fillStyle = "rgba(3, 7, 8, 0.72)";
    context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    context.fillStyle = "rgba(238, 242, 234, 0.84)";
    context.fillText(item.hit.point.name, rect.left + 6, (rect.top + rect.bottom) / 2);
  }
  context.textBaseline = "alphabetic";
  const selected = hits.find((hit) => hit.point.key === selectedKey);
  if (selected) {
    context.beginPath();
    context.arc(selected.x, selected.y, Math.max(11, selected.radius + 3), 0, Math.PI * 2);
    context.strokeStyle = "#f8cb65";
    context.lineWidth = 1.5;
    context.stroke();
  }
  context.restore();
  return placed.map(({ item, rect }) => ({ key: item.key, name: item.name, rect }));
}
