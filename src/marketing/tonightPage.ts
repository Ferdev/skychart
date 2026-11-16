import { escapeHtml as h } from "../atlasFormatting";
import { t } from "../i18n";
import { readSite, writeSite, forgetSite, validSite, parseCoordinate, planRequest, targetDirection, type NightPlan, type PlannedTransit } from "../sky/nightPlannerModel";
import { renderTransitRow } from "../sky/nightPlannerPanel";
import { cameraForDirection } from "../sky/skyProjection";
import { encodeViewState } from "../viewState";
import { trackAnalytics } from "../analytics";
import { CommunityApi } from "../community/api";
import { PhotoDialogs } from "../community/photoDialogs";
import { TransitFlow } from "../transit/transitFlow";

export function tonightShare(date: string, key: string): string {
  return `/tonight?${new URLSearchParams({ date, target: key })}`;
}
export function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function mountTonight() {
  const root = document.querySelector<HTMLElement>("#tonight")!;
  const params = new URLSearchParams(location.search);
  const date = params.get("date") ?? new Date().toISOString().slice(0, 10);
  const site = readSite(localStorage);
  root.innerHTML = `<form><label>${h(t("launch.latitude"))}<input name="latitude" inputmode="decimal" required value="${site?.latitude ?? ""}"></label><label>${h(t("launch.longitude"))}<input name="longitude" inputmode="decimal" required value="${site?.longitude ?? ""}"></label><label>UTC date of mid-transit<input name="date" type="date" value="${h(validDate(date) ? date : "")}" required></label><p>Each result includes its local solar night. Events are selected by the UTC date of mid-transit.</p><button type="button" data-locate>${h(t("launch.useLocation"))}</button><button type="button" data-forget>${h(t("planner.forgetSite"))}</button><button>${h(t("planner.submit"))}</button></form><p role="status"></p><div data-results></div>`;
  const form = root.querySelector("form")!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const status = root.querySelector<HTMLElement>("[role=status]")!;
  const results = root.querySelector<HTMLElement>("[data-results]")!;
  let request: AbortController | undefined;
  let generation = 0;
  let community = false;
  const api = new CommunityApi();
  const dialogs = new PhotoDialogs(api, () => undefined);
  const record = new TransitFlow(api, after => dialogs.login(after));
  const capability = fetch("/api/community/config").then(r => r.ok ? r.json() : {}).then(async config => {
    community = (config as { enabled?: boolean }).enabled === true;
    if (community) await api.session();
  }).catch(() => undefined);
  const clear = () => { generation++; request?.abort(); results.replaceChildren(); status.textContent = ""; };
  form.addEventListener("input", clear);
  root.querySelector<HTMLButtonElement>("[data-forget]")!.onclick = () => { clear(); forgetSite(localStorage); field("latitude").value = ""; field("longitude").value = ""; };
  root.querySelector<HTMLButtonElement>("[data-locate]")!.onclick = () => {
    clear(); const ownGeneration = generation;
    if (!navigator.geolocation) { status.textContent = t("launch.observeFailed"); return; }
    navigator.geolocation.getCurrentPosition(position => {
      if (generation !== ownGeneration) return;
      field("latitude").value = String(position.coords.latitude); field("longitude").value = String(position.coords.longitude);
    }, () => { if (generation === ownGeneration) status.textContent = t("launch.observeFailed"); }, { timeout: 10000 });
  };
  form.onsubmit = async event => {
    event.preventDefault(); clear();
    const ownGeneration = generation;
    const site = { latitude: parseCoordinate(field("latitude").value), longitude: parseCoordinate(field("longitude").value) };
    const utcDate = field("date").value;
    if (!validSite(site)) { status.textContent = t("launch.invalidCoordinates"); return; }
    if (!validDate(utcDate)) { status.textContent = t("planner.invalidDate"); return; }
    writeSite(localStorage, site);
    request = new AbortController(); const signal = request.signal;
    status.textContent = t("launch.calculating");
    try {
      const events: { transit: PlannedTransit; plan: NightPlan }[] = [];
      const seen = new Set<string>();
      // A UTC day can intersect local solar nights on either side of the date line.
      for (const offset of [-1, 0, 1]) {
        const night = new Date(Date.parse(utcDate) + offset * 86400000).toISOString().slice(0, 10);
        const response = await fetch("/api/observe/plan", { method: "POST", headers: { "content-type": "application/json" }, signal,
          body: JSON.stringify(planRequest(site, night, { type: "", minAltitude: 30, maxMagnitude: 12, minSize: null, maxSize: null })) });
        if (!response.ok) throw new Error();
        const plan = await response.json() as NightPlan;
        if (generation !== ownGeneration) return;
        if (!plan.window) continue;
        for (const transit of plan.transits?.transits ?? []) {
          const id = `${transit.key}:${transit.mid_utc}`;
          if (transit.mid_utc.slice(0, 10) === utcDate && !seen.has(id)) { events.push({ transit, plan }); seen.add(id); }
        }
      }
      await capability;
      if (generation !== ownGeneration) return;
      status.textContent = events.length ? `${events.length} transits. All times are UTC.` : t("transit.none");
      results.innerHTML = `<p>${h(t("transit.help"))}</p><p>${community ? "Record transit requires sign-in. The selected event stays open through sign-in." : "Record transit is unavailable because the community service is off or cannot be reached."}</p><p>Sky uses the existing geometric view from Earth. Your site is used for the night window and altitude checks; Sky is not a local horizon chart.</p><ol>${events.map(({ transit, plan }, index) => `<li class="result" id="event-${index}"><p>Local solar night: ${h(plan.date)} · UTC mid-transit: ${h(transit.mid_utc)}</p><ul>${renderTransitRow(transit, index, plan.window!, community)}</ul><button type="button" data-sky="${index}">${h(t("planner.openTarget"))}</button><a data-share href="${h(tonightShare(utcDate, transit.key))}">Share this event (no site)</a></li>`).join("")}</ol><p>${h(t("planner.accuracy"))}</p>`;
      results.querySelectorAll<HTMLButtonElement>("[data-record]").forEach(button => button.onclick = () => {
        const { transit, plan } = events[Number(button.dataset.record)]!;
        trackAnalytics("cross_tool", { source: "tonight", tool: "record_transit" }); record.open(transit, plan.date);
      });
      results.querySelectorAll<HTMLButtonElement>("[data-sky]").forEach(button => button.onclick = () => {
        const { transit } = events[Number(button.dataset.sky)]!;
        const angles = cameraForDirection(targetDirection(transit));
        trackAnalytics("cross_tool", { source: "tonight", tool: "sky" });
        location.assign(`/?${encodeViewState({ center: { x: 0, y: 0 }, zoom: 24, time: transit.mid_utc, objectKey: transit.host_key, layers: {}, sky: { observerKey: "earth", ...angles, fovDeg: 30, constellations: true, hiddenObjectTypes: [] } })}`);
      });
      const selected = events.findIndex(event => event.transit.key === params.get("target"));
      if (params.has("target") && selected < 0) status.textContent += " The shared target has no visible event for this site on this UTC date.";
      if (selected >= 0) { const row = results.querySelector<HTMLElement>(`#event-${selected}`)!; row.tabIndex = -1; row.focus(); }
      trackAnalytics("calculation_completed", { source: "tonight", tool: "transits" });
    } catch { if (!signal.aborted && generation === ownGeneration) status.textContent = t("planner.unavailable"); }
  };
  window.addEventListener("pagehide", clear);
}
