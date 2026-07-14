import { escapeHtml, formatCount, formatInteger } from "../atlasFormatting";
import type { CatalogSummary, Ephemeris } from "./contracts";
import type { CatalogPointManifestRepository } from "../catalog/catalogPointManifest";
import type { CatalogPointPlanner } from "../catalog/catalogPointPlanner";
import type { CatalogPointStream } from "../catalog/catalogPointStream";
import type { PointRenderStats } from "../webglPointRenderer";
import { t } from "../i18n";
import { atlasDom } from "./atlasDom";

type PerfMetrics = {
  enabled: boolean;
  frameMs: number;
  drawMs: number;
  webglMs: number;
  bufferMs: number;
  hitTestMs: number;
  milkyWayMs: number;
  viewportMs: number;
  viewportLoads: number;
  pointRenderer: PointRenderStats;
};

type AtlasStatsViewOptions = {
  ephemeris: () => Ephemeris | null;
  catalogSummary: () => CatalogSummary | null;
  visibleBodyCount: () => number;
  manifest: CatalogPointManifestRepository;
  planner: CatalogPointPlanner;
  stream: CatalogPointStream;
  perf: () => PerfMetrics;
};

const EXTRAGALACTIC_TYPES = new Set(["galaxy", "quasar", "active_galaxy"]);
const MILKY_WAY_DETAIL_BUDGET_MS = 6;

/** Renders catalog coverage and opt-in performance diagnostics. */
export class AtlasStatsView {
  constructor(private readonly options: AtlasStatsViewOptions) {}

  updateStats() {
    const ephemeris = this.options.ephemeris();
    if (!ephemeris) return;
    const total = this.options.catalogSummary()?.object_count ?? ephemeris.catalog?.object_count ?? ephemeris.bodies.length;
    const mapped = this.mappedCatalogStats();
    const pointLayerShown = this.options.stream.stats().pointsInViewport ?? 0;
    const represented = this.options.visibleBodyCount() + pointLayerShown;
    const mappedTitle = mapped.total > 0
      ? t("status.mappedBreakdown", { count: formatInteger(mapped.total), stars: formatInteger(mapped.stars), extragalactic: formatInteger(mapped.extragalactic), other: formatInteger(mapped.other) })
      : t("status.mappedLoading");
    atlasDom.atlasStats.innerHTML = `
      <div title="${escapeHtml(t("status.searchableObjects", { count: formatInteger(total) }))}"><dt>${escapeHtml(t("status.searchable"))}</dt><dd>${formatCount(total)}</dd></div>
      <div title="${escapeHtml(mappedTitle)}" aria-label="${escapeHtml(mappedTitle)}"><dt>${escapeHtml(t("status.mapped"))}</dt><dd>${mapped.total > 0 ? formatCount(mapped.total) : "—"}</dd></div>
      <div title="${escapeHtml(t("status.selectableObjects", { count: formatInteger(represented) }))}"><dt>${escapeHtml(t("status.shown"))}</dt><dd>${formatCount(represented)}</dd></div>
      <div title="${escapeHtml(t("status.mappedStars", { count: formatInteger(mapped.stars) }))}"><dt>${escapeHtml(t("status.stars"))}</dt><dd>${mapped.total > 0 ? formatCount(mapped.stars) : "—"}</dd></div>
      <div title="${escapeHtml(t("status.mappedExtragalactic", { count: formatInteger(mapped.extragalactic) }))}"><dt>${escapeHtml(t("status.extragalactic"))}</dt><dd>${mapped.total > 0 ? formatCount(mapped.extragalactic) : "—"}</dd></div>
    `;
    const representedLabel = pointLayerShown > 0 ? `${t("status.shownInline", { count: formatCount(represented) })} · ` : "";
    const mappedLabel = mapped.total > 0 ? `${t("status.mappedInline", { count: formatCount(mapped.total) })} · ` : "";
    atlasDom.catalogCount.textContent = total > ephemeris.bodies.length
      ? `${t("status.searchableInline", { count: formatCount(total) })} · ${mappedLabel}${representedLabel}${t("status.selectableInline", { count: formatInteger(ephemeris.bodies.length) })}`
      : t("status.objects", { count: formatInteger(ephemeris.bodies.length) });
  }

