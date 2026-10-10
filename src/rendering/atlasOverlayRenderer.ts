import type { Body, Camera, Ephemeris } from "../atlas/contracts";
import type { SmallBodyPosition } from "../catalog/smallBodyPropagation";
import { isPlanetCandidate } from "../catalog/exoplanetGroups";
import { exoplanetOrbitPathAu, exoplanetOrbitReachAu, exoplanetUncertaintyPathAu, isPositionedExoplanet, isRingOnlyExoplanet } from "../catalog/exoplanetOrbit";
import { t } from "../i18n";
import { placeLabels } from "../labels/labelRank";
import type { UniverseEntryMarker } from "../atlas/universeEntryMarker";
import { clamp, degToRad, edgeAnchorForScreen, expandedRect, niceStep, pointInRect, pointRect, rectsOverlap, rectUnion, type EdgeSide, type Rect, type ScreenPoint } from "../geometry";
import { canvasFont } from "../format/fonts";

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
  renderViewport: Rect;
  visibleBodies: Body[];
  labelBodies: Body[];
  edgeBodies: EdgeBody[];
  exoplanetOrbits: Body[];
  /** The planets are one point at this scale: the Sun label is `Solar System`. */
  solarSystemCollapsed: boolean;
  /** The left end of the scale bar line. */
  scaleBarOrigin: ScreenPoint;
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
  pxPerAu: () => number;
  auKm: () => number;
  formatDistance: (kilometers: number) => string;
  smallBodyOrbitPathAu: (body: Body) => SmallBodyPosition[] | null;
  universeEntryMarker: UniverseEntryMarker;
  /** Page element that shows the map notes where the toolbar covers the canvas lines. */
  exoplanetOrbitNote: HTMLElement;
  toolbar: HTMLElement;
};

const POINT_ALPHA = 0.82;
// Places for a label, in order of preference: [side, row]. Side 1 is right of the object and -1 is left.
// Row -1 is above the object and row 1 is below; rows -2 and 2 are one label height more distant.
const LABEL_ANCHORS: readonly (readonly [number, number])[] = [[1, -1], [-1, -1], [1, 1], [-1, 1], [1, -2], [-1, -2], [1, 2], [-1, 2]];
const LABEL_NEAR_ANCHORS = 4;
const EDGE_POINTER_LIMIT_WIDE = 5;
const EDGE_POINTER_LIMIT_NARROW = 3;
const SELECTION_RING_PX = 8.5;
// Orbit guides are polylines; a fixed sample count makes their chords drift
// visibly off the true ellipse once the on-screen orbit radius grows large.
const ORBIT_MIN_SAMPLES = 180;
const ORBIT_MAX_SAMPLES = 8192;
// An exoplanet ring is dashed and blue. A Solar System orbit is a solid green
// line from a measured state; the direction of an exoplanet ring is a convention.
const EXOPLANET_ORBIT_DASH = [6, 5];
const EXOPLANET_ORBIT_COLOR = "rgba(137, 214, 255, 0.5)";
const EXOPLANET_UNCERTAINTY_COLOR = "rgba(137, 214, 255, 0.34)";
const EXOPLANET_UNCERTAINTY_WIDTH_PX = 7;
// The ring of a planet candidate is dotted and violet: a candidate is not a
// confirmed planet, and the atlas calculates its orbit size.
const CANDIDATE_ORBIT_DASH = [1.5, 5];
const CANDIDATE_ORBIT_COLOR = "rgba(201, 184, 255, 0.6)";
const CANDIDATE_UNCERTAINTY_COLOR = "rgba(201, 184, 255, 0.34)";

/** Draws the navigational overlays layered above the catalog point renderer. */
export class AtlasOverlayRenderer {
  private edgeHitRegions: { body: Body; rect: Rect }[] = [];
  // Rectangles of the object labels of this frame, so that a label reacts to the pointer like its object.
  private labelHitRegions: { body: Body; text: string; rect: Rect }[] = [];
  private scaleBarArea: Rect | null = null;
  private toolbarRect: Rect | null = null;
  private reservedAreas: Rect[] = [];
  // Canvas position of the note lines in this frame, or null when the frame has no note.
  private exoplanetNoteAnchor: ScreenPoint | null = null;
  // Text of the note lines in this frame: one sentence for each layer that draws by a convention.
  private exoplanetNoteText = "";
  private frameNotes: string[] = [];

