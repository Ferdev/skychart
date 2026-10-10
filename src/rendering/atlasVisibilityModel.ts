import { hasBodyPosition } from "../catalog/spacecraftCatalog";
import type { Body, BodyHitEntry, Camera, CatalogPointHitEntry, Ephemeris } from "../atlas/contracts";
import type { CatalogPointPlanner } from "../catalog/catalogPointPlanner";
import type { CatalogPointStream } from "../catalog/catalogPointStream";
import { catalogPointVertexStrideFloats } from "../catalog/catalogPointSelector";
import { CURATED_HOST_GROUP, EXOPLANET_HOST_GROUP, isExoplanetHostStar, orbitsHostStar } from "../catalog/exoplanetGroups";
import { exoplanetOrbitReachAu, isExoplanetOrbitResolved, isPositionedExoplanet, isRingOnlyExoplanet } from "../catalog/exoplanetOrbit";
import { classifyBody } from "../destinationPicker";
import { expandedRect, pointInRect, type Rect, type ScreenPoint } from "../geometry";
import { labelClass, rankLabels } from "../labels/labelRank";
import { isUnresolvedSeparation, pickBody, type BodyPickHit } from "./bodyPick";

type VisibilityFrame = {
  ephemeris: Ephemeris | null;
  camera: Camera;
  viewport: Rect;
  renderViewport: Rect;
  selectedKey: string;
  compareTargetKey: string | null;
  hoverKey: string | null;
  transientSelectedKey: string | null;
  viewWidthLy: number;
};

type AtlasVisibilityModelOptions = {
  frame: () => VisibilityFrame;
  stream: CatalogPointStream;
  planner: CatalogPointPlanner;
  matchesActiveFilter: (body: Body) => boolean;
  auKm: () => number;
  bodyDistanceKm: (left: Body, right: Body) => number;
  recordHitTestMs: (milliseconds: number) => void;
  featuredKeys: readonly string[];
};

const BODY_GRID_CELL_PX = 56;
const POINT_GRID_CELL_PX = 4;
const POINT_HIT_RADIUS_PX = 6;
const MAP_POINT_RADIUS_PX = 1.3;
// A planet is much smaller than its orbit, so its marker has a readable minimum size.
const EXOPLANET_MARKER_RADIUS_PX = 3;
// A curated nearby host and its archive record come from the same archive
// coordinates. Measured on 2026-10-08, the 16 pairs are 0.0 AU apart.
const HOST_TWIN_TOLERANCE_AU = 0.01;
// Neptune's orbit is 60 AU wide. Below this size on the screen the planets are one point.
const SOLAR_SYSTEM_DIAMETER_AU = 60;
const SOLAR_SYSTEM_MIN_PX = 24;
// Object types that get an edge pointer only when they are featured.
const EDGE_MINOR_TYPES = new Set(["asteroid", "comet", "small_body", "spacecraft"]);
/** With more small bodies or catalog codes than this in view, they get no label. */
const MINOR_LABEL_CROWD = 12;
// Stands for each exoplanet host star when the model asks if the active filter shows the hosts.
const EXOPLANET_HOST_PROBE = { key: "", name: "", radius_km: 0, object_type: "star", catalog_group: EXOPLANET_HOST_GROUP } as Body;

/** Owns scale-aware body visibility, label priority, and body/catalog spatial indexes. */
export class AtlasVisibilityModel {
  private visibleCache: Body[] | null = null;
  private bodyGrid = new Map<string, BodyHitEntry[]>();
  private pointGrid = new Map<string, CatalogPointHitEntry>();
  private bodyGridValid = false;
  private pointGridValid = false;
  private curatedHostCache: Body[] | null = null;
  private resolvedExoplanetCache: Body[] | null = null;
  private bodyIndexCache: Map<string, Body> | null = null;

  constructor(private readonly options: AtlasVisibilityModelOptions) {}

  invalidate() {
    this.visibleCache = null;
    this.curatedHostCache = null;
    this.resolvedExoplanetCache = null;
    this.bodyIndexCache = null;
    this.bodyGridValid = false;
    this.pointGridValid = false;
  }

  visibleBodies() {
    if (this.visibleCache) return this.visibleCache;
    const frame = this.options.frame();
    const rect = expandedRect(frame.renderViewport, 80);
    this.visibleCache = (frame.ephemeris?.bodies ?? []).filter((body) => {
      const pinned = body.key === frame.selectedKey || body.key === frame.compareTargetKey || body.key === frame.hoverKey;
      if (!pinned && !this.options.matchesActiveFilter(body)) return false;
      if (!this.shouldRenderAtScale(body, frame)) return false;
      return pointInRect(this.bodyToScreen(body, frame), rect);
    });
    return this.visibleCache;
  }

