import { classifyBody } from "../destinationPicker";
import { pointInRect, isPresent, type Rect, type ScreenPoint } from "../geometry";
import { t } from "../i18n";
import { objectMediaFor, objectMediaStatusFor } from "../objectMedia";
import { measuredRedshift, scienceSemanticsFor, uncertaintySummary } from "../scienceSemantics";
import { trackEvent } from "../analytics";
import {
  escapeHtml,
  formatCount,
  formatNumber,
  identifierLabel,
  identifierValue,
  shortBodyName,
  uniquePairs,
  uniqueTextValues,
} from "../atlasFormatting";
import { AU_PER_LIGHT_YEAR } from "../galacticModel";
import type {
  Body,
  BodyExoplanet,
  Ephemeris,
  ExternalLink,
  ObjectDetailHydrationState,
  CatalogPointTileManifestLayer,
  UniverseShell,
} from "../atlas/contracts";
import type { CatalogPointManifestRepository } from "../catalog/catalogPointManifest";

export type ObjectInspectionContext = {
  bodyInfo: HTMLElement;
  nowStatus: HTMLElement;
  nowEvents: HTMLElement;
  scienceLayerDisclosure: HTMLElement;
  hydrationStates: Map<string, ObjectDetailHydrationState>;
  manifest: CatalogPointManifestRepository;
  curatedSummaries: Record<string, string>;
  selectedBody: () => Body | null;
  bodyByKey: () => Map<string, Body>;
  ephemeris: () => Ephemeris | null;
  currentViewWidthLy: () => number;
  universeShellForRadius: (radiusLy: number) => UniverseShell;
  formatLightYears: (lightYears: number) => string;
  formatRightAscensionForBody: (body: Body) => string | null;
  formatDeclinationForBody: (body: Body) => string | null;
  formatRaDecDecimal: (body: Body) => string | null;
  formatGalacticLongitude: (body: Body) => string | null;
  formatGalacticLatitude: (body: Body) => string | null;
  formatEclipticLongitude: (body: Body) => string | null;
  formatEclipticLatitude: (body: Body) => string | null;
  formatEclipticRadius: (body: Body) => string | null;
  formatAuCoordinate: (value: number) => string;
  formatDistance: (km: number) => string;
  nullableDistance: (km: number | null | undefined) => string;
  nullableNumber: (value: number | null | undefined, digits: number) => string;
  nullableDegrees: (value: number | null | undefined) => string;
  nullableDays: (value: number | null | undefined) => string;
  nullableLightYears: (value: number | null | undefined) => string;
  readablePositionModel: (value: string) => string;
  readableOptionalModel: (value: string | null | undefined) => string | null;
  readableCatalogGroup: (value: string | null | undefined) => string | null;
  formatFullDate: (value: string) => string;
  bodyDistanceKm: (left: Body, right: Body) => number;
  usableViewportRect: () => Rect;
  worldToScreen: (xAu: number, yAu: number) => ScreenPoint;
};

