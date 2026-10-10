import { escapeHtml } from "../atlasFormatting";
import type { Body } from "../atlas/contracts";
import { formatDateTime, formatFixed } from "../format/quantity";
import { t } from "../i18n";

type ObservationResponse = {
  altitude_deg: number;
  azimuth_deg: number;
  rise_utc: string | null;
  transit_utc: string | null;
  set_utc: string | null;
  summary: string;
  accuracy_note: string;
};

/** Catalog groups that the observation service has. For other objects the inspector shows no Observe view. */
const OBSERVABLE_GROUPS = new Set([
  "core", "mars_moons", "jupiter_major_moons", "saturn_major_moons",
  "bright_stars", "nearby_exoplanet_systems", "exoplanet_systems", "messier_deep_sky",
]);

/** True when the observation service can calculate where this object is in the sky of a place on Earth. */
export function canObserveFromEarth(body: Body): boolean {
  if (body.spacecraft || body.key === "earth") return false;
  return OBSERVABLE_GROUPS.has(body.catalog_group ?? body.catalog?.catalog_group ?? "");
}

/** Renders the Observe view of the inspector for one object. */
export function renderObservePanel(body: Body) {
  return `
    <section class="observe-panel" data-observe-key="${escapeHtml(body.key)}">
      <div class="section-heading"><span>${escapeHtml(t("launch.skyTonight"))}</span></div>
      <p>${escapeHtml(t("launch.observeHelp"))}</p>
      <div class="observe-fields">
        <label class="observe-field"><span>${escapeHtml(t("launch.latitude"))}</span><input id="observe-lat" class="observe-input" inputmode="decimal" autocomplete="off" placeholder="40.4"></label>
        <label class="observe-field"><span>${escapeHtml(t("launch.longitude"))}</span><input id="observe-lon" class="observe-input" inputmode="decimal" autocomplete="off" placeholder="-3.7"></label>
      </div>
      <div class="observe-actions">
        <button type="button" class="primary-action" data-observe-location="manual">${escapeHtml(t("launch.calculate"))}</button>
        <button type="button" class="secondary-action" data-observe-location="browser">${escapeHtml(t("launch.useLocation"))}</button>
      </div>
      <p id="observe-status" class="observe-status" role="status"></p>
      <p id="observe-error" class="observe-error" role="alert" hidden></p>
      <div id="observe-result" class="observe-result" hidden></div>
    </section>
  `;
}

/** Reads the observer position from the panel or the browser and shows the result of the observation service. */
export async function requestObservation(root: HTMLElement, useBrowser: boolean) {
  const panel = root.querySelector<HTMLElement>("[data-observe-key]");
  const status = panel?.querySelector<HTMLElement>("#observe-status");
  const errorBox = panel?.querySelector<HTMLElement>("#observe-error");
  const result = panel?.querySelector<HTMLElement>("#observe-result");
  if (!panel || !status || !errorBox || !result) return;
  errorBox.hidden = true;
  errorBox.textContent = "";
  status.textContent = useBrowser ? t("launch.requestingLocation") : t("launch.calculating");
  try {
    const latitudeInput = panel.querySelector<HTMLInputElement>("#observe-lat");
    const longitudeInput = panel.querySelector<HTMLInputElement>("#observe-lon");
    let latitude = parseCoordinate(latitudeInput?.value);
    let longitude = parseCoordinate(longitudeInput?.value);
    if (useBrowser) {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10_000, maximumAge: 300_000 }));
      latitude = position.coords.latitude;
      longitude = position.coords.longitude;
      if (latitudeInput) latitudeInput.value = latitude.toFixed(3);
      if (longitudeInput) longitudeInput.value = longitude.toFixed(3);
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error(t("launch.invalidCoordinates"));
    }
    const query = new URLSearchParams({ key: panel.dataset.observeKey ?? "", lat: String(latitude), lon: String(longitude) });
    const response = await fetch(`/api/observe?${query}`);
    if (!response.ok) throw new Error(t("launch.observeUnavailable"));
    const payload = await response.json() as ObservationResponse;
    status.textContent = "";
    result.innerHTML = renderObservation(payload);
    result.hidden = false;
  } catch (error) {
    status.textContent = "";
    result.hidden = true;
    errorBox.textContent = error instanceof GeolocationPositionError
      ? t("launch.observeFailed")
      : error instanceof Error && error.message ? error.message : t("launch.observeFailed");
    errorBox.hidden = false;
  }
}

/** A decimal number with a point or a comma. An empty field is not a number. */
function parseCoordinate(value: string | undefined): number {
  const text = (value ?? "").trim().replace(",", ".");
  return text === "" ? Number.NaN : Number(text);
}

function renderObservation(payload: ObservationResponse) {
  const degrees = (value: number) => t("value.degrees", { value: formatFixed(value, 1) });
  const timeRow = (label: string, timestamp: string | null) => {
    const local = timestamp ? formatDateTime(timestamp, { hour: "2-digit", minute: "2-digit", weekday: "short" }) : t("observe.notInNext24Hours");
    const utc = timestamp ? formatDateTime(timestamp, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : "";
    return `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(local)}</td><td>${escapeHtml(utc)}</td></tr>`;
  };
  return `
    <dl class="observe-now">
      <div><dt>${escapeHtml(t("observe.altitudeNow"))}</dt><dd>${escapeHtml(degrees(payload.altitude_deg))}</dd></div>
      <div><dt>${escapeHtml(t("observe.azimuthNow"))}</dt><dd>${escapeHtml(degrees(payload.azimuth_deg))}</dd></div>
    </dl>
    <table class="observe-table">
      <thead><tr><th scope="col">${escapeHtml(t("observe.event"))}</th><th scope="col">${escapeHtml(t("observe.localTime"))}</th><th scope="col">UTC</th></tr></thead>
      <tbody>
        ${timeRow(t("observe.rise"), payload.rise_utc)}
        ${timeRow(t("observe.transit"), payload.transit_utc)}
        ${timeRow(t("observe.set"), payload.set_utc)}
      </tbody>
    </table>
    <p class="observe-note">${escapeHtml(payload.accuracy_note)}</p>
  `;
}