  /** The body that a click or hover at this point selects. See `pickBody` for the rule. */
  nearestBody(x: number, y: number) {
    const startedAt = performance.now();
    if (!this.bodyGridValid) this.rebuildBodyGrid();
    const frame = this.options.frame();
    const hits: (BodyPickHit & { body: Body })[] = [];
    const cellX = Math.floor(x / BODY_GRID_CELL_PX);
    const cellY = Math.floor(y / BODY_GRID_CELL_PX);
    const seen = new Set<string>();
    for (let gx = cellX - 1; gx <= cellX + 1; gx += 1) {
      for (let gy = cellY - 1; gy <= cellY + 1; gy += 1) {
        for (const entry of this.bodyGrid.get(`${gx}:${gy}`) ?? []) {
          if (entry.body.key === frame.transientSelectedKey || seen.has(entry.body.key)) continue;
          seen.add(entry.body.key);
          const distancePx = Math.hypot(entry.x - x, entry.y - y);
          if (distancePx > entry.radius) continue;
          hits.push({ body: entry.body, key: entry.body.key, parentKey: entry.body.parent_key, x: entry.x, y: entry.y, distancePx, priority: this.typePriority(entry.body) });
        }
      }
    }
    const picked = pickBody(hits);
    this.options.recordHitTestMs(performance.now() - startedAt);
    return picked ? { body: picked.body, distancePx: picked.distancePx } : null;
  }

  nearestCatalogPoint(x: number, y: number): CatalogPointHitEntry | null {
    if (!this.options.stream.hasActiveLayer()) return null;
    if (!this.pointGridValid) this.rebuildPointGrid();
    let nearest: (CatalogPointHitEntry & { distancePx: number }) | null = null;
    const cellX = Math.floor(x / POINT_GRID_CELL_PX);
    const cellY = Math.floor(y / POINT_GRID_CELL_PX);
    const radius = Math.ceil(POINT_HIT_RADIUS_PX / POINT_GRID_CELL_PX);
    for (let gx = cellX - radius; gx <= cellX + radius; gx += 1) {
      for (let gy = cellY - radius; gy <= cellY + radius; gy += 1) {
        const entry = this.pointGrid.get(`${gx}:${gy}`);
        if (!entry) continue;
        const distancePx = Math.hypot(entry.x - x, entry.y - y);
        if (distancePx <= entry.radius && (!nearest || distancePx < nearest.distancePx)) nearest = { ...entry, distancePx };
      }
    }
    return nearest;
  }

  /**
   * Bodies that can get a label, best first: the selected and the hovered body, then the label class
   * (major body, named object, minor body, catalog designation), then the type rank,
   * then the distance from the map centre. The payload order has no effect.
   */
  prioritizedLabelBodies() {
    const frame = this.options.frame();
    const center = { x: frame.viewport.left + frame.viewport.width / 2, y: frame.viewport.top + frame.viewport.height / 2 };
    // The pointer does not change the rank of a label: a label that moves away from the pointer cannot be used.
    const pinned = (body: Body) => body.key === frame.selectedKey || body.key === frame.hoverKey || this.options.featuredKeys.includes(body.key);
    const all = this.visibleBodies()
      .filter((body) => pinned(body) || this.isMajorBody(body, frame) || frame.camera.pxPerAu > 12)
      .map((body) => {
        const screen = this.bodyToScreen(body, frame);
        const point = { key: body.key, name: body.name, objectType: body.object_type, selected: body.key === frame.selectedKey };
        return { ...point, labelClass: labelClass(point), body, typePriority: this.typePriority(body), distancePx: Math.hypot(screen.x - center.x, screen.y - center.y) };
      });
    // Labels for a few of many small bodies or catalog codes are noise. They show when few are in view.
    const isCrowdClass = (candidate: { labelClass: string }) => candidate.labelClass === "minor" || candidate.labelClass === "designation";
    const crowded = all.filter(isCrowdClass).length > MINOR_LABEL_CROWD;
    const candidates = crowded ? all.filter((candidate) => !isCrowdClass(candidate) || pinned(candidate.body)) : all;
    // One tie-break number: the type rank is first (higher is better), then the nearer body.
    return rankLabels(candidates, (candidate) => (100 - candidate.typePriority) * 1e7 + candidate.distancePx)
      .slice(0, 40)
      .map((candidate) => candidate.body);
  }