/** Renders the complete scientific meaning of one selected object. */
export class ObjectInspectionView {
  constructor(private readonly context: ObjectInspectionContext) {}

update() {
  const body = this.context.selectedBody();
  if (!body) {
    this.context.bodyInfo.innerHTML = this.renderObjectEmptyState();
    return;
  }

  const classification = classifyBody(body);
  const positionModel = this.context.readablePositionModel(body.catalog?.position_model ?? body.catalog?.source_type ?? "");
  const parentBody = body.parent_key ? this.context.bodyByKey().get(body.parent_key) ?? null : null;
  const overviewRows = [
    [t("field.type"), classification.label],
    [t("field.radius"), body.radius_km > 0 ? this.context.formatDistance(body.radius_km) : t("value.unknown")],
    [t("field.parent"), parentBody?.name ?? body.parent_key ?? null],
    [t("field.catalogGroup"), this.context.readableCatalogGroup(body.catalog_group ?? body.catalog?.catalog_group)]
  ];
  const primaryStats = [
    [t("field.earthDistance"), this.context.formatDistance(body.distance_from_earth_km)],
    [t("field.diameter"), body.radius_km > 0 ? this.context.formatDistance(body.radius_km * 2) : t("value.unknown")],
    [t("field.heliocentric"), this.context.formatDistance(body.position.heliocentric_distance_km)]
  ];

  const positionRows = [
    [t("field.coordinateFrame"), this.context.ephemeris()?.coordinate_frame ?? null],
    [t("field.positionModel"), positionModel],
    [t("field.rightAscension"), this.context.formatRightAscensionForBody(body)],
    [t("field.declination"), this.context.formatDeclinationForBody(body)],
    [t("field.raDecDecimal"), this.context.formatRaDecDecimal(body)],
    [t("field.galacticLongitude"), this.context.formatGalacticLongitude(body)],
    [t("field.galacticLatitude"), this.context.formatGalacticLatitude(body)],
    [t("field.eclipticLongitude"), this.context.formatEclipticLongitude(body)],
    [t("field.eclipticLatitude"), this.context.formatEclipticLatitude(body)],
    [t("field.eclipticRadius"), this.context.formatEclipticRadius(body)],
    [t("field.eclipticX"), this.context.formatAuCoordinate(body.position.x_au)],
    [t("field.eclipticY"), this.context.formatAuCoordinate(body.position.y_au)],
    [t("field.eclipticZ"), this.context.formatAuCoordinate(body.position.z_au)]
  ];

  const stateRows = body.state_vector
    ? [
        [t("field.parentRelativeSpeed"), `${formatNumber(body.state_vector.speed_km_s)} km/s`],
        [t("field.heliocentricSpeed"), `${formatNumber(body.state_vector.heliocentric_speed_km_s)} km/s`],
        [t("field.parentRelativeDistance"), this.context.formatDistance(body.state_vector.distance_km)]
      ]
    : [];

  const orbitRows = body.orbit
    ? [
        [t("field.orbitClass"), body.orbit.orbit_class],
        [t("field.semiMajorAxis"), this.context.nullableDistance(body.orbit.semi_major_axis_km)],
        [t("field.eccentricity"), this.context.nullableNumber(body.orbit.eccentricity, 4)],
        [t("field.inclination"), this.context.nullableDegrees(body.orbit.inclination_deg)],
        [t("field.periapsis"), this.context.nullableDistance(body.orbit.periapsis_km)],
        [t("field.apoapsis"), this.context.nullableDistance(body.orbit.apoapsis_km)],
        [t("field.ascendingNode"), this.context.nullableDegrees(body.orbit.longitude_of_ascending_node_deg)],
        [t("field.argumentOfPeriapsis"), this.context.nullableDegrees(body.orbit.argument_of_periapsis_deg)],
        [t("field.trueAnomaly"), this.context.nullableDegrees(body.orbit.true_anomaly_deg)],
        [t("field.period"), this.context.nullableDays(body.orbit.orbital_period_days)]
      ]
    : [];

  const stellarRows = body.stellar
    ? [
        ["HIP", body.stellar.hip ? `HIP ${body.stellar.hip}` : null],
        ["HD", body.stellar.hd ? `HD ${body.stellar.hd}` : null],
        [t("field.catalogDistance"), this.context.nullableLightYears(body.stellar.distance_ly)],
        [t("field.parallax"), body.stellar.parallax_mas ? `${formatNumber(body.stellar.parallax_mas)} mas` : null],
        [t("field.apparentMagnitude"), this.context.nullableNumber(body.stellar.apparent_magnitude, 2)],
        [t("field.absoluteMagnitude"), this.context.nullableNumber(body.stellar.absolute_magnitude, 2)],
        [t("field.bvColorIndex"), this.context.nullableNumber(body.stellar.bv_color_index, 3)],
        ...(body.stellar.exoplanet_count != null ? [[t("field.knownPlanets"), this.context.nullableNumber(body.stellar.exoplanet_count, 0)]] : []),
        ...(body.stellar.stellar_teff_k ? [[t("field.temperature"), `${formatNumber(body.stellar.stellar_teff_k)} K`]] : []),
        ...(body.stellar.stellar_mass_solar ? [[t("field.mass"), `${formatNumber(body.stellar.stellar_mass_solar)} ${t("value.solarMasses")}`]] : []),
        ...(body.stellar.stellar_radius_solar ? [[t("field.radius"), `${formatNumber(body.stellar.stellar_radius_solar)} ${t("value.solarRadii")}`]] : []),
        ...(body.stellar.spectral_type ? [[t("field.spectralType"), body.stellar.spectral_type]] : []),
        [t("field.radiusSource"), body.stellar.stellar_radius_source ?? null]
      ]
    : [];

  const exoplanetRows = body.exoplanet_system
    ? [
        [t("field.confirmedPlanets"), this.context.nullableNumber(body.exoplanet_system.confirmed_planet_count ?? body.exoplanet_system.planets?.length, 0)],
        [t("field.starsInSystem"), this.context.nullableNumber(body.exoplanet_system.system_star_count, 0)],
        [t("field.moonsInArchive"), this.context.nullableNumber(body.exoplanet_system.system_moon_count, 0)]
      ]
    : [];

  const deepSkyRows = body.deep_sky
    ? [
        [t("field.commonName"), body.deep_sky.common_name ?? null],
        [t("field.deepSkyType"), body.deep_sky.deep_sky_type_label ?? t("value.unknown")],
        [t("field.magnitude"), this.context.nullableNumber(body.deep_sky.apparent_magnitude, 1)],
        [t("field.constellation"), body.deep_sky.constellation ?? t("value.unknown")],
        [t("field.viewingSeason"), body.deep_sky.viewing_season ?? t("value.unknown")],
        [t("field.angularSize"), body.deep_sky.angular_size_arcmin ?? t("value.unknown")],
        [t("field.physicalDiameter"), body.deep_sky.physical_diameter_ly ? `${formatNumber(body.deep_sky.physical_diameter_ly)} ly` : t("value.unknown")],
        [t("field.minorDiameter"), body.deep_sky.physical_minor_diameter_ly ? `${formatNumber(body.deep_sky.physical_minor_diameter_ly)} ly` : null],
        [t("field.sizeNote"), body.deep_sky.physical_size_note ?? null],
        [t("field.equipment"), body.deep_sky.observing_equipment ?? null]
      ]
    : [];

  const smallBodyRows = body.small_body
    ? [
        [t("field.orbitClass"), body.small_body.orbit_class ?? t("value.unknown")],
        [t("field.nearEarthObject"), body.small_body.neo == null ? null : body.small_body.neo ? t("value.yes") : t("value.no")],
        [t("field.potentiallyHazardous"), body.small_body.pha == null ? null : body.small_body.pha ? t("value.yes") : t("value.no")],
        [t("field.diameter"), body.small_body.diameter_km ? this.context.formatDistance(body.small_body.diameter_km) : body.small_body.estimated_diameter_km ? `${this.context.formatDistance(body.small_body.estimated_diameter_km)} ${t("value.estimated")}` : null],
        [t("field.absoluteMagnitudeH"), this.context.nullableNumber(body.small_body.h_absolute_magnitude, 2)],
        [t("field.semiMajorAxis"), body.small_body.semi_major_axis_au ? `${formatNumber(body.small_body.semi_major_axis_au)} AU` : null],
        [t("field.perihelion"), body.small_body.perihelion_au ? `${formatNumber(body.small_body.perihelion_au)} AU` : null],
        [t("field.aphelion"), body.small_body.aphelion_au ? `${formatNumber(body.small_body.aphelion_au)} AU` : null],
        [t("field.eccentricity"), this.context.nullableNumber(body.small_body.eccentricity, 4)],
        [t("field.inclination"), this.context.nullableDegrees(body.small_body.inclination_deg)],
        [t("field.period"), this.context.nullableDays(body.small_body.orbital_period_days)],
        [t("field.earthMoid"), body.small_body.earth_moid_au ? `${formatNumber(body.small_body.earth_moid_au)} AU` : null]
      ]
    : [];

  this.context.bodyInfo.innerHTML = `
    <article class="selected-object selected-object--context" style="--body-color: ${escapeHtml(body.color)}">
      <section class="object-data-pane">
        ${this.renderObjectDetailState(body)}
        ${this.renderObjectSummaryCard(body, classification.label)}
        ${this.renderFactTiles(primaryStats)}
        ${this.renderUniverseSciencePanel(body)}
        ${this.renderObservePanel(body)}
        ${this.renderIdentifierSection(body)}
        ${this.renderMediaSection(body)}
        ${this.renderDataSection(t("section.overview"), overviewRows)}
        ${this.renderDataSection(t("section.position"), positionRows)}
        ${this.renderDataSection(t("section.motion"), stateRows)}
        ${this.renderDataSection(t("section.orbit"), orbitRows)}
        ${this.renderDataSection(t("section.stellarFacts"), stellarRows)}
        ${this.renderDataSection(t("section.confirmedExoplanets"), exoplanetRows, this.renderExoplanetList(body.exoplanet_system?.planets ?? []))}
        ${this.renderDataSection(t("section.deepSkyFacts"), deepSkyRows)}
        ${this.renderDataSection(t("section.smallBodyFacts"), smallBodyRows)}
        ${this.renderObjectNotes(body)}
        ${this.renderSourceSection(body)}
        ${this.renderRelatedObjects(body)}
      </section>
    </article>
  `;
}

private renderObservePanel(body: Body) {
  return `<section class="observe-panel" data-observe-key="${escapeHtml(body.key)}"><div class="section-heading"><span>${escapeHtml(t("launch.skyTonight"))}</span></div><p>${escapeHtml(t("launch.observeHelp"))}</p><div class="observe-fields"><label>${escapeHtml(t("launch.latitude"))} <input id="observe-lat" inputmode="decimal"></label><label>${escapeHtml(t("launch.longitude"))} <input id="observe-lon" inputmode="decimal"></label></div><button type="button" data-observe-location="manual">${escapeHtml(t("launch.calculate"))}</button> <button type="button" data-observe-location="browser">${escapeHtml(t("launch.useLocation"))}</button><p id="observe-result" role="status"></p></section>`;
}

async requestObservation(useBrowser: boolean) {
  const panel=this.context.bodyInfo.querySelector<HTMLElement>("[data-observe-key]"); const result=panel?.querySelector<HTMLElement>("#observe-result"); if(!panel||!result)return; result.textContent=useBrowser?t("launch.requestingLocation"):t("launch.calculating");
  try {
    const latValue=panel.querySelector<HTMLInputElement>("#observe-lat")?.value.trim()??""; const lonValue=panel.querySelector<HTMLInputElement>("#observe-lon")?.value.trim()??""; let lat=latValue===""?Number.NaN:Number(latValue); let lon=lonValue===""?Number.NaN:Number(lonValue);
    if(useBrowser){const pos=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{timeout:10_000,maximumAge:300_000}));lat=pos.coords.latitude;lon=pos.coords.longitude;}
    if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lon)||lon < -180||lon > 180)throw new Error(t("launch.invalidCoordinates"));
    const response=await fetch(`/api/observe?${new URLSearchParams({key:panel.dataset.observeKey??"",lat:String(lat),lon:String(lon)})}`);if(!response.ok)throw new Error(t("launch.observeUnavailable"));
    const p=await response.json() as {altitude_deg:number;azimuth_deg:number;summary:string;accuracy_note:string};result.textContent=t("launch.altAz",{summary:p.summary,altitude:p.altitude_deg.toFixed(1),azimuth:p.azimuth_deg.toFixed(1),note:p.accuracy_note});
  }catch(error){result.textContent=error instanceof Error?error.message:t("launch.observeFailed");}
}

