import type { Body, Camera, Ephemeris } from "../atlas/contracts";
import type { SmallBodyPosition } from "../catalog/smallBodyPropagation";
import { clamp, degToRad, edgeAnchorForScreen, expandedRect, niceStep, pointInRect, pointRect, rectsOverlap, rectUnion, type EdgeSide, type Rect, type ScreenPoint } from "../geometry";

type EdgeBody = { body: Body; screen: ScreenPoint };

type OverlayFrame = {
  ephemeris: Ephemeris | null;
  camera: Camera;
  selected: Body | null;
  compareTarget: Body | null;
  selectedKey: string;
  hoverKey: string | null;
  pointRendererAvailable: boolean;
  viewport: Rect;
  visibleBodies: Body[];
  labelBodies: Body[];
  edgeBodies: EdgeBody[];
};

type AtlasOverlayRendererOptions = {
  context: CanvasRenderingContext2D;
  frame: () => OverlayFrame;
  bodyByKey: () => ReadonlyMap<string, Body>;
  bodyToScreen: (body: Body) => ScreenPoint;
  worldToScreen: (xAu: number, yAu: number) => ScreenPoint;
  screenToWorld: (x: number, y: number) => { xAu: number; yAu: number };
  bodyDisplayRadiusPx: (body: Body) => number;
  bodyMatchesActiveFilter: (body: Body) => boolean;
  isSolarSystemBody: (body: Body) => boolean | undefined;
  currentViewWidthAu: () => number;
  auKm: () => number;
  formatDistance: (kilometers: number) => string;
  smallBodyOrbitPathAu: (body: Body) => SmallBodyPosition[] | null;
};

const POINT_ALPHA = 0.82;
const SELECTION_RING_PX = 8.5;

/** Draws the navigational overlays layered above the catalog point renderer. */
export class AtlasOverlayRenderer {
  private edgeHitRegions: { body: Body; rect: Rect }[] = [];

  constructor(private readonly options: AtlasOverlayRendererOptions) {}

  drawGrid() {
    const frame = this.options.frame();
    const rect = frame.viewport;
    const worldLeft = this.options.screenToWorld(rect.left, rect.top).xAu;
    const worldRight = this.options.screenToWorld(rect.right, rect.top).xAu;
    const worldTop = this.options.screenToWorld(rect.left, rect.top).yAu;
    const worldBottom = this.options.screenToWorld(rect.left, rect.bottom).yAu;
    const step = niceStep(Math.abs(worldRight - worldLeft) / 8);
    const ctx = this.options.context;
    ctx.save();
    ctx.strokeStyle = "rgba(235, 228, 206, 0.09)";
    ctx.lineWidth = 1;
    for (let x = Math.floor(worldLeft / step) * step; x <= Math.ceil(worldRight / step) * step; x += step) {
      const screen = this.options.worldToScreen(x, 0);
      ctx.beginPath();
      ctx.moveTo(screen.x, rect.top);
      ctx.lineTo(screen.x, rect.bottom);
      ctx.stroke();
    }
    for (let y = Math.floor(worldBottom / step) * step; y <= Math.ceil(worldTop / step) * step; y += step) {
      const screen = this.options.worldToScreen(0, y);
      ctx.beginPath();
      ctx.moveTo(rect.left, screen.y);
      ctx.lineTo(rect.right, screen.y);
      ctx.stroke();
    }
    this.drawScaleBar(rect, step, frame.camera);
    ctx.restore();
  }

  drawOrbitGuides() {
    const frame = this.options.frame();
    if (this.options.currentViewWidthAu() > 1_000) return;
    const bodies = (frame.ephemeris?.bodies ?? []).filter((body) => this.options.bodyMatchesActiveFilter(body) && body.orbit && body.parent_key && this.options.isSolarSystemBody(body));
    const rect = expandedRect(frame.viewport, 160);
    const ctx = this.options.context;
    ctx.save();
    for (const body of bodies) {
      const screens = this.orbitGuideScreens(body);
      if (!screens || !screens.some((point) => pointInRect(point, rect))) continue;
      this.strokeOrbitPath(screens, body.key === frame.selectedKey);
    }
    const selected = frame.selected;
    if (selected && !bodies.some((body) => body.key === selected.key)) {
      const path = this.options.smallBodyOrbitPathAu(selected);
      const screens = path?.map((point) => this.options.worldToScreen(point.xAu, point.yAu));
      if (screens && screens.some((point) => pointInRect(point, rect))) this.strokeOrbitPath(screens, true);
    }
    ctx.restore();
  }