  /**
   * Off-screen bodies for the edge pointers, best first. A pointer is for an object that helps the user
   * find the way: the label class is first, then the distance. A minor body or a spacecraft gets a pointer
   * only when it is featured (the selected body has no pointer: it has its own controls).
   */
  edgeReferenceBodies() {
    const frame = this.options.frame();
    const selected = frame.ephemeris?.bodies.find((body) => body.key === frame.selectedKey) ?? null;
    const references = (frame.ephemeris?.bodies ?? [])
      .filter((body) => {
        if (body.key === frame.selectedKey) return false;
        if (!this.options.matchesActiveFilter(body) || !this.shouldRenderAtScale(body, frame)) return false;
        const featured = this.options.featuredKeys.includes(body.key);
        if (EDGE_MINOR_TYPES.has(body.object_type ?? "") && !featured) return false;
        if (labelClass({ key: body.key, name: body.name, objectType: body.object_type }) === "designation" && !featured) return false;
        if (frame.viewWidthLy >= 6_000 && !this.isMajorBody(body, frame) && !featured) return false;
        return true;
      })
      .map((body) => ({
        key: body.key,
        name: body.name,
        objectType: body.object_type,
        body,
        screen: this.bodyToScreen(body, frame),
        selectedDistanceKm: selected ? this.options.bodyDistanceKm(selected, body) : body.distance_from_earth_km,
      }))
      .filter(({ screen }) => !pointInRect(screen, frame.renderViewport));
    return rankLabels(references, (reference) => reference.selectedDistanceKm)
      .map(({ body, screen }) => ({ body, screen }));
  }

  /** True when the planets are too near to the Sun on the screen to show: one `Solar System` marker stands for them. */
  solarSystemCollapsed() {
    return SOLAR_SYSTEM_DIAMETER_AU * this.options.frame().camera.pxPerAu < SOLAR_SYSTEM_MIN_PX;
  }

  bodyDisplayRadiusPx(body: Body) {
    const minimumPx = body.object_type === "spacecraft" ? 3.5 : isPositionedExoplanet(body) ? EXOPLANET_MARKER_RADIUS_PX : MAP_POINT_RADIUS_PX;
    return Math.max(minimumPx, this.bodyRadiusAu(body) * this.options.frame().camera.pxPerAu);
  }

  bodyRadiusAu(body: Body) {
    return Number.isFinite(body.radius_km) && body.radius_km > 0 ? body.radius_km / this.options.auKm() : 0;
  }

  isPointLayerDuplicateBody(body: Body) {
    // A tile point for an exoplanet is at the host star. The body with the
    // orbit offset must draw, so no tile layer owns it.
    if (isPositionedExoplanet(body)) return false;
    return Boolean(body.catalog_group && this.options.planner.ownsCatalogGroup(body.catalog_group, this.options.frame().camera.pxPerAu));
  }

  /** False for a planet that has a ring and no marker: nothing on the map marks a position for it. */
  hasMapMarker(body: Body | null) {
    return !body || !isRingOnlyExoplanet(body, this.options.frame().camera.pxPerAu);
  }

  /**
   * Exoplanets whose orbit ring is wide enough to draw. The ring of an
   * orbit-only planet is in this list too; such a planet has no marker.
   */
  resolvedExoplanets() {
    if (this.resolvedExoplanetCache) return this.resolvedExoplanetCache;
    const frame = this.options.frame();
    const rect = expandedRect(frame.renderViewport, 160);
    this.resolvedExoplanetCache = (frame.ephemeris?.bodies ?? []).filter((body) => {
      if (!orbitsHostStar(body) || !isExoplanetOrbitResolved(body, frame.camera.pxPerAu)) return false;
      if (body.key !== frame.selectedKey && !this.options.matchesActiveFilter(body)) return false;
      const host = body.exoplanet_orbit!.host_position;
      const reachPx = (exoplanetOrbitReachAu(body) ?? 0) * frame.camera.pxPerAu;
      const center = this.worldToScreen(host.x_au, host.y_au, frame);
      return center.x + reachPx >= rect.left && center.x - reachPx <= rect.right
        && center.y + reachPx >= rect.top && center.y - reachPx <= rect.bottom;
    });
    return this.resolvedExoplanetCache;
  }

