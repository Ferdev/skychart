import { niceStep } from "../geometry";
import type { Vector3 } from "../sky/skyProjection";
import { formatDistanceAu } from "./universeFormat";
import { canvasFont } from "../format/fonts";

export type MinimapLandmark = { key: string; name: string; position: Vector3; color?: string | null; object_type?: string | null };

export type MinimapScene = {
  target: { key: string; name: string; position: Vector3 } | null;
  /** Planned gravity arc; without one the route is the straight line to the target. */
  route: readonly Vector3[] | null;
  /** Solar System bodies, drawn and labeled when they fall inside the map. */
  bodies: Iterable<MinimapLandmark>;
  /** Sampled catalog positions, drawn as faint context. */
  catalog: readonly MinimapLandmark[];
  /** Smallest half-width of the map, so a craft at rest still has context. */
  minimumSpanAu: number;
};

const MAX_TRAIL = 600;
const MAX_CATALOG = 900;
const MAX_LABELS = 8;
const GOLD = "#f8cb65";

/** Top-down (ecliptic-plane) map of the current trip: where it began, the path
 * flown, the planned route, and the destination. It reuses the 2D atlas
 * orientation, +x right and +y up, and drops the z coordinate. */
export class UniverseMinimap {
  private start: Vector3 = { x: 0, y: 0, z: 0 };
  private trail: { x: number; y: number }[] = [];
  private scene: MinimapScene = { target: null, route: null, bodies: [], catalog: [], minimumSpanAu: 1 };

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** Begin a new trip at this position and forget the previous path. */
  restart(position: Vector3): void {
    this.start = { ...position };
    this.trail = [{ x: position.x, y: position.y }];
  }

  /** Replace the slowly changing content: destination, route and landmarks. */
  setScene(scene: MinimapScene): void { this.scene = scene; }

