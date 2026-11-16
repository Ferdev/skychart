import { SpacecraftLoader, spacecraftBodies, hasBodyPosition } from "../catalog/spacecraftCatalog";
import { escapeHtml as h } from "../atlasFormatting";
import { formatFixed } from "../format/quantity";
import { trackAnalytics } from "../analytics";
import { encodeViewState } from "../viewState";
import type { Body } from "../atlas/contracts";

export function spacecraftEpoch(value: string | number): string {
  return new Date(Math.floor(new Date(value).getTime() / 300000) * 300000).toISOString();
}
export function craftLink(body: Body): string {
  return `/?${encodeViewState({ center: { x: body.position.x_au, y: body.position.y_au }, zoom: 0.2, time: body.spacecraft!.position_epoch, objectKey: body.key, layers: {} })}&source=spacecraft`;
}
const value = (n: number | undefined, unit: string) => typeof n === "number" && Number.isFinite(n) ? `${formatFixed(n, 3)} ${unit}` : "Unavailable";
const stateText = { loading: "Loading", available: "Available", out_of_coverage: "Outside trajectory coverage", temporarily_unavailable: "Temporarily unavailable" };
export function mountSpacecraft() {
  const detail = document.querySelector<HTMLElement>("#craft-detail");
  const selected = detail?.dataset.key ?? "";
  const status = document.querySelector<HTMLElement>("#status")!;
  const input = document.querySelector<HTMLInputElement>("#epoch")!;
  let measured = false;
  let current = spacecraftEpoch(Date.now());
  const draw = (bodies: Body[]) => {
    const byKey = new Map(bodies.map(body => [body.key, body]));
    const complete = bodies.length > 0 && !bodies.some(body => body.spacecraft?.availability === "loading");
    status.textContent = `${current} UTC · ${complete ? "Calculation complete" : "Loading positions"}`;
    for (const row of document.querySelectorAll<HTMLTableRowElement>("tr[data-key]")) {
      const body = byKey.get(row.dataset.key!);
      const state = body?.spacecraft?.availability ?? "temporarily_unavailable";
      const valid = state === "available" && body && hasBodyPosition(body);
      row.querySelector("[data-state]")!.textContent = `${body?.spacecraft?.position_epoch ?? current} · ${stateText[state]}`;
      row.querySelector("[data-distance]")!.innerHTML = valid ? `<a data-atlas href="${h(craftLink(body))}">${h(value(body.distance_from_earth_km, "km"))}</a>` : "—";
      row.querySelector("[data-light]")!.textContent = valid ? value(body.distance_from_earth_km! / 299792.458, "seconds") : "—";
    }
    if (detail) {
      const body = byKey.get(selected);
      const state = body?.spacecraft?.availability ?? "temporarily_unavailable";
      detail.innerHTML = body && state === "available" && hasBodyPosition(body) ? `<dl>${[
        ["Loaded epoch (UTC)", body.spacecraft!.position_epoch],
        ["Earth distance", value(body.distance_from_earth_km, "km")],
        ["Sun distance", value(body.position.heliocentric_distance_km, "km")],
        ["One-way light time", value(body.distance_from_earth_km! / 299792.458, "seconds")],
        ["Sun-relative speed", value(body.spacecraft!.heliocentric_speed_km_s, "km/s")],
        ["Earth-relative speed", value(body.spacecraft!.earth_relative_speed_km_s, "km/s")],
      ].map(([label, val]) => `<dt>${h(label!)}</dt><dd>${h(val!)}</dd>`).join("")}</dl><a class="action" data-atlas href="${h(craftLink(body))}">Open ${h(body.name)} in the atlas at this epoch</a>` : `<p>${stateText[state]}. No position or speed is shown.</p>`;
    }
    if (complete && !measured) {
      measured = true;
      trackAnalytics("calculation_completed", { tool: "spacecraft", source: selected ? "detail" : "fleet", positioned: bodies.filter(b => b.spacecraft?.availability === "available" && hasBodyPosition(b)).length, gaps: bodies.filter(b => b.spacecraft?.availability !== "available" || !hasBodyPosition(b)).length });
    }
  };
  const loader = new SpacecraftLoader(draw, () => selected);
  function load() {
    measured = false;
    input.value = current.slice(0, 16);
    draw(spacecraftBodies(current));
    loader.start(current);
  }
  input.addEventListener("input", () => {
    loader.stop();
    draw(spacecraftBodies(current));
    status.textContent = "Press Load epoch to calculate this UTC time.";
  });
  document.querySelector<HTMLFormElement>("#epoch-form")!.onsubmit = event => {
    event.preventDefault();
    if (!input.value || !Number.isFinite(Date.parse(input.value + "Z"))) return;
    current = spacecraftEpoch(input.value + "Z");
    load();
  };
  document.addEventListener("click", event => {
    if ((event.target as Element).closest("[data-atlas]")) trackAnalytics("cross_tool", { source: "spacecraft", tool: "atlas" });
  });
  window.addEventListener("pagehide", () => loader.stop());
  load();
}