  constructor(private readonly options: AtlasOverlayRendererOptions) {}

  drawGrid() {
    const frame = this.options.frame();
    const rect = frame.renderViewport;
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
    this.drawScaleBar(frame.scaleBarOrigin, step, frame.camera);
    ctx.restore();
  }

  /**
   * A layer that draws by a convention (exoplanet ring direction, constellation lines seen from above)
   * adds one sentence here. `finishFrame` draws the sentences above the scale bar.
   */
  addNote(text: string) {
    if (text && !this.frameNotes.includes(text)) this.frameNotes.push(text);
  }

  /** Draws the notes of this frame, and puts the `3D` mark and the page copy of the notes in place. */
  finishFrame() {
    const frame = this.options.frame();
    this.exoplanetNoteText = this.frameNotes.join(" ");
    this.frameNotes = [];
    // The labels and the edge pointers of this frame stay out of the scale bar and the toolbar.
    // (On a wide window the map continues below the toolbar.)
    const toolbar = this.options.toolbar.getBoundingClientRect();
    this.toolbarRect = toolbar.height > 0 ? toolbar : null;
    this.reservedAreas = [this.scaleBarArea, this.toolbarRect].filter((area): area is Rect => area !== null);
    this.scaleBarArea = null;
    if (this.exoplanetNoteText) this.drawExoplanetOrbitNote(frame.viewport);
    const center = this.options.worldToScreen(frame.camera.xAu, frame.camera.yAu);
    const selectedScreen = frame.selected ? this.options.bodyToScreen(frame.selected) : null;
    const selectedAtCenter = Boolean(selectedScreen && Math.hypot(selectedScreen.x - center.x, selectedScreen.y - center.y) < 28);
    // The key has six significant digits: an animation frame that moves the centre by less than a pixel is no change.
    const centerKey = `${frame.camera.xAu.toPrecision(6)}:${frame.camera.yAu.toPrecision(6)}`;
    this.options.universeEntryMarker.place(center, centerKey, selectedAtCenter);
    this.placeExoplanetOrbitNote();
  }

  /**
   * The canvas line above the scale bar states the convention, and the PNG
   * export contains it. Where the toolbar covers that line, the same text
   * shows as a page element above the toolbar. One of the two is visible.
   */
  private placeExoplanetOrbitNote() {
    const note = this.options.exoplanetOrbitNote;
    const anchor = this.exoplanetNoteAnchor;
    this.exoplanetNoteAnchor = null;
    if (anchor === null) {
      // No layout read in a frame with no exoplanet ring.
      if (!note.hidden) note.hidden = true;
      return;
    }
    const covered = this.toolbarCovers(anchor);
    note.hidden = !covered;
    if (!covered) return;
    note.style.bottom = `${Math.round(window.innerHeight - this.toolbarRect!.top + 8)}px`;
    if (note.textContent !== this.exoplanetNoteText) note.textContent = this.exoplanetNoteText;
  }

