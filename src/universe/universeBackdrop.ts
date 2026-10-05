import { directionFromEcliptic, type createSkyProjector, type Vector3 } from "../sky/skyProjection";
import { rankUniverseLabels } from "./universePhotometry";
import type { UniversePoint } from "./universePointModel";

type Projector = ReturnType<typeof createSkyProjector>;
export type RenderedHit = { point: UniversePoint; x: number; y: number; radius: number };
export type RenderedLabel = RenderedHit & { magnitude: number | null; distance: number };

const MAX_LABELS = 30;

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

/** Ranked, non-overlapping object labels and the ring on the selected object. */
export function drawUniverseLabels(context: CanvasRenderingContext2D, candidates: RenderedLabel[], hits: readonly RenderedHit[],
observer: Vector3, selectedKey: string | undefined, width: number, height: number): void {
  const labels = rankUniverseLabels(candidates, observer, selectedKey);
  const occupied: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  context.save();
  context.font = "600 12px system-ui, sans-serif";
  for (const hit of labels) {
    if (occupied.length >= MAX_LABELS) break;
    const label = hit.magnitude === null ? hit.point.name : `${hit.point.name} · ${hit.magnitude.toFixed(1)}`;
    const labelWidth = context.measureText(label).width + 12;
    const rect = { left: hit.x + 8, top: hit.y - 10, right: hit.x + 8 + labelWidth, bottom: hit.y + 10 };
    if (rect.left < 8 || rect.right > width - 8 || rect.top < 72 || rect.bottom > height - 60) continue;
    if (occupied.some((item) => overlaps(item, rect))) continue;
    occupied.push(rect);
    context.fillStyle = "rgba(3, 7, 8, 0.72)";
    context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    context.fillStyle = "rgba(238, 242, 234, 0.84)";
    context.fillText(label, hit.x + 14, hit.y + 4);
  }
  const selected = hits.find((hit) => hit.point.key === selectedKey);
  if (selected) {
    context.beginPath();
    context.arc(selected.x, selected.y, Math.max(11, selected.radius + 3), 0, Math.PI * 2);
    context.strokeStyle = "#f8cb65";
    context.lineWidth = 1.5;
    context.stroke();
  }
  context.restore();
}

function overlaps(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