async loadNowEvents() {
  try {const response=await fetch("/api/now");if(!response.ok)throw new Error();const p=await response.json() as {stale:boolean;refreshed_at:string|null;events:{title:string;summary:string;starts_at:string;url:string;catalog_key:string|null}[]};this.context.nowStatus.textContent=p.stale?t("launch.eventsCached",{date:p.refreshed_at?new Date(p.refreshed_at).toLocaleString():t("launch.unknown")}):t("launch.eventsUpdated",{date:new Date(p.refreshed_at??Date.now()).toLocaleString()});this.context.nowEvents.innerHTML=p.events.slice(0,6).map(item=>`<li><a href="${escapeHtml(item.url)}" ${item.catalog_key?"":`target="_blank" rel="noopener noreferrer"`}>${escapeHtml(item.title)}</a><time datetime="${escapeHtml(item.starts_at)}">${escapeHtml(new Date(item.starts_at).toLocaleDateString())}</time><p>${escapeHtml(item.summary)}</p></li>`).join("");}catch{this.context.nowStatus.textContent=t("launch.eventsUnavailable");}
}

private renderObjectEmptyState() {
  return `
    <section class="object-empty-state">
      <h2>${escapeHtml(t("object.noSelectionTitle"))}</h2>
      <p>${escapeHtml(t("object.noSelectionBody"))}</p>
    </section>
  `;
}

