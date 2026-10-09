import { escapeHtml, formatCount } from "../atlasFormatting";
import { formatPercent } from "../format/quantity";
import { AU_PER_LIGHT_YEAR } from "../galacticModel";
import { t } from "../i18n";
import type { CatalogPointTileManifestLayer } from "./contracts";
import type { CatalogPointManifestRepository } from "../catalog/catalogPointManifest";

/** Point layers that have a plain name and a caveat text in the translation tables. */
const KNOWN_LAYERS = new Set(["gaia_stars", "desi_dr1", "quaia_g20", "deep_sky", "xray"]);

/** The plain name of a point layer. A layer with no key shows its id as words. */
export function scienceLayerName(layerId: string): string {
  return KNOWN_LAYERS.has(layerId) ? t(`scienceLayer.name.${layerId}`) : layerId.replace(/_/g, " ");
}

function scienceLayerCaveat(layerId: string): string {
  return KNOWN_LAYERS.has(layerId) ? t(`scienceLayer.caveat.${layerId}`) : t("launch.methodologyCaveat");
}

/** What the section shows now, for each target. The section changes only when this text changes. */
const shownSignatures = new WeakMap<HTMLElement, string>();

/** Returns the level of detail of a point layer that is nearest to the current view width. */
export function closestLayerLevel(layer: CatalogPointTileManifestLayer, viewWidthLy: number) {
  const targetSpan = Math.max(1, viewWidthLy * AU_PER_LIGHT_YEAR / 2);
  return [...layer.levels].sort((a, b) => Math.abs(Math.log2(a.span_au / targetSpan)) - Math.abs(Math.log2(b.span_au / targetSpan)))[0] ?? null;
}

export function formatSampleRate(value: number) {
  return formatPercent(Math.min(1, Math.max(0, value)), value < 0.01 ? 3 : 1);
}

/**
 * Shows, for each point layer, how many source objects exist and how many the map draws at this zoom level.
 * The render loop calls this for each frame. The section is built again only when the zoom level of a layer,
 * the catalog release, or the language changes.
 */
export function updateScienceLayerDisclosure(target: HTMLElement, manifest: CatalogPointManifestRepository, viewWidthLy: number) {
  const value = manifest.value;
  if (!value) return;
  const layers = value.layers.map((layer) => ({ layer, level: closestLayerLevel(layer, viewWidthLy) }));
  const signature = [value.version, t("launch.release"), ...layers.map(({ layer, level }) => `${layer.id}:${level?.span_au ?? "all"}`)].join("|");
  if (shownSignatures.get(target) === signature) return;
  shownSignatures.set(target, signature);
  const row = (label: string, text: string) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd></div>`;
  target.innerHTML = layers.map(({ layer, level }) => {
    const available = Object.values(layer.source_counts).reduce((sum, count) => sum + count, 0);
    const displayed = level?.point_count ?? available;
    const raw = level?.raw_point_count ?? displayed;
    const rate = raw > 0 ? displayed / raw : 1;
    return `<section data-science-layer="${escapeHtml(layer.id)}"><strong>${escapeHtml(scienceLayerName(layer.id))}</strong><dl>${
      row(t("launch.sourceObjects"), formatCount(available))
    }${row(t("launch.displayedAvailable"), `${formatCount(displayed)} / ${formatCount(raw)}`)
    }${row(t("launch.sampleRate"), formatSampleRate(rate))
    }${row(t("launch.release"), value.version)
    }</dl><p>${escapeHtml(scienceLayerCaveat(layer.id))}</p></section>`;
  }).join("");
}