  private shouldRenderAtScale(body: Body, frame: VisibilityFrame) {
    if (!hasBodyPosition(body)) return false;
    const width = frame.viewWidthLy;
    if (body.key === frame.selectedKey) return true;
    // At a large scale the Sun marker stands for the Solar System (label `Solar System`).
    if (isSolarSystemBody(body) && body.key !== "sun" && SOLAR_SYSTEM_DIAMETER_AU * frame.camera.pxPerAu < SOLAR_SYSTEM_MIN_PX) return false;
    if (!this.isResolvedFromParent(body, frame)) return false;
    if (body.key === frame.hoverKey || this.options.featuredKeys.includes(body.key)) return true;
    if (body.object_type === "spacecraft") return width < 0.03;
    if (orbitsHostStar(body)) return this.rendersExoplanet(body, frame);
    if (body.catalog_group === EXOPLANET_HOST_GROUP && this.hasCuratedTwin(body, frame)) return false;
    if (body.catalog_group === "jpl_small_bodies" && width > 2) return false;
    if (["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"].includes(body.catalog_group ?? "") && width >= 6_000) return false;
    if (body.catalog_group === "simbad_extragalactic" && width < 15_000) return false;
    if (width >= 6_000 && isSolarSystemBody(body) && body.key !== frame.selectedKey && body.key !== frame.hoverKey && body.key !== "sun") return false;
    if (width >= 20_000 && body.catalog_group === "bright_stars") return false;
    if (isSolarSystemBody(body)) return true;
    if (width >= 6_000 && isExoplanetHostStar(body)) return false;
    return true;
  }

  /**
   * An exoplanet has its own marker when its orbit is resolved and its
   * position is calculated. At a smaller scale the host star represents the
   * system, unless the active filter hides the host stars.
   */
  private rendersExoplanet(body: Body, frame: VisibilityFrame) {
    if (isExoplanetOrbitResolved(body, frame.camera.pxPerAu)) return body.exoplanet_orbit?.display_state === "position";
    return !this.options.matchesActiveFilter(EXOPLANET_HOST_PROBE);
  }

  /** One star has one marker: the archive host record yields to the curated record at the same position. */
  private hasCuratedTwin(body: Body, frame: VisibilityFrame) {
    this.curatedHostCache ??= (frame.ephemeris?.bodies ?? []).filter(
      (candidate) => candidate.catalog_group === CURATED_HOST_GROUP && this.options.matchesActiveFilter(candidate),
    );
    return this.curatedHostCache.some((host) => (
      Math.abs(host.position.x_au - body.position.x_au) < HOST_TWIN_TOLERANCE_AU
      && Math.abs(host.position.y_au - body.position.y_au) < HOST_TWIN_TOLERANCE_AU
      && Math.abs(host.position.z_au - body.position.z_au) < HOST_TWIN_TOLERANCE_AU
    ));
  }

  private rebuildBodyGrid() {
    this.bodyGrid = new Map();
    const frame = this.options.frame();
    for (const body of this.visibleBodies()) {
      const screen = this.bodyToScreen(body, frame);
      const radius = Math.max(this.bodyDisplayRadiusPx(body) + 6, body.key === frame.selectedKey || body.key === frame.hoverKey ? 12 : 7);
      const entry = { body, x: screen.x, y: screen.y, radius };
      for (let gx = Math.floor((screen.x - radius) / BODY_GRID_CELL_PX); gx <= Math.floor((screen.x + radius) / BODY_GRID_CELL_PX); gx += 1) {
        for (let gy = Math.floor((screen.y - radius) / BODY_GRID_CELL_PX); gy <= Math.floor((screen.y + radius) / BODY_GRID_CELL_PX); gy += 1) {
          const key = `${gx}:${gy}`;
          const bucket = this.bodyGrid.get(key);
          if (bucket) bucket.push(entry);
          else this.bodyGrid.set(key, [entry]);
        }
      }
    }
    this.bodyGridValid = true;
  }