  updatePerfHud() {
    if (!atlasDom.perfHud) return;
    const perf = this.options.perf();
    atlasDom.perfHud.hidden = !perf.enabled;
    if (!perf.enabled) return;
    const stream = this.options.stream.stats();
    const tiles = this.options.stream.activeTiles();
    const activePoints = tiles.reduce((sum, tile) => sum + (tile.payload?.returned ?? 0), 0);
    const declaredPoints = tiles.reduce((sum, tile) => sum + (tile.payload?.declared ?? 0), 0);
    const fps = perf.frameMs > 0 ? 1000 / perf.frameMs : 0;
    const tileSource = this.options.manifest.state === "ready" ? "static" : this.options.manifest.state;
    atlasDom.perfHud.innerHTML = `
      <strong>Perf</strong><dl>
        <dt>Frame</dt><dd>${compactMs(perf.drawMs)} / ${compactNumber(fps)} fps</dd>
        <dt>WebGL</dt><dd>${compactMs(perf.webglMs)} render · ${compactMs(perf.bufferMs)} buffer</dd>
        <dt>Milky Way</dt><dd>${compactMs(perf.milkyWayMs)} overlay${perf.milkyWayMs > MILKY_WAY_DETAIL_BUDGET_MS ? " · simplified" : ""}</dd>
        <dt>Pipeline</dt><dd>${formatInteger(declaredPoints)} available · ${formatInteger(stream.requestedPointCount)} requested · ${formatInteger(activePoints)} decoded</dd>
        <dt>Visible</dt><dd>${formatInteger(perf.pointRenderer.pointsInViewport)} in viewport · ${formatInteger(perf.pointRenderer.pointsDrawn)} submitted${perf.pointRenderer.capped ? " capped" : ""}</dd>
        <dt>Pixels</dt><dd>${formatInteger(perf.pointRenderer.occupiedPixels)} occupied in ${tiles.length}/${stream.activeTileCount} active tiles</dd>
        <dt>Tiles</dt><dd>${tileSource}</dd>
        <dt>Catalog</dt><dd>${stream.loadingTileCount} loading · ${compactMs(stream.lastLoadMs)} points · ${compactMs(perf.viewportMs)} objects</dd>
        <dt>Pressure</dt><dd>${stream.queued} queued · ${stream.activeInFlight}/${stream.prefetchInFlight} active/prefetch · ${stream.abortedRequests} aborted</dd>
        <dt>Selectable</dt><dd>${formatInteger(this.options.visibleBodyCount())} visible · ${compactMs(perf.hitTestMs)} hit</dd>
        <dt>Requests</dt><dd>${stream.loadedRequests} point tiles · ${perf.viewportLoads} object loads</dd>
      </dl>
    `;
  }

  private mappedCatalogStats() {
    if (!this.options.manifest.value) return { total: 0, stars: 0, extragalactic: 0, other: 0 };
    let total = 0, stars = 0, extragalactic = 0;
    for (const layer of this.options.planner.countableLayers()) {
      const sourceTotal = Object.values(layer.source_counts).reduce((sum, count) => sum + count, 0);
      const count = sourceTotal || layer.levels[0]?.raw_point_count || layer.levels[0]?.point_count || 0;
      total += count;
      if (layer.id === "gaia_stars" || layer.types.includes("star")) stars += count;
      if (layer.types.length > 0 && layer.types.every((type) => EXTRAGALACTIC_TYPES.has(type))) extragalactic += count;
    }
    return { total, stars, extragalactic, other: Math.max(0, total - stars - extragalactic) };
  }
}

function compactMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0ms";
  return value < 10 ? `${value.toFixed(1)}ms` : `${Math.round(value)}ms`;
}

function compactNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}
