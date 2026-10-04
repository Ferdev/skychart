import { directionFromEcliptic, type createSkyProjector, type Vector3 } from "../sky/skyProjection";

type Projector = ReturnType<typeof createSkyProjector>;

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
