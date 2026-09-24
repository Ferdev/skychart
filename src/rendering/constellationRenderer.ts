import type { Body, CatalogViewportPayload } from "../atlas/contracts";
import { pointInRect, rectsOverlap, type Rect, type ScreenPoint } from "../geometry";
import { MAP_CONSTELLATIONS } from "../atlas/constellationStyles";

type Position = { x_au: number; y_au: number };
export type ConstellationRendererOptions = {
  context: CanvasRenderingContext2D;
  bodyByKey: () => ReadonlyMap<string, Body>;
  worldToScreen: (xAu: number, yAu: number) => ScreenPoint;
  viewport: () => Rect;
  requestRender: () => void;
  hiddenConstellations?: () => ReadonlySet<string>;
};

const ENDPOINT_KEYS = new Set(MAP_CONSTELLATIONS.flatMap((figure) => figure.polylines.flat()));

/** Connect catalog positions in the atlas plane, rather than sky directions. */
export class ConstellationRenderer {
  private positions = new Map<string, Position>();
  private loaded = false;
  private loading = false;
  private retryAfter = 0;

  constructor(private readonly options: ConstellationRendererOptions) {}

  draw(showLabels: boolean): void {
    void this.loadPositions();
    const { context: ctx } = this.options;
    const viewport = this.options.viewport();
    const bodies = this.options.bodyByKey();
    const projected = new Map<string, ScreenPoint>();
    for (const key of ENDPOINT_KEYS) {
      const position = bodies.get(key)?.position ?? this.positions.get(key);
      if (!position || !Number.isFinite(position.x_au) || !Number.isFinite(position.y_au)) continue;
      const point = this.options.worldToScreen(position.x_au, position.y_au);
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) projected.set(key, point);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(viewport.left, viewport.top, viewport.width, viewport.height);
    ctx.clip();
    ctx.lineWidth = 1.15;
    ctx.font = "700 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const occupied: Rect[] = [];
    const marked = new Set<string>();
    const hidden = this.options.hiddenConstellations?.();
    for (const figure of MAP_CONSTELLATIONS) {
      if (hidden?.has(figure.id)) continue;
      ctx.strokeStyle = figure.color;
      ctx.fillStyle = figure.color;
      ctx.globalAlpha = 0.6;
      const endpoints = new Map<string, ScreenPoint>();
      ctx.beginPath();
      for (const polyline of figure.polylines) {
        // Work on adjacent pairs so missing distances never create false edges.
        for (let index = 1; index < polyline.length; index += 1) {
          const a = projected.get(polyline[index - 1]);
          const b = projected.get(polyline[index]);
          if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 2) continue;
          if (Math.max(a.x, b.x) < viewport.left || Math.min(a.x, b.x) > viewport.right ||
              Math.max(a.y, b.y) < viewport.top || Math.min(a.y, b.y) > viewport.bottom) continue;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          endpoints.set(polyline[index - 1], a);
          endpoints.set(polyline[index], b);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      // Keep endpoints visible even when the viewport's catalog sample omits them.
      for (const [key, point] of endpoints) {
        if (marked.has(key) || !pointInRect(point, viewport)) continue;
        marked.add(key);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!showLabels || endpoints.size < 2) continue;
      const points = [...endpoints.values()];
      const span = Math.max(
        Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
        Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
      );
      if (span < 40 || span > Math.max(viewport.width, viewport.height) * 4) continue;
      const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      const width = ctx.measureText(figure.name).width + 12;
      const rect = { left: x - width / 2, right: x + width / 2, top: y - 10, bottom: y + 10, width, height: 20 };
      if (rect.left < viewport.left || rect.right > viewport.right || rect.top < viewport.top || rect.bottom > viewport.bottom ||
          occupied.some((other) => rectsOverlap(other, rect))) continue;
      occupied.push(rect);
      ctx.fillText(figure.name, x, y);
    }
    ctx.restore();
  }

  private async loadPositions(): Promise<void> {
    if (this.loaded || this.loading || Date.now() < this.retryAfter) return;
    this.loading = true;
    try {
      // Fetch the complete bounded Hipparcos bright-star catalog once, on demand.
      // Camera-dependent samples omit endpoints and cause figures to change on pan.
      const params = new URLSearchParams({
        groups: "bright_stars", limit: "10000",
        min_x_au: "-1e12", max_x_au: "1e12", min_y_au: "-1e12", max_y_au: "1e12",
      });
      const response = await fetch(`/api/catalog/viewport?${params}`);
      if (!response.ok) throw new Error(`Constellation catalog returned ${response.status}`);
      const payload = await response.json() as CatalogViewportPayload;
      for (const object of payload.objects) {
        const x = object.position?.x_au;
        const y = object.position?.y_au;
        if (ENDPOINT_KEYS.has(object.key) && typeof x === "number" && typeof y === "number" &&
            Number.isFinite(x) && Number.isFinite(y)) {
          this.positions.set(object.key, { x_au: x, y_au: y });
        }
      }
      this.loaded = true;
      this.options.requestRender();
    } catch (error) {
      this.retryAfter = Date.now() + 30_000;
      console.warn("Unable to load constellation stars.", error);
    } finally {
      this.loading = false;
    }
  }
}