private renderObjectDetailState(body: Body) {
  const hydrationState = this.context.hydrationStates.get(body.key);
  if (hydrationState?.status === "loading") {
    return `
      <section class="object-detail-state object-detail-state--loading" aria-label="${escapeHtml(t("object.detailLoading"))}" role="status">
        <strong>${escapeHtml(t("object.detailLoading"))}</strong>
        <span>${escapeHtml(t("object.detailLoadingBody"))}</span>
      </section>
    `;
  }
  if (hydrationState?.status === "error") {
    return `
      <section class="object-detail-state object-detail-state--error" aria-label="${escapeHtml(t("object.detailError"))}" role="status">
        <strong>${escapeHtml(t("object.detailError"))}</strong>
        <span>${escapeHtml(hydrationState.message || t("object.detailErrorBody"))}</span>
      </section>
    `;
  }
  if (!body.catalog?.preview) return "";
  return `
    <section class="object-detail-state" aria-label="Object detail state">
      <strong>${escapeHtml(t("object.catalogPreview"))}</strong>
      <span>${escapeHtml(t("object.catalogPreviewBody"))}</span>
    </section>
  `;
}

private renderObjectSummaryCard(body: Body, typeLabel: string) {
  const summary = this.objectSummaryText(body, typeLabel);
  const contextItems = this.objectSummaryContext(body);
  return `
    <section class="object-summary-card" aria-label="${escapeHtml(t("object.whyThisMatters"))}">
      <div>
        <span>${escapeHtml(t("object.whyThisMatters"))}</span>
        <p>${escapeHtml(summary)}</p>
      </div>
      ${
        contextItems.length > 0
          ? `<ul>${contextItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : ""
      }
    </section>
  `;
}

private renderUniverseSciencePanel(body: Body) {
  const distanceLy = body.distance_from_earth_km / 9_460_730_472_580.8;
  if (distanceLy < 100_000) return "";
  const shell = this.context.universeShellForRadius(distanceLy);
  const classification = classifyBody(body);
  const record = { position_model: body.catalog?.position_model, facts: body.catalog?.facts };
  const redshift = measuredRedshift(record);
  const semantics = scienceSemanticsFor(body.catalog?.position_model);
  const chips = [
    [t("universe.context.distance"), this.context.formatLightYears(distanceLy)],
    ...(redshift == null ? [] : [["Catalog spectroscopic redshift", String(redshift)]]),
    ...(semantics?.cosmology && semantics.distance_kind
      ? [["Distance convention", `${semantics.distance_kind.replace(/_/g, " ")} · ${semantics.cosmology.name}`]]
      : []),
    [t("universe.context.shell"), t(shell.labelKey)]
  ];
  return `
    <section class="object-science-panel">
      <div class="object-science-panel__heading">
        <span>${escapeHtml(t("object.scienceContext"))}</span>
        <strong>${escapeHtml(t("object.cosmicTimeMachine"))}</strong>
      </div>
      <p>${escapeHtml(t("object.scienceContextBody", { name: body.name, type: classification.label.toLowerCase() }))}</p>
      <dl>${chips.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      <p class="science-caveat">${escapeHtml(uncertaintySummary(record))}</p>
      <a href="/methodology" data-analytics-event="methodology">${escapeHtml(t("launch.readMethodology"))}</a>
    </section>
  `;
}

private objectSummaryText(body: Body, typeLabel: string) {
  const curated = this.firstText([body.exoplanet_system?.why_interesting, body.deep_sky?.why_interesting]);
  if (curated) return curated;
  const curatedSummary = this.context.curatedSummaries[body.key.toLowerCase()] ?? this.curatedAliasSummary(body);
  if (curatedSummary) return curatedSummary;

  const name = body.name;
  switch (body.object_type) {
    case "planet":
      return t("summary.planet", { name });
    case "moon":
      return t("summary.moon", { name });
    case "star":
      return body.stellar?.exoplanet_count ? t("summary.exoplanetHost", { name, count: body.stellar.exoplanet_count }) : t("summary.star", { name });
    case "dwarf_planet":
      return t("summary.dwarfPlanet", { name });
    case "galaxy":
      return t("summary.galaxy", { name });
    case "quasar":
      return t("summary.quasar", { name });
    case "active_galaxy":
      return t("summary.activeGalaxy", { name });
    case "nebula":
      return t("summary.nebula", { name });
    case "star_cluster":
      return t("summary.starCluster", { name });
    case "asteroid":
    case "comet":
    case "small_body":
      return t("summary.smallBody", { name });
    default:
      if (body.exoplanet_system) return t("summary.exoplanetSystem", { name });
      return t("summary.generic", { name, type: typeLabel.toLowerCase() });
  }
}

private curatedAliasSummary(body: Body) {
  const aliases = [body.name, ...(body.aliases ?? []), ...(body.catalog?.aliases ?? []), ...(body.deep_sky?.aliases ?? []), body.deep_sky?.common_name ?? ""];
  for (const alias of aliases) {
    const key = alias.trim().toLowerCase();
    if (key === "great globular cluster in hercules" || key === "hercules globular cluster" || key === "ngc 6205") return this.context.curatedSummaries.m13;
    if (key === "andromeda galaxy") return this.context.curatedSummaries.m31;
    if (key === "orion nebula" || key === "great nebula in orion") return this.context.curatedSummaries.m42;
    if (key === "pleiades" || key === "seven sisters") return this.context.curatedSummaries.m45;
    if (key === "ring nebula") return this.context.curatedSummaries.m57;
  }
  return null;
}

private objectSummaryContext(body: Body) {
  const items = [
    body.deep_sky?.constellation ? t("summary.contextConstellation", { value: body.deep_sky.constellation }) : null,
    body.deep_sky?.viewing_season ? t("summary.contextSeason", { value: body.deep_sky.viewing_season }) : null,
    body.exoplanet_system?.confirmed_planet_count != null
      ? t("summary.contextPlanets", { count: body.exoplanet_system.confirmed_planet_count })
      : null,
    body.stellar?.distance_ly != null ? t("summary.contextDistance", { value: formatNumber(body.stellar.distance_ly) }) : null,
    body.small_body?.neo ? t("summary.contextNeo") : null,
    body.catalog_group ? t("summary.contextCatalog", { value: this.context.readableCatalogGroup(body.catalog_group) ?? body.catalog_group }) : null
  ].filter(isPresent);
  return items.slice(0, 3);
}

private firstText(values: readonly (string | null | undefined)[]) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

private renderIdentifierSection(body: Body) {
  const aliases = this.aliasesForBody(body);
  const identifiers = this.externalIdentifierEntries(body);
  if (aliases.length === 0 && identifiers.length === 0) return "";
  return `
    <section class="data-section object-identifiers">
      <h3>${escapeHtml(t("object.aliasesIds"))}</h3>
      ${aliases.length ? `<div class="identifier-chips">${aliases.map((alias) => `<span>${escapeHtml(alias)}</span>`).join("")}</div>` : ""}
      ${
        identifiers.length
          ? `<dl class="detail-grid">${identifiers
              .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
              .join("")}</dl>`
          : ""
      }
    </section>
  `;
}

private renderMediaSection(body: Body) {
  return `
    <section class="data-section object-media-section">
      <h3>${escapeHtml(t("object.media"))}</h3>
      ${this.renderObjectMedia(body)}
    </section>
  `;
}

private renderObjectNotes(body: Body) {
  const notes = [body.exoplanet_system?.why_interesting, body.deep_sky?.why_interesting, ...(body.orbit?.notes ?? [])].filter(isPresent);
  if (notes.length === 0) return "";
  return `
    <section class="data-section object-notes">
      <h3>${escapeHtml(t("object.scientificNotes"))}</h3>
      ${notes.map((note) => `<p class="object-note">${escapeHtml(note)}</p>`).join("")}
    </section>
  `;
}

private renderSourceSection(body: Body) {
  const links = this.externalLinksForBody(body);
  const semantics = scienceSemanticsFor(body.catalog?.position_model);
  const ephemeris = this.context.ephemeris();
  const sourceRows = [
    [t("field.catalogSource"), this.context.readableOptionalModel(body.catalog?.source_type)],
    [t("field.positionModel"), this.context.readableOptionalModel(body.catalog?.position_model)],
    [t("field.catalogGroup"), this.context.readableCatalogGroup(body.catalog_group ?? body.catalog?.catalog_group)],
    [t("field.atlasSource"), ephemeris?.data_source ?? null],
    [t("field.epoch"), ephemeris?.timestamp_utc ? this.context.formatFullDate(ephemeris.timestamp_utc) : null],
    ["Distance kind", semantics?.distance_kind?.replace(/_/g, " ") ?? null],
    ["Catalog epoch", semantics?.catalog_epoch ?? null],
    ["Position epoch", semantics?.position_epoch ?? null],
    ["Uncertainty", uncertaintySummary({ position_model: body.catalog?.position_model, facts: body.catalog?.facts })],
    ["Selection caveat", semantics?.selection_caveat ?? null]
  ];
  const rows = this.renderRows(sourceRows);
  if (!rows && links.length === 0) return "";
  return `
    <section class="data-section object-sources">
      <h3>${escapeHtml(t("object.sourceLinks"))}</h3>
      ${rows ? `<dl class="detail-grid">${rows}</dl>` : ""}
      <div class="science-actions"><a href="/methodology" data-analytics-event="methodology">${escapeHtml(t("launch.readMethodology"))}</a><button type="button" class="text-action" data-copy-citation="${escapeHtml(body.key)}">${escapeHtml(t("launch.copyCitation"))}</button></div>
      ${
        links.length
          ? `<div class="source-link-list">${links
              .map(
                (link) => `
                  <a href="${escapeHtml(link.url ?? "")}" target="_blank" rel="noreferrer">
                    <span>${escapeHtml(link.provider ?? t("object.source"))}</span>
                    <strong>${escapeHtml(link.label ?? t("object.openSourceRecord"))}</strong>
                  </a>
                `
              )
              .join("")}</div>`
          : ""
      }
    </section>
  `;
}

async copyCitationDetails(body: Body, button: HTMLButtonElement) {
  const semantics = scienceSemanticsFor(body.catalog?.position_model);
  const identifiers = Object.entries(body.catalog?.external_ids ?? {})
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}: ${value}`);
  const sourceDate = body.catalog?.source?.generated_at_utc ?? body.catalog?.source?.accessed_at_utc ?? body.catalog?.source?.build_date ?? "Not supplied";
  const citation = [
    `Cosmic Atlas object: ${body.name}`,
    `Stable atlas key: ${body.key}`,
    identifiers.length ? `Source identifiers: ${identifiers.join(", ")}` : "Source identifiers: Not supplied",
    `Source: ${semantics?.source.label ?? body.catalog?.source_type ?? "Not supplied"}`,
    `Source URL/DOI: ${semantics?.source.doi_url ?? semantics?.source.url ?? this.externalLinksForBody(body)[0]?.url ?? "Not supplied"}`,
    `Catalog release: ${semantics?.source.release ?? "Not supplied"}`,
    `Position model: ${body.catalog?.position_model ?? "Not supplied"}`,
    `Access/build date: ${String(sourceDate)}`,
    `Cosmic Atlas release: ${this.context.manifest.value?.version ?? "application release not supplied"}`,
    `Sampling context: ${this.citationSamplingContext(body)}`
  ].join("\n");
  await navigator.clipboard.writeText(citation);
  const previous = button.textContent;
  button.textContent = t("launch.citationCopied");
  window.setTimeout(() => (button.textContent = previous), 1600);
  trackEvent("citation_copied", { source: body.catalog?.source_type ?? "unknown" });
}