  private rebuildPointGrid() {
    this.pointGrid = new Map();
    const frame = this.options.frame();
    const rect = expandedRect(frame.renderViewport, 12);
    for (const tile of this.options.stream.activeTiles()) {
      const payload = tile.payload;
      if (!payload || payload.returned === 0) continue;
      const stride = catalogPointVertexStrideFloats(payload);
      for (let index = 0; index < payload.returned; index += 1) {
        const offset = index * stride;
        const screen = this.worldToScreen(payload.origin.x + (payload.vertices[offset] ?? 0), payload.origin.y + (payload.vertices[offset + 1] ?? 0), frame);
        if (!pointInRect(screen, rect)) continue;
        const cellX = Math.floor(screen.x / POINT_GRID_CELL_PX);
        const cellY = Math.floor(screen.y / POINT_GRID_CELL_PX);
        const key = `${cellX}:${cellY}`;
        const existing = this.pointGrid.get(key);
        if (existing) {
          const centerX = (cellX + 0.5) * POINT_GRID_CELL_PX;
          const centerY = (cellY + 0.5) * POINT_GRID_CELL_PX;
          if (Math.hypot(existing.x - centerX, existing.y - centerY) <= Math.hypot(screen.x - centerX, screen.y - centerY)) continue;
        }
        this.pointGrid.set(key, { x: screen.x, y: screen.y, radius: POINT_HIT_RADIUS_PX, tile, pointIndex: index });
      }
    }
    this.pointGridValid = true;
  }

  private isMajorBody(body: Body, frame: VisibilityFrame) {
    // The rule is by group: an exoplanet is a major body only where it has its own marker.
    if (orbitsHostStar(body)) return body.key === frame.selectedKey || this.rendersExoplanet(body, frame);
    const type = classifyBody(body).type;
    return body.key === "sun" || type === "planet" || type === "galaxy" || type === "quasar" || type === "active_galaxy" ||
      body.key === frame.selectedKey || this.options.featuredKeys.includes(body.key) ||
      (type === "star" && isExoplanetHostStar(body)) ||
      (type === "star" && body.catalog_group === "bright_stars" && (body.stellar?.apparent_magnitude ?? 99) <= 1.5);
  }

  private labelPriority(body: Body, frame: VisibilityFrame) {
    if (body.key === frame.selectedKey) return 100;
    if (body.key === frame.hoverKey) return 90;
    return this.typePriority(body);
  }

  /** Rank of the object type, with no effect from selection or hover. Labels and hit tests use it. */
  private typePriority(body: Body) {
    const type = classifyBody(body).type;
    if (body.key === "sun") return 80;
    // An exoplanet is below its host star, so that the star keeps its label.
    if (orbitsHostStar(body)) return 30;
    if (type === "planet") return 70;
    if (type === "moon") return 42;
    if (type === "star") return 36;
    return type === "quasar" || type === "active_galaxy" ? 34 : 20;
  }

  /**
   * A moon has its own marker when it is 6 px or more from its parent on the screen.
   * Nearer than that, the parent marker stands for the moon.
   */
  private isResolvedFromParent(body: Body, frame: VisibilityFrame) {
    if (body.object_type !== "moon" || !body.parent_key) return true;
    const parent = this.bodyIndex(frame).get(body.parent_key);
    if (!parent || !hasBodyPosition(parent)) return true;
    return !isUnresolvedSeparation(this.bodyToScreen(body, frame), this.bodyToScreen(parent, frame));
  }

  private bodyIndex(frame: VisibilityFrame) {
    this.bodyIndexCache ??= new Map((frame.ephemeris?.bodies ?? []).map((body) => [body.key, body]));
    return this.bodyIndexCache;
  }

  private bodyToScreen(body: Body, frame: VisibilityFrame) {
    return this.worldToScreen(body.position.x_au, body.position.y_au, frame);
  }

  private worldToScreen(xAu: number, yAu: number, frame: VisibilityFrame): ScreenPoint {
    return {
      x: frame.viewport.left + frame.viewport.width / 2 + (xAu - frame.camera.xAu) * frame.camera.pxPerAu,
      y: frame.viewport.top + frame.viewport.height / 2 - (yAu - frame.camera.yAu) * frame.camera.pxPerAu,
    };
  }
}

export function isSolarSystemBody(body: Body) {
  return body.catalog_group === "core" || body.catalog_group?.endsWith("_moons");
}

export function countBodies(bodies: Body[]) {
  return bodies.reduce((counts, body) => {
    const type = classifyBody(body).type;
    if (isSolarSystemBody(body) || type === "planet" || type === "moon") counts.solar += 1;
    if (type === "asteroid" || type === "comet" || type === "small_body") counts.smallBodies += 1;
    if (type === "star" && body.catalog_group !== "core") counts.stars += 1;
    if (body.catalog_group === "exoplanet_systems" || body.catalog_group === "nearby_exoplanet_systems") counts.exoplanetSystems += 1;
    if (body.catalog_group === "messier_deep_sky" || body.catalog_group === "simbad_extragalactic") counts.deepSky += 1;
    return counts;
  }, { solar: 0, stars: 0, smallBodies: 0, exoplanetSystems: 0, deepSky: 0 });
}
