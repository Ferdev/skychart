import { escapeHtml as h } from "../atlasFormatting";
import type { CommunityApi } from "../community/api";
import { dateTimeText } from "../community/communityUi";
import { formatCount, formatFixed } from "../format/quantity";
import { t } from "../i18n";
import { minutesText } from "./transitFlow";

type Timing = {
  id: string;
  object_key: string;
  object_name: string;
  target_status: string;
  mid_time_utc: string;
  uncertainty_minutes: number;
  o_minus_c_minutes: number;
  frame_count: number;
  instrument: string;
  method_version: string;
  observer: { handle: string; name: string };
};
type PlanetSummary = {
  key: string;
  count: number;
  observers: number;
  mean_o_minus_c_minutes: number;
  archive_uncertainty_minutes: number;
  community_uncertainty_minutes: number;
};

/** Host systems, planets, and candidates are the only objects that can have a transit timing. */
export function canHaveTimings(key: string): boolean {
  return /^(exosys-|exoplanet-|toi-|koi-|k2-|epic-)/.test(key);
}

/** The `Transit timings` section of the object inspector. It is absent when the object has no approved timing. */
export async function mountTransitTimings(api: CommunityApi, after: Element, key: string, stale: () => boolean) {
  const data = await api.request<{ timings: Timing[]; planets: PlanetSummary[] }>(`/api/objects/${encodeURIComponent(key)}/transits`);
  if (stale() || !data.timings.length || !after.isConnected) return;
  after.parentElement?.querySelector(":scope > .transit-timings")?.remove();
  const node = document.createElement("section");
  node.className = "data-section transit-timings";
  const names = new Map(data.timings.map((timing) => [timing.object_key, timing.object_name]));
  const summary = data.planets
    .map((planet) => `<p class="community-help">${h(`${names.get(planet.key) ?? ""}: ${t("transit.timings.summary", { count: formatCount(planet.count), observers: formatCount(planet.observers), value: formatFixed(planet.mean_o_minus_c_minutes, 2), community: formatFixed(planet.community_uncertainty_minutes, 2), archive: formatFixed(planet.archive_uncertainty_minutes, 2) })}`)}</p>`)
    .join("");
  const rows = data.timings
    .slice(0, 12)
    .map((timing) => `<li><strong>${h(timing.object_name)}</strong> · ${h(dateTimeText(timing.mid_time_utc))} ± ${h(minutesText(timing.uncertainty_minutes))}<br><span class="community-muted">${h(t("transit.result.oc"))}: ${h(minutesText(timing.o_minus_c_minutes))} · ${h(timing.observer.name)} @${h(timing.observer.handle)} · ${h(timing.instrument)}</span></li>`)
    .join("");
  node.innerHTML = `<div class="section-heading"><span>${h(t("transit.timings.title"))}</span></div>${summary}<ul class="transit-timings__list">${rows}</ul><p class="community-note">${h(t("transit.timings.note"))}</p>`;
  after.after(node);
}
