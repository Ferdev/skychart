import { catalogPointVertexStrideBytes, catalogPointVertexStrideFloats } from "../catalog/catalogPointSelector";
import type { CatalogPointPlanner, CatalogPointViewport } from "../catalog/catalogPointPlanner";
import type { CatalogPointStream } from "../catalog/catalogPointStream";
import type { WebglPointRenderer, PointLayerSource, PointRenderStats } from "../webglPointRenderer";
import type { Body, Camera } from "../atlas/contracts";
import type { Rect } from "../geometry";

export interface CatalogLayerMetrics {
  webglMs: number;
  webglEmaMs: number;
  bufferMs: number;
  pointRenderer: PointRenderStats;
}

interface CatalogLayerRendererOptions {
  context: CanvasRenderingContext2D;
  pointCanvas: HTMLCanvasElement;
  pointRenderer: WebglPointRenderer;
  stream: CatalogPointStream;
  planner: CatalogPointPlanner;
  viewport: () => CatalogPointViewport;
  viewportRect: () => Rect;
  renderScale: () => number;
  camera: () => Camera;
  ephemerisTimestamp: () => string;
  visibleBodies: () => Body[];
  selectedBody: () => Body | null;
  selectedKey: () => string;
  hoverKey: () => string | null;
  isDuplicateBody: (body: Body) => boolean;
  bodyRadiusAu: (body: Body) => number;
  performanceEnabled: () => boolean;
  afterViewportMeasurement: () => void;
}

const POINT_RADIUS_PX = 1.3;
const POINT_ALPHA = 0.82;
const POINT_MEASURE_INTERVAL_MS = 1_000;
const EMPTY_POINT_STATS: PointRenderStats = {
  layerCount: 0,
  pointsDrawn: 0,
  pointsInViewport: 0,
  occupiedPixels: 0,
  capped: false,
};

export class CatalogLayerRenderer {
  private bodyLayerCache: PointLayerSource | null = null;
  private readonly colorCache = new Map<string, [number, number, number]>();
  private lastPointMeasureAt = -Infinity;
  private metricsState: CatalogLayerMetrics = {
    webglMs: 0,
    webglEmaMs: 0,
    bufferMs: 0,
    pointRenderer: EMPTY_POINT_STATS,
  };

  constructor(private readonly options: CatalogLayerRendererOptions) {}

  get metrics(): CatalogLayerMetrics {
    return this.metricsState;
  }

  invalidateBodies(): void {
    this.bodyLayerCache = null;
  }

  prepare(): void {
    const { pointRenderer } = this.options;
    if (!pointRenderer.available) {
      this.drawFallback();
      return;
    }

    const rect = this.options.viewportRect();
    const bodyLayer = this.bodyPointLayer();
    const uploadStartedAt = performance.now();
    pointRenderer.setLayer("bodies", bodyLayer);
    this.options.stream.syncRenderedLayers();
    const bufferMs = performance.now() - uploadStartedAt;

    const renderStartedAt = performance.now();
    const measurePixels = this.options.performanceEnabled()
      && renderStartedAt - this.lastPointMeasureAt >= POINT_MEASURE_INTERVAL_MS;
    const measureViewport = measurePixels || this.options.stream.needsViewportMeasurement();
    if (measurePixels) this.lastPointMeasureAt = renderStartedAt;
    const pointRendererStats = pointRenderer.render({
      camera: this.options.camera(),
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      width: this.options.pointCanvas.width,
      height: this.options.pointCanvas.height,
      dpr: this.options.renderScale(),
      clip: rect,
      measureViewport,
      measurePixels,
    });
    if (this.options.stream.needsViewportMeasurement()) {
      this.options.stream.recordViewportMeasurement(
        pointRendererStats.pointsInViewport - this.richPointsInViewport(bodyLayer, rect),
      );
    }
    if (!pointRenderer.available) {
      this.drawFallback();
      return;
    }

    const webglMs = performance.now() - renderStartedAt;
    this.metricsState = {
      webglMs,
      webglEmaMs: this.metricsState.webglEmaMs === 0
        ? webglMs
        : this.metricsState.webglEmaMs * 0.9 + webglMs * 0.1,
      bufferMs,
      pointRenderer: pointRendererStats,
    };
  }