private citationSamplingContext(body: Body) {
  const layer = this.context.manifest.value?.layers.find((candidate) => candidate.groups.includes(body.catalog_group ?? ""));
  if (!layer) return "Selected named object; no static-layer sampling metadata applies.";
  const level = this.closestLayerLevel(layer);
  if (!level) return `${layer.id}; sampling metadata unavailable.`;
  const rate = level.raw_point_count && level.point_count != null ? level.point_count / level.raw_point_count : 1;
  return `${layer.id}, displayed ${formatCount(level.point_count ?? 0)} of ${formatCount(level.raw_point_count ?? level.point_count ?? 0)} at this LOD (${this.formatPercent(rate)}), release ${this.context.manifest.value?.version}.`;
}

private closestLayerLevel(layer: CatalogPointTileManifestLayer) {
  const targetSpan = Math.max(1, this.context.currentViewWidthLy() * AU_PER_LIGHT_YEAR / 2);
  return [...layer.levels].sort((a, b) => Math.abs(Math.log2(a.span_au / targetSpan)) - Math.abs(Math.log2(b.span_au / targetSpan)))[0] ?? null;
}

private formatPercent(value: number) {
  return `${Math.min(100, Math.max(0, value * 100)).toLocaleString(undefined, { maximumFractionDigits: value < 0.01 ? 3 : 1 })}%`;
}

