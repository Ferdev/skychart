import { escapeHtml as h } from "../atlasFormatting";
import { emptyState, openDialog, segmented, type DialogView } from "../community/communityUi";
import { objectTypeLabel } from "../format/objectTypeLabel";
import { formatCount, formatDateTime, formatDuration, formatFixed, formatPercent } from "../format/quantity";
import { t } from "../i18n";
import {
  barSegments,
  defaultNight,
  forgetSite,
  parseCoordinate,
  planRequest,
  readSite,
  validSite,
  writeSite,
  type NightPlan,
  type PlannedTransit,
  type PlannerFilters,
  type PlannerSite,
  type PlanTarget,
  type PlanWindow,
} from "./nightPlannerModel";

const TYPES = ["galaxy", "nebula", "star_cluster"] as const;
const clock = (value: string) => formatDateTime(value, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const span = (window: PlanWindow) => t("planner.span", { start: clock(window.start_utc), end: clock(window.end_utc) });
const degrees = (value: number) => t("value.degrees", { value: formatFixed(value, 1) });

/** An empty field gives no filter. */
function optionalNumber(value: string): number | null {
  const number = parseCoordinate(value);
  return Number.isFinite(number) ? number : null;
}

/** The panel of tonight's planner: the site and the night, the filters, and the ranked targets. */
export class NightPlannerPanel {
  private view: DialogView | null = null;
  private results: HTMLElement | null = null;
  private request: AbortController | null = null;
  private plan: NightPlan | null = null;
  private date = defaultNight(new Date());
  private filters: PlannerFilters = { type: "", minAltitude: 30, maxMagnitude: 12, minSize: null, maxSize: null };

  private list: "targets" | "transits" = "targets";

  constructor(private readonly options: {
    openTarget: (target: PlanTarget) => Promise<void>;
    /** Absent when the community is off: the list of transits stays, with no action. */
    recordTransit?: () => ((transit: PlannedTransit, night: string) => void) | null;
  }) {
    window.addEventListener("cosmic-atlas:locale-change", () => {
      if (this.view?.dialog.isConnected) this.paint();
    });
  }

  open() {
    if (this.view?.dialog.isConnected) return;
    this.view = openDialog(t("planner.title"), { variant: "planner", eyebrow: t("planner.eyebrow") });
    this.view.dialog.addEventListener("close", () => {
      this.request?.abort();
      this.view = null;
      this.results = null;
    });
    this.paint();
  }

  private paint() {
    const view = this.view!;
    const site = readSite(localStorage);
    view.dialog.setAttribute("aria-label", t("planner.title"));
    view.header.querySelector("h2")!.textContent = t("planner.title");
    view.header.querySelector(".eyebrow")!.textContent = t("planner.eyebrow");
    view.body.innerHTML = `<form class="planner-form" novalidate>
      <fieldset class="planner-form__group"><legend>${h(t("planner.site"))}</legend>
        <label>${h(t("launch.latitude"))}<input name="latitude" inputmode="decimal" autocomplete="off" required value="${site ? site.latitude : ""}"></label>
        <label>${h(t("launch.longitude"))}<input name="longitude" inputmode="decimal" autocomplete="off" required value="${site ? site.longitude : ""}"></label>
        <label>${h(t("planner.night"))}<input name="date" type="date" required value="${h(this.date)}"></label>
        <div class="planner-form__actions"><button type="button" class="secondary-action" data-locate>${h(t("launch.useLocation"))}</button><button type="button" class="text-action" data-forget${site ? "" : " hidden"}>${h(t("planner.forgetSite"))}</button></div>
        <p class="community-help">${h(t("planner.privacy"))}</p>
      </fieldset>
      <fieldset class="planner-form__group"><legend>${h(t("planner.filters"))}</legend>
        <label>${h(t("planner.type"))}<select name="type"><option value="">${h(t("planner.allTypes"))}</option>${TYPES.map((type) => `<option value="${type}"${this.filters.type === type ? " selected" : ""}>${h(objectTypeLabel(type, "many"))}</option>`).join("")}</select></label>
        <label>${h(t("planner.minAltitude"))}<input name="minAltitude" type="number" min="0" max="85" step="1" value="${this.filters.minAltitude}"></label>
        <label>${h(t("planner.maxMagnitude"))}<input name="maxMagnitude" inputmode="decimal" autocomplete="off" value="${this.filters.maxMagnitude ?? ""}"></label>
        <label>${h(t("planner.minSize"))}<input name="minSize" inputmode="decimal" autocomplete="off" value="${this.filters.minSize ?? ""}"></label>
        <label>${h(t("planner.maxSize"))}<input name="maxSize" inputmode="decimal" autocomplete="off" value="${this.filters.maxSize ?? ""}"></label>
      </fieldset>
      <div class="planner-form__actions"><button type="submit" class="primary-action">${h(t("planner.submit"))}</button></div>
    </form><div class="planner-results"></div>`;
    this.results = view.body.querySelector<HTMLElement>(".planner-results");
    const form = view.body.querySelector<HTMLFormElement>("form")!;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit(form);
    });
    const forget = form.querySelector<HTMLButtonElement>("[data-forget]")!;
    forget.onclick = () => {
      forgetSite(localStorage);
      (form.elements.namedItem("latitude") as HTMLInputElement).value = "";
      (form.elements.namedItem("longitude") as HTMLInputElement).value = "";
      forget.hidden = true;
    };
    form.querySelector<HTMLButtonElement>("[data-locate]")!.onclick = () => this.locate(form);
    this.paintResults();
  }

  private locate(form: HTMLFormElement) {
    const message = this.view!.message;
    message.textContent = t("launch.requestingLocation");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        (form.elements.namedItem("latitude") as HTMLInputElement).value = String(Number(position.coords.latitude.toPrecision(7)));
        (form.elements.namedItem("longitude") as HTMLInputElement).value = String(Number(position.coords.longitude.toPrecision(7)));
        message.textContent = "";
      },
      () => (message.textContent = t("launch.observeFailed")),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  private async submit(form: HTMLFormElement) {
    const message = this.view!.message;
    const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    const site: PlannerSite = { latitude: parseCoordinate(field("latitude")), longitude: parseCoordinate(field("longitude")) };
    if (!validSite(site)) {
      message.textContent = t("launch.invalidCoordinates");
      return;
    }
    this.date = field("date");
    if (!this.date) {
      message.textContent = t("planner.invalidDate");
      return;
    }
    this.filters = {
      type: field("type"),
      minAltitude: Math.min(85, Math.max(0, optionalNumber(field("minAltitude")) ?? 30)),
      maxMagnitude: optionalNumber(field("maxMagnitude")),
      minSize: optionalNumber(field("minSize")),
      maxSize: optionalNumber(field("maxSize")),
    };
    writeSite(localStorage, site);
    form.querySelector<HTMLButtonElement>("[data-forget]")!.hidden = false;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    message.textContent = t("launch.calculating");
    try {
      const response = await fetch("/api/observe/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(planRequest(site, this.date, this.filters)),
        signal: request.signal,
      });
      if (!response.ok) throw new Error();
      this.plan = await response.json() as NightPlan;
      message.textContent = "";
      this.paintResults();
    } catch {
      if (!request.signal.aborted) message.textContent = t("planner.unavailable");
    }
  }

  private paintResults() {
    const root = this.results;
    const plan = this.plan;
    if (!root) return;
    if (!plan) {
      root.innerHTML = emptyState(t("planner.prompt"));
      return;
    }
    if (!plan.window) {
      root.innerHTML = emptyState(t("planner.noNight"));
      return;
    }
    const night = plan.window;
    const moon = plan.moon;
    const transits = plan.transits?.transits ?? [];
    const lists = segmented(t("transit.sections"), "list", [
      { value: "targets", label: t("transit.tab.targets"), count: plan.total },
      { value: "transits", label: t("transit.tab.transits"), count: plan.transits?.total ?? 0 },
    ], this.list);
    const targets = plan.targets.length
      ? `<p class="community-help">${h(t("planner.count", { shown: formatCount(plan.targets.length), total: formatCount(plan.total), altitude: formatFixed(plan.min_altitude_deg, 0) }))}</p><ol class="planner-list">${plan.targets.map((target, index) => this.row(target, index, night)).join("")}</ol>`
      : emptyState(t("planner.noTargets"));
    const transitList = `<p class="community-help">${h(t("transit.help"))}</p>${transits.length
      ? `<ol class="planner-list">${transits.map((transit, index) => this.transitRow(transit, index, night)).join("")}</ol>`
      : emptyState(t("transit.none"))}`;
    root.innerHTML = `<p class="planner-summary">${h(t("planner.window", { kind: t(`planner.darkness.${plan.darkness}`), span: span(night) }))}${moon ? ` ${h(t("planner.moon", { percent: formatPercent(moon.illuminated_fraction, 0) }))}` : ""}</p>
      ${plan.darkness === "astronomical" ? "" : `<p class="planner-note" role="note">${h(t("planner.noAstronomicalDarkness"))}</p>`}
      ${lists}${this.list === "targets" ? targets : transitList}
      <p class="community-help">${h(t("planner.accuracy"))}</p>`;
    root.querySelectorAll<HTMLButtonElement>("[data-list]").forEach((button) => {
      button.onclick = () => {
        this.list = button.dataset.list as "targets" | "transits";
        this.paintResults();
      };
    });
    root.querySelectorAll<HTMLButtonElement>("[data-record]").forEach((button) => {
      button.onclick = () => {
        const transit = transits[Number(button.dataset.record)]!;
        this.view?.dialog.close();
        this.options.recordTransit?.()?.(transit, plan.date);
      };
    });
    root.querySelectorAll<HTMLButtonElement>("[data-target]").forEach((button) => {
      button.onclick = () => {
        const target = plan.targets[Number(button.dataset.target)]!;
        this.view?.dialog.close();
        void this.options.openTarget(target);
      };
    });
  }

  private transitRow(transit: PlannedTransit, index: number, night: PlanWindow) {
    const window = { start_utc: transit.ingress_utc, end_utc: transit.egress_utc };
    const bar = barSegments(night, [window]).map((part) => `<span style="left:${Math.max(0, part.left).toFixed(2)}%;width:${Math.min(100 - Math.max(0, part.left), part.width).toFixed(2)}%"></span>`).join("");
    const facts = [
      t(`transit.status.${transit.status}`),
      t(`transit.coverage.${transit.coverage}`),
      t("transit.depth", { value: t("transit.ppt", { value: formatFixed(transit.depth_ppt, 1) }), hours: formatDuration(transit.duration_hours * 3600), band: transit.magnitude_band, magnitude: formatFixed(transit.magnitude, 1) }),
    ].join(" · ");
    const canRecord = this.options.recordTransit?.();
    return `<li class="planner-row">
      <div class="planner-row__head"><span class="planner-row__rank">${formatCount(index + 1)}</span><strong>${h(transit.name)}</strong>${canRecord ? `<button type="button" class="secondary-action" data-record="${index}" aria-label="${h(`${t("transit.record")} · ${transit.name}`)}">${h(t("transit.record"))}</button>` : ""}</div>
      <p class="planner-row__facts">${h(facts)}</p>
      <div class="planner-bar" aria-hidden="true">${bar}</div>
      <dl class="planner-row__data">
        <div><dt>${h(t("transit.tab.transits"))}</dt><dd>${h(t("transit.times", { ingress: clock(transit.ingress_utc), middle: clock(transit.mid_utc), egress: clock(transit.egress_utc) }))}</dd></div>
        <div><dt>${h(t("transit.altitudes"))}</dt><dd>${h([transit.altitude_ingress_deg, transit.altitude_mid_deg, transit.altitude_egress_deg].map(degrees).join(" → "))}</dd></div>
        <div><dt>${h(t("transit.prediction"))}</dt><dd>± ${h(t("transit.minutes", { value: formatFixed(transit.uncertainty_minutes, 1) }))}</dd></div>
        <div><dt>${h(t("planner.moonDistance"))}</dt><dd>${h(degrees(transit.moon_separation_deg))}</dd></div>
      </dl></li>`;
  }

  private row(target: PlanTarget, index: number, night: PlanWindow) {
    const facts = [
      objectTypeLabel(target.object_type, "one"),
      target.constellation,
      target.magnitude === null ? null : t("planner.magnitude", { value: formatFixed(target.magnitude, 1) }),
      target.size_arcmin === null ? null : t("planner.size", { value: formatFixed(target.size_arcmin, 1) }),
    ].filter(Boolean).join(" · ");
    const bar = barSegments(night, target.windows).map((part) => `<span style="left:${part.left.toFixed(2)}%;width:${part.width.toFixed(2)}%"></span>`).join("");
    return `<li class="planner-row">
      <div class="planner-row__head"><span class="planner-row__rank">${formatCount(index + 1)}</span><strong>${h(target.name)}</strong><button type="button" class="secondary-action" data-target="${index}" aria-label="${h(t("planner.openTargetLabel", { name: target.name }))}">${h(t("planner.openTarget"))}</button></div>
      <p class="planner-row__facts">${h(facts)}</p>
      <div class="planner-bar" aria-hidden="true">${bar}</div>
      <dl class="planner-row__data">
        <div><dt>${h(t("planner.above"))}</dt><dd>${h(formatDuration(target.minutes_above * 60))} · ${h(target.windows.map(span).join(", "))}</dd></div>
        <div><dt>${h(t("planner.best"))}</dt><dd>${h(degrees(target.best_altitude_deg))} · ${h(clock(target.best_utc))} UTC</dd></div>
        <div><dt>${h(t("planner.moonDistance"))}</dt><dd>${h(degrees(target.moon_separation_deg))}</dd></div>
      </dl></li>`;
  }
}