  private richPointsInViewport(source: PointLayerSource | null, rect: Rect): number {
    if (!source || source.kind !== "rich") return 0;
    const camera = this.options.camera();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let visible = 0;
    for (let index = 0; index < source.count; index += 1) {
      const offset = index * 6;
      const x = centerX + ((source.vertices[offset] ?? 0) - camera.xAu) * camera.pxPerAu;
      const y = centerY - ((source.vertices[offset + 1] ?? 0) - camera.yAu) * camera.pxPerAu;
      if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) visible += 1;
    }
    return visible;
  }

  private bodyPointLayer(): PointLayerSource | null {
    const catalogLayerReady = this.options.stream.hasActiveLayer();
    const selected = this.options.selectedBody();
    const bodies = this.options.visibleBodies().filter((body) => {
      const selectedOrHover = body.key === selected?.key || body.key === this.options.hoverKey();
      return !selectedOrHover && (!catalogLayerReady || !this.options.isDuplicateBody(body));
    });
    if (bodies.length === 0) return null;
    const signature = `bodies:${this.options.ephemerisTimestamp()}:${this.options.selectedKey()}:${this.options.hoverKey()}:${bodies.map((body) => body.key).join("|")}`;
    if (this.bodyLayerCache?.signature === signature) return this.bodyLayerCache;

    const vertices = new Float32Array(bodies.length * 6);
    bodies.forEach((body, index) => {
      const [red, green, blue] = this.rgb(body.color ?? null);
      const offset = index * 6;
      vertices[offset] = body.position.x_au;
      vertices[offset + 1] = body.position.y_au;
      vertices[offset + 2] = red / 255;
      vertices[offset + 3] = green / 255;
      vertices[offset + 4] = blue / 255;
      vertices[offset + 5] = this.options.bodyRadiusAu(body);
    });
    this.bodyLayerCache = { kind: "rich", signature, vertices, count: bodies.length };
    return this.bodyLayerCache;
  }

  private drawFallback(): void {
    if (!this.options.planner.canRender(this.options.viewport())) return;
    const rect = this.options.viewportRect();
    const camera = this.options.camera();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let pointsInViewport = 0;

    for (const tile of this.options.stream.activeTiles()) {
      const layer = tile.payload;
      if (!layer || layer.returned === 0) continue;
      const strideFloats = catalogPointVertexStrideFloats(layer);
      const strideBytes = catalogPointVertexStrideBytes(layer);
      const colors = new Uint8Array(layer.vertices.buffer, layer.vertices.byteOffset, layer.returned * strideBytes);
      for (let index = 0; index < layer.returned; index += 1) {
        const floatOffset = index * strideFloats;
        const x = Math.round(centerX + (layer.origin.x + (layer.vertices[floatOffset] ?? 0) - camera.xAu) * camera.pxPerAu);
        const y = Math.round(centerY - (layer.origin.y + (layer.vertices[floatOffset + 1] ?? 0) - camera.yAu) * camera.pxPerAu);
        if (x < 0 || x >= window.innerWidth || y < 0 || y >= window.innerHeight) continue;
        pointsInViewport += 1;
        const byteOffset = index * strideBytes + 8;
        const red = colors[byteOffset] ?? 204;
        const green = colors[byteOffset + 1] ?? 222;
        const blue = colors[byteOffset + 2] ?? 255;
        this.options.context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${POINT_ALPHA})`;
        this.options.context.beginPath();
        this.options.context.arc(x, y, POINT_RADIUS_PX, 0, Math.PI * 2);
        this.options.context.fill();
      }
    }
    if (this.options.stream.needsViewportMeasurement()) {
      this.options.stream.recordViewportMeasurement(pointsInViewport);
      this.options.afterViewportMeasurement();
    }
  }

  private rgb(color: string | null): [number, number, number] {
    const fallback: [number, number, number] = [205, 222, 255];
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return fallback;
    const cached = this.colorCache.get(color);
    if (cached) return cached;
    const rgb: [number, number, number] = [
      Number.parseInt(color.slice(1, 3), 16),
      Number.parseInt(color.slice(3, 5), 16),
      Number.parseInt(color.slice(5, 7), 16),
    ];
    this.colorCache.set(color, rgb);
    return rgb;
  }
}