updateScienceLayerDisclosure() {
  if (!this.context.manifest.value) return;
  const rows = this.context.manifest.value.layers.map((layer) => {
    const available = Object.values(layer.source_counts).reduce((sum, count) => sum + count, 0);
    const level = this.closestLayerLevel(layer);
    const displayed = level?.point_count ?? available;
    const raw = level?.raw_point_count ?? displayed;
    const rate = raw > 0 ? displayed / raw : 1;
    const context: Record<string, string> = {
      gaia_stars: "Gaia positive-parallax quality tiers; parallax and magnitude cuts vary by tier. Not a complete stellar census.",
      desi_dr1: "DESI DR1 successful spectroscopy and target/class cuts inside the DESI footprint.",
      quaia_g20: "Quaia G<20 quasar candidates with inferred redshifts; near-all-sky selection is not spectroscopic completeness.",
      deep_sky: "Named and literature-compiled catalogs with heterogeneous selection and coverage.",
      xray: "eROSITA-DE DR2 (eRASS:3) and SDSS-V DR20 SPIDERS DL1. Distances come from spectroscopic or SIMBAD-compiled redshifts where available; sources without a usable redshift are drawn on an explicit 1 billion ly reference shell (display convention, not a measurement)."
    };
    return `<section><strong>${escapeHtml(layer.id.replace(/_/g, " "))}</strong><dl><div><dt>${escapeHtml(t("launch.sourceObjects"))}</dt><dd>${escapeHtml(formatCount(available))}</dd></div><div><dt>${escapeHtml(t("launch.displayedAvailable"))}</dt><dd>${escapeHtml(formatCount(displayed))} / ${escapeHtml(formatCount(raw))}</dd></div><div><dt>${escapeHtml(t("launch.sampleRate"))}</dt><dd>${escapeHtml(this.formatPercent(rate))}</dd></div><div><dt>${escapeHtml(t("launch.release"))}</dt><dd>${escapeHtml(this.context.manifest.value!.version)}</dd></div></dl><p>${escapeHtml(context[layer.id] ?? t("launch.methodologyCaveat"))}</p></section>`;
  });
  this.context.scienceLayerDisclosure.innerHTML = rows.join("");
}