  /** Draw the scene with the craft at its current position; cheap enough to
   * call on every flight frame so the craft moves smoothly along the route. */
  draw(position: Vector3, yawDeg: number): void {
    const frame = { ...this.scene, position, yawDeg };
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.canvas.dataset.position = `${frame.position.x},${frame.position.y},${frame.position.z}`;
    const context = this.canvas.getContext("2d");
    if (!context || width === 0 || height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const route = frame.route ?? (frame.target ? [frame.position, frame.target.position] : []);
    const fit = [this.start, frame.position, ...route, ...(frame.target ? [frame.target.position] : [])];
    const xs = fit.map((point) => point.x);
    const ys = fit.map((point) => point.y);
    const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const span = Math.max((Math.max(...xs) - Math.min(...xs)) * 0.65, (Math.max(...ys) - Math.min(...ys)) * 0.65, frame.minimumSpanAu);
    const pxPerAu = Math.min(width, height) / 2 / span;
    const screen = (point: { x: number; y: number }) => ({
      x: width / 2 + (point.x - center.x) * pxPerAu, y: height / 2 - (point.y - center.y) * pxPerAu,
    });
    const visible = (point: { x: number; y: number }) => point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
    this.record(frame.position, span);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = canvasFont(12, 600);
    context.textBaseline = "middle";

    context.fillStyle = "rgba(190, 214, 224, 0.5)";
    const stride = Math.max(1, Math.ceil(frame.catalog.length / MAX_CATALOG));
    for (let index = 0; index < frame.catalog.length; index += stride) {
      const point = screen(frame.catalog[index]!.position);
      if (visible(point)) context.fillRect(point.x - 0.5, point.y - 0.5, 1.2, 1.2);
    }

    // Only the Sun and the planets are drawn as landmarks. Moons, asteroids
    // and other small bodies stay faint so a crowded belt does not hide the trip.
    const landmarks: { name: string; point: { x: number; y: number }; color: string; rank: number }[] = [];
    context.fillStyle = "rgba(207, 216, 210, 0.38)";
    for (const body of frame.bodies) {
      const point = screen(body.position);
      if (!visible(point) || body.key === frame.target?.key) continue;
      const rank = body.key === "sun" ? 0 : body.object_type === "planet" ? 1 : body.object_type === "star" ? 2 : 3;
      if (rank === 3) context.fillRect(point.x - 0.5, point.y - 0.5, 1, 1);
      else landmarks.push({ name: body.name, point, color: body.color ?? "#cfd8d2", rank });
    }

    this.stroke(context, route.map(screen), "rgba(238, 242, 234, 0.75)", [4, 4]);
    this.stroke(context, [...this.trail, frame.position].map(screen), GOLD, []);

    landmarks.sort((a, b) => a.rank - b.rank);
    for (const landmark of landmarks) {
      context.fillStyle = landmark.color;
      context.beginPath();
      context.arc(landmark.point.x, landmark.point.y, landmark.rank === 0 ? 3.5 : landmark.rank === 1 ? 2.5 : 1.5, 0, Math.PI * 2);
      context.fill();
    }

    const origin = screen(this.start);
    context.strokeStyle = "rgba(130, 203, 179, 0.95)";
    context.lineWidth = 1.25;
    context.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      context.moveTo(origin.x + dx * 3, origin.y + dy * 3);
      context.lineTo(origin.x + dx * 8, origin.y + dy * 8);
    }
    context.stroke();

    const target = frame.target ? screen(frame.target.position) : null;
    if (target) {
      context.strokeStyle = GOLD;
      context.beginPath();
      context.arc(target.x, target.y, 5, 0, Math.PI * 2);
      context.stroke();
    }

    // The craft: an arrow along the camera heading projected onto the plane.
    const craft = screen(frame.position);
    context.save();
    context.translate(craft.x, craft.y);
    context.rotate(-frame.yawDeg * Math.PI / 180);
    context.fillStyle = GOLD;
    context.strokeStyle = "#04090b";
    context.beginPath();
    context.moveTo(8, 0);
    context.lineTo(-5, 4.5);
    context.lineTo(-2.5, 0);
    context.lineTo(-5, -4.5);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();

    // Labels go on last, over a dark halo, and only where they do not collide:
    // the destination first, then the Sun, the planets and named stars.
    const boxes: { left: number; right: number; y: number }[] = [];
    const label = (text: string, point: { x: number; y: number }, color: string, always = false) => {
      const textWidth = context.measureText(text).width;
      const left = point.x + 8 + textWidth > width ? point.x - 8 - textWidth : point.x + 8;
      const y = Math.min(height - 30, Math.max(8, point.y));
      const box = { left: left - 3, right: left + textWidth + 3, y };
      if (!always && (boxes.length >= MAX_LABELS || boxes.some((other) => Math.abs(other.y - y) < 13 && other.left < box.right && other.right > box.left))) return;
      boxes.push(box);
      context.lineWidth = 3;
      context.strokeStyle = "rgba(1, 4, 5, 0.9)";
      context.strokeText(text, left, y);
      context.fillStyle = color;
      context.fillText(text, left, y);
    };
    if (target) label(frame.target!.name, target, GOLD, true);
    for (const landmark of landmarks) label(landmark.name, landmark.point, "rgba(238, 242, 234, 0.78)");

    const stepAu = niceStep(span * 0.6);
    const barPx = stepAu * pxPerAu;
    context.strokeStyle = context.fillStyle = "rgba(238, 242, 234, 0.8)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(8, height - 12);
    context.lineTo(8, height - 8);
    context.lineTo(8 + barPx, height - 8);
    context.lineTo(8 + barPx, height - 12);
    context.stroke();
    context.fillText(formatDistanceAu(stepAu), 8, height - 19);

    this.canvas.dataset.spanAu = String(span);
    this.canvas.dataset.trailPoints = String(this.trail.length);
    this.canvas.dataset.route = frame.route ? "gravity" : frame.target ? "direct" : "none";
  }

  private record(position: Vector3, span: number): void {
    const last = this.trail[this.trail.length - 1];
    if (last && Math.hypot(position.x - last.x, position.y - last.y) < span / 120) return;
    this.trail.push({ x: position.x, y: position.y });
    if (this.trail.length > MAX_TRAIL) this.trail = this.trail.filter((_, index) => index % 2 === 0);
  }

  private stroke(context: CanvasRenderingContext2D, points: { x: number; y: number }[], color: string, dash: number[]): void {
    if (points.length < 2) return;
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.setLineDash(dash);
    context.beginPath();
    points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
    context.stroke();
    context.restore();
  }
}