  drawOrbitGuides() {
    const frame = this.options.frame();
    this.drawExoplanetOrbits(frame);
    if (this.options.currentViewWidthAu() > 1_000) return;
    const bodies = (frame.ephemeris?.bodies ?? []).filter((body) => this.options.bodyMatchesActiveFilter(body) && body.orbit && body.parent_key && this.options.isSolarSystemBody(body));
    const rect = expandedRect(frame.renderViewport, 160);
    const ctx = this.options.context;
    ctx.save();
    for (const body of bodies) {
      const screens = this.orbitGuideScreens(body, rect);
      if (!screens) continue;
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

  /** Draws each resolved exoplanet ring, the 1-sigma phase arc on it, and one line that states the convention. */
  private drawExoplanetOrbits(frame: OverlayFrame) {
    if (frame.exoplanetOrbits.length === 0) return;
    const ctx = this.options.context;
    ctx.save();
    ctx.lineCap = "round";
    for (const body of frame.exoplanetOrbits) {
      const reachPx = (exoplanetOrbitReachAu(body) ?? 0) * this.options.pxPerAu();
      const samples = clamp(Math.ceil(Math.PI * Math.sqrt(reachPx)), ORBIT_MIN_SAMPLES, ORBIT_MAX_SAMPLES);
      const ring = exoplanetOrbitPathAu(body, samples);
      if (!ring) continue;
      const highlighted = body.key === frame.selectedKey;
      const candidate = isPlanetCandidate(body);
      ctx.setLineDash(candidate ? CANDIDATE_ORBIT_DASH : EXOPLANET_ORBIT_DASH);
      ctx.strokeStyle = highlighted ? "rgba(248, 218, 136, 0.78)" : candidate ? CANDIDATE_ORBIT_COLOR : EXOPLANET_ORBIT_COLOR;
      ctx.lineWidth = highlighted ? 1.8 : 1.15;
      this.strokePolyline(ring, true);
      const arc = exoplanetUncertaintyPathAu(body, samples);
      if (!arc) continue;
      ctx.setLineDash([]);
      ctx.strokeStyle = candidate ? CANDIDATE_UNCERTAINTY_COLOR : EXOPLANET_UNCERTAINTY_COLOR;
      ctx.lineWidth = EXOPLANET_UNCERTAINTY_WIDTH_PX;
      this.strokePolyline(arc, false);
    }
    ctx.restore();
    if (frame.exoplanetOrbits.some((body) => !isPlanetCandidate(body))) this.addNote(t("exoplanet.mapNote"));
    if (frame.exoplanetOrbits.some(isPlanetCandidate)) this.addNote(t("exoplanet.candidateMapNote"));
  }

  /**
   * True for a planet with no calculated position on a resolved orbit. It has
   * no marker and no label at the star: its highlighted ring is the selection.
   */
  private hasRingOnly(body: Body) {
    return isRingOnlyExoplanet(body, this.options.pxPerAu());
  }

  private strokePolyline(points: readonly SmallBodyPosition[], closed: boolean) {
    const ctx = this.options.context;
    ctx.beginPath();
    points.forEach((point, index) => {
      const screen = this.options.worldToScreen(point.xAu, point.yAu);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    if (closed) ctx.closePath();
    ctx.stroke();
  }

  /**
   * States above the scale bar that the ring direction is a convention, and
   * that a violet ring is a planet candidate. The line wraps on a narrow view.
   */
  private toolbarCovers(point: ScreenPoint): boolean {
    const toolbar = this.toolbarRect;
    return toolbar !== null && point.y >= toolbar.top && point.x >= toolbar.left && point.x <= toolbar.right;
  }

  private drawExoplanetOrbitNote(rect: Rect) {
    this.exoplanetNoteAnchor = { x: rect.left + 24, y: rect.bottom - 62 };
    // When the toolbar covers this corner, the page copy of the note shows above the toolbar.
    // The canvas text is not drawn then: a part of it would show at the side of the toolbar.
    if (this.toolbarCovers(this.exoplanetNoteAnchor)) return;
    const ctx = this.options.context;
    ctx.save();
    ctx.font = canvasFont(12);
    ctx.fillStyle = "rgba(190, 228, 245, 0.82)";
    const maxWidth = Math.max(120, rect.width - 48);
    const lines: string[] = [];
    for (const word of this.exoplanetNoteText.split(" ")) {
      const candidate = lines.length > 0 ? `${lines[lines.length - 1]} ${word}` : word;
      if (lines.length > 0 && ctx.measureText(candidate).width <= maxWidth) lines[lines.length - 1] = candidate;
      else lines.push(word);
    }
    lines.forEach((line, index) => ctx.fillText(line, rect.left + 24, rect.bottom - 62 - (lines.length - 1 - index) * 15));
    ctx.restore();
  }

  drawComparisonGuide() {
    const frame = this.options.frame();
    if (!frame.selected || !frame.compareTarget) return;
    const points = [frame.selected, frame.compareTarget].map(this.options.bodyToScreen);
    if (points.some((point) => !pointInRect(point, expandedRect(frame.renderViewport, 80)))) return;
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
      if (frame.pointRendererAvailable && !selectedOrHover && body.object_type !== "spacecraft" && !isPositionedExoplanet(body)) continue;
      if (this.hasRingOnly(body)) continue;
      this.drawBodyPoint(body, this.options.bodyToScreen(body), selectedOrHover, frame.selectedKey);
    }
    ctx.restore();
  }

  drawLabels() {
    const frame = this.options.frame();
    this.labelHitRegions = [];
    const ctx = this.options.context;
    ctx.save();
    ctx.font = canvasFont(12);
    // A label is fully inside the free map area, so that no panel covers a part of it.
    const bounds = expandedRect(frame.viewport, 2);
    const candidates = frame.labelBodies
      .filter((body) => !this.hasRingOnly(body))
      .map((body) => {
        const text = body.key === "sun" && frame.solarSystemCollapsed ? t("map.solarSystem") : body.name;
        return { body, text, screen: this.options.bodyToScreen(body), width: ctx.measureText(text).width + 18 };
      });
    const placed = placeLabels(candidates, {
      bounds,
      exclusions: this.reservedAreas,
      rectsFor: (candidate) => LABEL_ANCHORS.map(([side, row]) => {
        const left = side > 0 ? candidate.screen.x + 10 : candidate.screen.x - 10 - candidate.width;
        const top = row < 0 ? candidate.screen.y - 8 - 22 * -row - 4 * (-row - 1) : candidate.screen.y + 8 + 26 * (row - 1);
        return { left, top, right: left + candidate.width, bottom: top + 22 };
      }),
    });
    for (const { item, rect, anchorIndex } of placed) {
      // A label in the second row is not next to its object: a short line shows which object it names.
      if (anchorIndex >= LABEL_NEAR_ANCHORS) {
        ctx.strokeStyle = "rgba(239, 233, 213, 0.36)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(item.screen.x, item.screen.y);
        ctx.lineTo(rect.left < item.screen.x ? rect.right : rect.left, rect.top < item.screen.y ? rect.bottom : rect.top);
        ctx.stroke();
      }
      this.labelHitRegions.push({ body: item.body, text: item.text, rect: { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top } });
      this.drawLabel(item.text, rect.left, rect.top + 15, item.body.key === frame.selectedKey ? "rgba(248, 218, 136, 0.95)" : "rgba(239, 233, 213, 0.76)");
    }
    ctx.restore();
  }

  /** Forgets the label rectangles when the label layer is off, so that a hidden label cannot be selected. */
  clearLabels() {
    this.labelHitRegions = [];
  }

  /** The labels that the last frame drew, after the collision step. */
  drawnLabels(): readonly { body: Body; text: string; rect: Rect }[] {
    return this.labelHitRegions;
  }

  /** The object whose drawn label is at this point, or null. */
  labelAt(x: number, y: number) {
    return this.labelHitRegions.find((entry) => pointInRect({ x, y }, entry.rect))?.body ?? null;
  }

  drawEdgeReferences() {
    const frame = this.options.frame();
    const rect = frame.renderViewport;
    const selectedScreen = frame.selected ? this.options.bodyToScreen(frame.selected) : null;
    const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
    const origin = selectedScreen && pointInRect(selectedScreen, rect) ? selectedScreen : center;
    this.edgeHitRegions = [];
    const ctx = this.options.context;
    ctx.save();
    ctx.font = canvasFont(12);
    const limit = window.innerWidth < 900 ? EDGE_POINTER_LIMIT_NARROW : EDGE_POINTER_LIMIT_WIDE;
    // The candidates are in rank order. A pointer that would be on top of a drawn pointer is left out.
    for (const reference of frame.edgeBodies) {
      if (this.edgeHitRegions.length >= limit) break;
      const edge = edgeAnchorForScreen(reference.screen, origin, rect);
      const labelRect = this.edgeLabelRect(reference.body.name, edge.point, edge.side, rect);
      const hitRect = expandedRect(rectUnion(labelRect, pointRect(edge.point, 16)), 4);
      if (this.edgeHitRegions.some((drawn) => rectsOverlap(drawn.rect, hitRect))) continue;
      // A pointer does not go across an object label or the scale bar.
      if (this.labelHitRegions.some((label) => rectsOverlap(label.rect, labelRect))) continue;
      if (this.reservedAreas.some((area) => rectsOverlap(area, labelRect))) continue;
      this.drawEdgeChevron(edge.point, edge.side, reference.body.color || "#d9b86f", frame.hoverKey === reference.body.key);
      this.drawLabel(reference.body.name, labelRect.left + 6, labelRect.top + 15, frame.hoverKey === reference.body.key ? "rgba(248, 218, 136, 0.95)" : "rgba(239, 233, 213, 0.68)");
      this.edgeHitRegions.push({ body: reference.body, rect: hitRect });
    }
    ctx.restore();
  }

  /** The edge pointers that the last frame drew. */
  drawnEdgeReferences(): readonly { body: Body; rect: Rect }[] {
    return this.edgeHitRegions;
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

  private drawScaleBar(origin: ScreenPoint, stepAu: number, camera: Camera) {
    const lengthPx = Math.min(180, Math.max(64, stepAu * camera.pxPerAu));
    const { x, y } = origin;
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
    ctx.font = canvasFont(12);
    const text = this.options.formatDistance((lengthPx / camera.pxPerAu) * this.options.auKm());
    ctx.fillText(text, x, y - 10);
    const right = x + Math.max(lengthPx, ctx.measureText(text).width) + 8;
    this.scaleBarArea = { left: x - 8, top: y - 28, right, bottom: y + 10, width: right - x + 8, height: 38 };
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

  private orbitGuideScreens(body: Body, rect: Rect) {
    const orbit = body.orbit;
    const parent = this.options.bodyByKey().get(body.parent_key ?? "");
    if (!orbit || !parent || !orbit.semi_major_axis_km || orbit.semi_major_axis_km <= 0) return null;
    const aAu = orbit.semi_major_axis_km / this.options.auKm();
    const eccentricity = clamp(orbit.eccentricity ?? 0, 0, 0.98);
    const parentScreen = this.options.worldToScreen(parent.position.x_au, parent.position.y_au);
    const screenRadiusPx = aAu * (1 + eccentricity) * this.options.pxPerAu();
    // Cull against the orbit's on-screen circle rather than polyline vertices:
    // at deep zoom the sampled vertices can all fall outside the viewport even
    // though the orbit itself crosses it.
    if (!circleIntersectsRect(parentScreen, screenRadiusPx, rect)) return null;
    const pAu = aAu * (1 - eccentricity * eccentricity);
    const omega = degToRad(orbit.argument_of_periapsis_deg ?? 0);
    const inclination = degToRad(orbit.inclination_deg ?? 0);
    const ascendingNode = degToRad(orbit.longitude_of_ascending_node_deg ?? 0);
    // Chord sagitta of an N-gon is ~r·(2π/N)²/8; keep it under half a pixel so
    // the drawn line tracks the true ellipse at any zoom.
    const samples = clamp(Math.ceil(Math.PI * Math.sqrt(screenRadiusPx)), ORBIT_MIN_SAMPLES, ORBIT_MAX_SAMPLES);
    const anomalies: number[] = [];
    for (let index = 0; index <= samples; index += 1) anomalies.push((index / samples) * Math.PI * 2);
    // The osculating ellipse passes through the body's current position by
    // construction; include its true anomaly so the polyline does too.
    if (orbit.true_anomaly_deg !== null && orbit.true_anomaly_deg !== undefined && Number.isFinite(orbit.true_anomaly_deg)) {
      anomalies.push(degToRad(orbit.true_anomaly_deg));
      anomalies.sort((a, b) => a - b);
    }
    const screens: ScreenPoint[] = [];
    for (const anomaly of anomalies) {
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
    if (body.object_type === "spacecraft") {
      ctx.moveTo(screen.x, screen.y - radius);
      ctx.lineTo(screen.x + radius, screen.y);
      ctx.lineTo(screen.x, screen.y + radius);
      ctx.lineTo(screen.x - radius, screen.y);
      ctx.closePath();
    } else ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    if (body.exoplanet_orbit?.marker === "hollow") {
      // A hollow marker: the phase is uncertain or its uncertainty is not available.
      ctx.fillStyle = "rgba(8, 10, 9, 0.86)";
      ctx.fill();
      ctx.strokeStyle = body.color || "#d9b86f";
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else ctx.fill();
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

function circleIntersectsRect(center: ScreenPoint, radiusPx: number, rect: Rect) {
  const x = clamp(center.x, rect.left, rect.right);
  const y = clamp(center.y, rect.top, rect.bottom);
  return (center.x - x) ** 2 + (center.y - y) ** 2 <= radiusPx * radiusPx;
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