private renderRelatedObjects(body: Body) {
  const sections = this.relatedObjectSections(body);
  if (sections.length === 0) return "";
  return `
    <section class="data-section object-related">
      <h3>${escapeHtml(t("object.relatedObjects"))}</h3>
      <div class="related-section-list">
        ${sections
          .map(
            (section) => `
              <section class="related-section">
                <h4>${escapeHtml(section.title)}</h4>
                <div class="related-object-grid">
                  ${section.bodies.map((related) => this.renderRelatedObjectButton(body, related)).join("")}
                </div>
              </section>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

private renderObjectMedia(body: Body) {
  const media = objectMediaFor(body);
  if (!media) {
    const status = objectMediaStatusFor(body);
    return `
      <section class="object-media object-media--empty" aria-label="${escapeHtml(t("object.mediaStatus"))}">
        <div class="object-media__empty">
          <span class="object-media__badge">${escapeHtml(status.badge)}</span>
          <strong>${escapeHtml(status.title)}</strong>
          <p>${escapeHtml(status.description)}</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="object-media object-media--${escapeHtml(media.kind)}" aria-label="${escapeHtml(t("object.mediaLabel"))}">
      <div class="object-media__image">
        <img src="${escapeHtml(media.imageUrl)}" alt="${escapeHtml(media.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
        <span class="object-media__badge">${escapeHtml(media.badge)}</span>
      </div>
      <div class="object-media__caption">
        <strong>${escapeHtml(media.title)}</strong>
        ${media.description ? `<p>${escapeHtml(media.description)}</p>` : ""}
        <span>${escapeHtml(media.credit)}</span>
        <a href="${escapeHtml(media.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(media.license)}</a>
      </div>
    </section>
  `;
}

private aliasesForBody(body: Body) {
  return uniqueTextValues([...(body.aliases ?? []), ...(body.catalog?.aliases ?? []), ...(body.deep_sky?.aliases ?? []), body.deep_sky?.common_name ?? null])
    .filter((alias) => alias.toLowerCase() !== body.name.toLowerCase())
    .slice(0, 16);
}

private externalIdentifierEntries(body: Body): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(body.catalog?.external_ids ?? {})) {
    const formatted = identifierValue(value);
    if (formatted) entries.push([identifierLabel(key), formatted]);
  }
  if (body.stellar?.hip) entries.push(["HIP", `HIP ${body.stellar.hip}`]);
  if (body.stellar?.hd) entries.push(["HD", `HD ${body.stellar.hd}`]);
  return uniquePairs(entries).slice(0, 12);
}