  drawComparisonGuide() {
    const frame = this.options.frame();
    if (!frame.selected || !frame.compareTarget) return;
    const points = [frame.selected, frame.compareTarget].map(this.options.bodyToScreen);
    if (points.some((point) => !pointInRect(point, expandedRect(frame.viewport, 80)))) return;
    const ctx = this.options.context;
    ctx.save();
    ctx.strokeStyle = "rgba(236, 183, 89, 0.82)";
    ctx.fillStyle = "rgba(236, 183, 89, 0.95)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    ctx.setLineDash([]);
    points.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fill();
      this.drawLabel(index === 0 ? "A" : "B", point.x + 10, point.y - 10, "rgba(236, 183, 89, 0.9)");
    });
    ctx.restore();
  }

  drawBodies() {
    const frame = this.options.frame();
    const ctx = this.options.context;
    ctx.save();
    for (const body of frame.visibleBodies) {
      const selectedOrHover = body.key === frame.selected?.key || body.key === frame.hoverKey;
      if (frame.pointRendererAvailable && !selectedOrHover) continue;
      this.drawBodyPoint(body, this.options.bodyToScreen(body), selectedOrHover, frame.selectedKey);
    }
    ctx.restore();
  }

  drawLabels() {
    const frame = this.options.frame();
    const occupied: Rect[] = [];
    const ctx = this.options.context;
    ctx.save();
    ctx.font = "12px Inter, system-ui, sans-serif";
    for (const body of frame.labelBodies) {
      const screen = this.options.bodyToScreen(body);
      const width = ctx.measureText(body.name).width + 18;
      const rect = { left: screen.x + 10, top: screen.y - 30, right: screen.x + 10 + width, bottom: screen.y - 8, width, height: 22 };
      if (!rectInCanvas(rect) || occupied.some((item) => rectsOverlap(item, rect))) continue;
      occupied.push(rect);
      this.drawLabel(body.name, rect.left, rect.top + 15, body.key === frame.selectedKey ? "rgba(248, 218, 136, 0.95)" : "rgba(239, 233, 213, 0.76)");
    }
    ctx.restore();
  }

  drawEdgeReferences() {
    const frame = this.options.frame();
    const rect = frame.viewport;
    const selectedScreen = frame.selected ? this.options.bodyToScreen(frame.selected) : null;
    const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
    const origin = selectedScreen && pointInRect(selectedScreen, rect) ? selectedScreen : center;
    this.edgeHitRegions = [];
    const ctx = this.options.context;
    ctx.save();
    ctx.font = "11px Inter, system-ui, sans-serif";
    for (const reference of frame.edgeBodies.slice(0, 8)) {
      const edge = edgeAnchorForScreen(reference.screen, origin, rect);
      const labelRect = this.edgeLabelRect(reference.body.name, edge.point, edge.side, rect);
      const hitRect = expandedRect(rectUnion(labelRect, pointRect(edge.point, 16)), 4);
      this.drawEdgeChevron(edge.point, edge.side, reference.body.color || "#d9b86f", frame.hoverKey === reference.body.key);
      this.drawLabel(reference.body.name, labelRect.left + 6, labelRect.top + 15, frame.hoverKey === reference.body.key ? "rgba(248, 218, 136, 0.95)" : "rgba(239, 233, 213, 0.68)");
      this.edgeHitRegions.push({ body: reference.body, rect: hitRect });
    }
    ctx.restore();
  }

  edgeReferenceAt(x: number, y: number) {
    return this.edgeHitRegions.find((entry) => pointInRect({ x, y }, entry.rect))?.body ?? null;
  }

  drawLabel = (text: string, x: number, y: number, color: string) => {
    const ctx = this.options.context;
    ctx.save();
    ctx.fillStyle = "rgba(8, 10, 9, 0.72)";
    ctx.strokeStyle = "rgba(239, 233, 213, 0.13)";
    const width = ctx.measureText(text).width + 12;
    roundedRect(ctx, x - 6, y - 15, width, 22, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  };

  private drawScaleBar(rect: Rect, stepAu: number, camera: Camera) {
    const lengthPx = Math.min(180, Math.max(64, stepAu * camera.pxPerAu));
    const x = rect.left + 24;
    const y = rect.bottom - 34;
    const ctx = this.options.context;
    ctx.strokeStyle = "rgba(239, 233, 213, 0.72)";
    ctx.fillStyle = "rgba(239, 233, 213, 0.82)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lengthPx, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x + lengthPx, y - 5);
    ctx.lineTo(x + lengthPx, y + 5);
    ctx.stroke();
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.fillText(this.options.formatDistance((lengthPx / camera.pxPerAu) * this.options.auKm()), x, y - 10);
  }

  private strokeOrbitPath(screens: ScreenPoint[], highlighted: boolean) {
    const ctx = this.options.context;
    ctx.strokeStyle = highlighted ? "rgba(248, 218, 136, 0.72)" : "rgba(136, 189, 166, 0.36)";
    ctx.lineWidth = highlighted ? 1.8 : 1.15;
    ctx.beginPath();
    screens.forEach((screen, index) => index === 0 ? ctx.moveTo(screen.x, screen.y) : ctx.lineTo(screen.x, screen.y));
    ctx.closePath();
    ctx.stroke();
  }

  private orbitGuideScreens(body: Body) {
    const orbit = body.orbit;
    const parent = this.options.bodyByKey().get(body.parent_key ?? "");
    if (!orbit || !parent || !orbit.semi_major_axis_km || orbit.semi_major_axis_km <= 0) return null;
    const aAu = orbit.semi_major_axis_km / this.options.auKm();
    const eccentricity = clamp(orbit.eccentricity ?? 0, 0, 0.98);
    const pAu = aAu * (1 - eccentricity * eccentricity);
    const omega = degToRad(orbit.argument_of_periapsis_deg ?? 0);
    const inclination = degToRad(orbit.inclination_deg ?? 0);
    const ascendingNode = degToRad(orbit.longitude_of_ascending_node_deg ?? 0);
    const screens: ScreenPoint[] = [];
    for (let index = 0; index <= 180; index += 1) {
      const anomaly = (index / 180) * Math.PI * 2;
      const radiusAu = pAu / Math.max(0.02, 1 + eccentricity * Math.cos(anomaly));
      const orbitalX = radiusAu * Math.cos(anomaly);
      const orbitalY = radiusAu * Math.sin(anomaly);
      const argX = Math.cos(omega) * orbitalX - Math.sin(omega) * orbitalY;
      const argY = Math.sin(omega) * orbitalX + Math.cos(omega) * orbitalY;
      const inclinedY = Math.cos(inclination) * argY;
      const worldX = parent.position.x_au + Math.cos(ascendingNode) * argX - Math.sin(ascendingNode) * inclinedY;
      const worldY = parent.position.y_au + Math.sin(ascendingNode) * argX + Math.cos(ascendingNode) * inclinedY;
      screens.push(this.options.worldToScreen(worldX, worldY));
    }
    return screens;
  }

  private drawBodyPoint(body: Body, screen: ScreenPoint, active: boolean, selectedKey: string) {
    const ctx = this.options.context;
    const radius = this.options.bodyDisplayRadiusPx(body);
    ctx.save();
    ctx.globalAlpha = active ? 1 : POINT_ALPHA;
    ctx.fillStyle = body.color || "#d9b86f";
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (active) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = body.key === selectedKey ? "rgba(248, 218, 136, 0.95)" : "rgba(177, 218, 205, 0.82)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + SELECTION_RING_PX, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEdgeChevron(point: ScreenPoint, side: EdgeSide, color: string, active: boolean) {
    const length = active ? 13 : 10;
    const spread = active ? 6 : 4.5;
    const direction = side === "left" ? { x: 1, y: 0 } : side === "right" ? { x: -1, y: 0 } : side === "top" ? { x: 0, y: 1 } : { x: 0, y: -1 };
    const normal = { x: -direction.y, y: direction.x };
    const tip = { x: point.x + direction.x * length, y: point.y + direction.y * length };
    const ctx = this.options.context;
    ctx.save();
    ctx.strokeStyle = active ? "rgba(248, 218, 136, 0.95)" : `${color}cc`;
    ctx.lineWidth = active ? 2.4 : 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(point.x + normal.x * spread, point.y + normal.y * spread);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(point.x - normal.x * spread, point.y - normal.y * spread);
    ctx.stroke();
    ctx.restore();
  }

  private edgeLabelRect(text: string, anchor: ScreenPoint, side: EdgeSide, bounds: Rect): Rect {
    const width = this.options.context.measureText(text).width + 12;
    const height = 22;
    let left = anchor.x + 10;
    let top = anchor.y - height / 2;
    if (side === "right") left = anchor.x - width - 10;
    if (side === "top") {
      left = anchor.x - width / 2;
      top = anchor.y + 10;
    }
    if (side === "bottom") {
      left = anchor.x - width / 2;
      top = anchor.y - height - 10;
    }
    left = clamp(left, bounds.left + 3, bounds.right - width - 3);
    top = clamp(top, bounds.top + 3, bounds.bottom - height - 3);
    return { left, top, right: left + width, bottom: top + height, width, height };
  }
}

function rectInCanvas(rect: Rect) {
  return rect.right >= 0 && rect.left <= window.innerWidth && rect.bottom >= 0 && rect.top <= window.innerHeight;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