private externalLinksForBody(body: Body) {
  const classification = classifyBody(body);
  const lookupName = body.deep_sky?.common_name || body.name;
  const generatedLinks: ExternalLink[] = [];

  // SPIDERS DL1 rows carry survey-internal names that SIMBAD/NED cannot resolve.
  const resolvableName = body.catalog_group !== "sdss_spiders_dr20";

  if (resolvableName && ["star", "star_cluster", "nebula", "galaxy", "quasar", "active_galaxy", "black_hole", "xray_source", "xray_extended"].includes(classification.type)) {
    generatedLinks.push({
      provider: "SIMBAD",
      label: "SIMBAD object lookup",
      url: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(lookupName)}`
    });
  }

  if (resolvableName && ["galaxy", "quasar", "active_galaxy", "black_hole"].includes(classification.type)) {
    generatedLinks.push({
      provider: "NED",
      label: "NASA/IPAC Extragalactic Database lookup",
      url: `https://ned.ipac.caltech.edu/byname?objname=${encodeURIComponent(lookupName)}`
    });
  }

  if (body.catalog?.source_type === "jpl_sbdb_query" || body.key.startsWith("jpl-sbdb-")) {
    const spkId = identifierValue(body.catalog?.external_ids?.jpl_spkid) ?? body.name;
    generatedLinks.push({
      provider: "NASA/JPL SBDB",
      label: "Small-Body Database lookup",
      url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(spkId)}`
    });
  }

  return normalizeExternalLinks([...(body.catalog?.external_links ?? []), ...generatedLinks]);
}

private relatedObjectSections(body: Body): { title: string; bodies: Body[] }[] {
  const sections: { title: string; bodies: Body[] }[] = [];
  const seen = new Set([body.key]);
  const append = (title: string, bodies: Body[]) => {
    const uniqueBodies = bodies.filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
    if (uniqueBodies.length > 0) sections.push({ title, bodies: uniqueBodies });
  };

  const parent = body.parent_key ? this.context.bodyByKey().get(body.parent_key) ?? null : null;
  append(t("object.parentBody"), parent ? [parent] : []);
  append(t("object.moonsChildren"), this.childrenForBody(body).slice(0, 8));
  append(t("object.nearbyInView"), this.nearbyVisibleBodies(body).slice(0, 6));
  append(t("object.sameCatalog"), this.sameCatalogNeighbors(body).slice(0, 6));

  return sections;
}

private renderRelatedObjectButton(source: Body, related: Body) {
  const classification = classifyBody(related);
  const distanceLabel = this.context.formatDistance(this.context.bodyDistanceKm(source, related));
  return `
    <button type="button" class="related-object" data-related-key="${escapeHtml(related.key)}" style="--body-color: ${escapeHtml(related.color)}">
      <span class="body-orb"></span>
      <span>
        <strong>${escapeHtml(shortBodyName(related.name))}</strong>
        <small>${escapeHtml(classification.label)} · ${escapeHtml(distanceLabel)} ${escapeHtml(t("object.fromSource", { name: shortBodyName(source.name) }))}</small>
      </span>
    </button>
  `;
}

private childrenForBody(body: Body) {
  return (this.context.ephemeris()?.bodies ?? [])
    .filter((candidate) => candidate.parent_key === body.key)
    .sort((a, b) => a.distance_from_earth_km - b.distance_from_earth_km);
}

private nearbyVisibleBodies(body: Body) {
  const viewport = this.context.usableViewportRect();
  return (this.context.ephemeris()?.bodies ?? [])
    .filter((candidate) => {
      if (candidate.key === body.key) return false;
      const screen = this.context.worldToScreen(candidate.position.x_au, candidate.position.y_au);
      return pointInRect(screen, viewport);
    })
    .sort((a, b) => this.context.bodyDistanceKm(body, a) - this.context.bodyDistanceKm(body, b));
}

private sameCatalogNeighbors(body: Body) {
  const catalogGroup = body.catalog_group ?? body.catalog?.catalog_group;
  if (!catalogGroup) return [];
  return (this.context.ephemeris()?.bodies ?? [])
    .filter((candidate) => candidate.key !== body.key && (candidate.catalog_group ?? candidate.catalog?.catalog_group) === catalogGroup)
    .sort((a, b) => this.context.bodyDistanceKm(body, a) - this.context.bodyDistanceKm(body, b));
}

private renderExoplanetList(planets: BodyExoplanet[]) {
  if (planets.length === 0) return "";
  const visiblePlanets = planets.slice(0, 8);
  const hiddenCount = Math.max(0, planets.length - visiblePlanets.length);
  return `
    <ol class="planet-list">
      ${visiblePlanets
        .map((planet) => {
          const facts = [
            planet.semi_major_axis_au ? `${formatNumber(planet.semi_major_axis_au)} AU` : null,
            planet.period_days ? `${formatNumber(planet.period_days)} d` : null,
            planet.radius_earth ? `${formatNumber(planet.radius_earth)} Earth radii` : null,
            planet.discovery_year ? String(planet.discovery_year) : null
          ].filter(isPresent);
          return `<li><strong>${escapeHtml(planet.name)}</strong><span>${escapeHtml(facts.join(" · ") || t("object.planetParametersIncomplete"))}</span></li>`;
        })
        .join("")}
    </ol>
    ${hiddenCount ? `<p class="object-note">${escapeHtml(t("object.moreConfirmedPlanets", { count: hiddenCount, planetWord: t(hiddenCount === 1 ? "object.planetSingular" : "object.planetPlural") }))}</p>` : ""}
  `;
}

private renderFactTiles(rows: (string | number | null | undefined)[][]) {
  const tiles = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  return `
    <dl class="fact-tiles">
      ${tiles.map(([label, value]) => `<div><dt>${escapeHtml(String(label))}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("")}
    </dl>
  `;
}

private renderDataSection(title: string, rows: (string | number | null | undefined)[][], extra = "") {
  const values = this.renderRows(rows);
  if (!values && !extra) return "";
  return `
    <section class="data-section">
      <h3>${escapeHtml(title)}</h3>
      ${values ? `<dl class="detail-grid">${values}</dl>` : ""}
      ${extra}
    </section>
  `;
}

private renderRows(rows: (string | number | null | undefined)[][]) {
  return rows
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => `<dt>${escapeHtml(String(label))}</dt><dd>${escapeHtml(String(value ?? t("value.unknown")))}</dd>`)
    .join("");
}

}

export function normalizeExternalLinks(links: readonly ExternalLink[]): ExternalLink[] {
  const seen = new Set<string>();
  return links
    .map((link) => ({
      provider: typeof link.provider === "string" && link.provider.trim() ? link.provider.trim() : t("object.source"),
      label: typeof link.label === "string" && link.label.trim() ? link.label.trim() : t("object.openSourceRecord"),
      url: typeof link.url === "string" ? link.url.trim() : "",
    }))
    .filter((link) => {
      if (!isSafeExternalUrl(link.url ?? "") || seen.has(link.url ?? "")) return false;
      seen.add(link.url ?? "");
      return true;
    });
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
