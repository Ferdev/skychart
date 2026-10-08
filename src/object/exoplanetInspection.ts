import type { Body, BodyExoplanet } from "../atlas/contracts";
import { escapeHtml, formatNumber } from "../atlasFormatting";
import { isPresent } from "../geometry";
import { t } from "../i18n";
import { hasPlanetarySystemView } from "./exoplanetSystemNavigator";

type Facts = Record<string, unknown>;
type Row = [string, string | null];

const CONVENTION_TEXT_KEYS: Record<string, string> = {
  node_angle: "exoplanet.conventionNode",
  edge_on_inclination: "exoplanet.conventionInclination",
  circular_orbit: "exoplanet.conventionCircle",
};
const QUANTITY_TEXT_KEYS: Record<string, string> = {
  period: "exoplanet.quantityPeriod",
  semi_major_axis: "exoplanet.quantityOrbitSize",
  radius: "exoplanet.quantityRadius",
  mass: "exoplanet.quantityMass",
};
const FLAG_TEXT_KEYS: [string, string][] = [
  ["transit_timing_variations", "exoplanet.flagTtv"],
  ["circumbinary", "exoplanet.flagCircumbinary"],
  ["controversial", "exoplanet.flagControversial"],
  ["ephemeris_mixed_references", "exoplanet.flagMixed"],
];

/**
 * Renders the orbit of one exoplanet: the archive values with their
 * uncertainties, the display state in words, the conventions in use, the
 * flags, and the reference links. Returns "" for a body with no orbit record.
 */
export function renderExoplanetOrbitSection(body: Body): string {
  const orbit = body.exoplanet_orbit;
  const facts = body.catalog?.facts;
  if (body.catalog_group !== "exoplanets" || !orbit || !facts) return "";

  const rows: Row[] = [
    [t("exoplanet.mapPosition"), displayStateText(body)],
    [t("exoplanet.orbitSize"), measurementText(facts, "semi_major_axis_au", "AU", facts.semi_major_axis_calculated === true) ?? t("exoplanet.notAvailable")],
    [t("exoplanet.period"), measurementText(facts, "period_days", "d")],
    [t("exoplanet.eccentricity"), measurementText(facts, "eccentricity", "")],
    [t("exoplanet.inclination"), measurementText(facts, "inclination_deg", "°")],
    [t("exoplanet.argumentOfPeriastron"), measurementText(facts, "argument_of_periastron_deg", "°")],
    [t(facts.ephemeris_reference_type === "periastron" ? "exoplanet.periastronTime" : "exoplanet.conjunctionTime"), referenceTimeText(facts)],
    [t("exoplanet.ephemerisPeriod"), facts.ephemeris_period_days !== facts.period_days ? measurementText(facts, "ephemeris_period_days", "d") : null],
    [t("exoplanet.phaseUncertainty"), orbit.display_state === "none" || !isNumber(facts.ephemeris_period_days) ? null : phaseUncertaintyText(orbit.phase_uncertainty_orbits)],
    [t(facts.minimum_mass === true ? "exoplanet.minimumMass" : "exoplanet.mass"), quantityText(facts.mass_earth, "exoplanet.earthMasses", facts.mass_calculated === true)],
    [t("exoplanet.radius"), quantityText(facts.radius_earth, "exoplanet.earthRadii", facts.radius_calculated === true)],
    [t("exoplanet.equilibriumTemperature"), isNumber(facts.equilibrium_temperature_k) ? `${formatNumber(facts.equilibrium_temperature_k)} K` : null],
    [t("exoplanet.insolation"), isNumber(facts.insolation_earth) ? t("exoplanet.insolationValue", { value: formatNumber(facts.insolation_earth) }) : null],
  ];
  const notes = [
    ...orbit.conventions.map((convention) => CONVENTION_TEXT_KEYS[convention]).filter(isPresent),
    ...FLAG_TEXT_KEYS.filter(([fact]) => facts[fact] === true).map(([, key]) => key),
  ].map((key) => `<li>${escapeHtml(t(key))}</li>`);

  return `
    <section class="data-section exoplanet-orbit" data-exoplanet-state="${escapeHtml(orbit.display_state)}" data-exoplanet-marker="${escapeHtml(orbit.marker)}">
      <h3>${escapeHtml(t("exoplanet.orbitSection"))}</h3>
      <dl class="detail-grid">${rows.filter(([, value]) => value).map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? "")}</dd>`).join("")}</dl>
      ${notes.length ? `<h3>${escapeHtml(t("exoplanet.conventions"))}</h3><ul class="exoplanet-notes">${notes.join("")}</ul>` : ""}
      ${renderReferences(facts)}
    </section>
  `;
}

/** Renders the short planet list of a host star. Each entry with a key selects that planet. */
export function renderExoplanetList(planets: BodyExoplanet[], currentKey: string): string {
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
            planet.radius_earth ? t("exoplanet.earthRadii", { value: formatNumber(planet.radius_earth) }) : null,
            planet.discovery_year ? String(planet.discovery_year) : null
          ].filter(isPresent);
          const content = `<strong>${escapeHtml(planet.name)}</strong><span>${escapeHtml(facts.join(" · ") || t("object.planetParametersIncomplete"))}</span>`;
          return planet.key && planet.key !== currentKey
            ? `<li class="planet-list-action"><button type="button" data-related-key="${escapeHtml(planet.key)}" aria-label="${escapeHtml(t("exoplanet.selectPlanet", { name: planet.name }))}">${content}</button></li>`
            : `<li>${content}</li>`;
        })
        .join("")}
    </ol>
    ${hiddenCount ? `<p class="object-note">${escapeHtml(t("object.moreConfirmedPlanets", { count: hiddenCount, planetWord: t(hiddenCount === 1 ? "object.planetSingular" : "object.planetPlural") }))}</p>` : ""}
  `;
}

/** Renders the "View planetary system" action for a host star or a planet with an orbit. */
export function renderPlanetarySystemAction(body: Body): string {
  if (!hasPlanetarySystemView(body)) return "";
  return `<p class="planetary-system-action"><button type="button" class="text-action" data-planetary-system="${escapeHtml(body.key)}">${escapeHtml(t("exoplanet.viewSystem"))}</button></p>`;
}

function displayStateText(body: Body): string {
  const orbit = body.exoplanet_orbit;
  if (!orbit || orbit.display_state === "none") return t("exoplanet.stateNoOrbit");
  if (orbit.display_state === "position") return t(orbit.marker === "hollow" ? "exoplanet.stateUncertain" : "exoplanet.stateCalculated");
  return t(orbit.display_reason === "phase_uncertainty" ? "exoplanet.statePhaseUncertainty" : "exoplanet.stateNoTiming");
}

/** A value with its published uncertainties, or its limit flag. Null when the archive gives no value. */
function measurementText(facts: Facts, key: string, unit: string, calculated = false): string | null {
  const value = facts[key];
  if (!isNumber(value)) return null;
  const plus = facts[`${key}_err_plus`];
  const minus = facts[`${key}_err_minus`];
  const errors = [plus, minus].filter((error): error is number => isNumber(error) && error > 0);
  const digits = fractionDigits(value, errors);
  const suffix = unit === "°" ? unit : unit ? ` ${unit}` : "";
  const limit = facts[`${key}_limit`];
  const notes = [
    isNumber(limit) && limit !== 0 ? t(limit > 0 ? "exoplanet.upperLimit" : "exoplanet.lowerLimit") : null,
    calculated ? t("exoplanet.calculatedByArchive") : null,
  ].filter(isPresent);
  let text = fixed(value, digits);
  if (isNumber(limit) && limit !== 0) text = `${limit > 0 ? "<" : ">"} ${text}`;
  else if (isNumber(plus) && isNumber(minus) && plus > 0 && minus > 0) {
    text += plus === minus ? ` ± ${fixed(plus, digits)}` : ` +${fixed(plus, digits)} −${fixed(minus, digits)}`;
  }
  return `${text}${suffix}${notes.length ? ` (${notes.join("; ")})` : ""}`;
}

function referenceTimeText(facts: Facts): string | null {
  const time = measurementText(facts, "ephemeris_reference_time_jd", "");
  if (!time) return null;
  const system = typeof facts.ephemeris_time_system === "string" ? facts.ephemeris_time_system : "JD";
  return `${system} ${time}`;
}

function phaseUncertaintyText(value: number | null): string {
  return value === null ? t("exoplanet.notAvailable") : t("exoplanet.phaseUncertaintyValue", { value: formatNumber(value) });
}

function quantityText(value: unknown, textKey: string, calculated: boolean): string | null {
  if (!isNumber(value)) return null;
  const text = t(textKey, { value: formatNumber(value) });
  return calculated ? `${text} (${t("exoplanet.calculatedByArchive")})` : text;
}

function renderReferences(facts: Facts): string {
  const references = Array.isArray(facts.references) ? facts.references.filter(isReference) : [];
  const links = references.map((reference) => {
    const quantities = reference.quantities.map((quantity) => QUANTITY_TEXT_KEYS[quantity]).filter(isPresent).map((key) => t(key));
    return referenceLink(reference.url, reference.label, quantities);
  });
  if (typeof facts.ephemeris_reference_url === "string" && typeof facts.ephemeris_reference_label === "string") {
    links.push(referenceLink(facts.ephemeris_reference_url, facts.ephemeris_reference_label, [t("exoplanet.quantityPhase")]));
  }
  if (links.length === 0) return "";
  return `<h3>${escapeHtml(t("exoplanet.references"))}</h3><ul class="exoplanet-notes">${links.map((link) => `<li>${link}</li>`).join("")}</ul>`;
}

function referenceLink(url: string, label: string, quantities: string[]): string {
  const text = `${escapeHtml(label)}${quantities.length ? ` (${escapeHtml(quantities.join(", "))})` : ""}`;
  return /^https:\/\//.test(url) ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
}

function isReference(value: unknown): value is { label: string; url: string; quantities: string[] } {
  if (typeof value !== "object" || value === null) return false;
  const reference = value as Record<string, unknown>;
  return typeof reference.label === "string" && typeof reference.url === "string" && Array.isArray(reference.quantities);
}

/** Enough fraction digits to show two digits of the smaller uncertainty, or seven significant digits with none. */
function fractionDigits(value: number, errors: number[]): number {
  if (errors.length === 0) {
    const magnitude = value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)));
    const digits = Math.max(0, Math.min(8, 6 - magnitude));
    return Math.min(digits, (Number(value.toFixed(digits)).toString().split(".")[1] ?? "").length);
  }
  return Math.max(0, Math.min(8, 1 - Math.floor(Math.log10(Math.min(...errors)))));
}

function fixed(value: number, digits: number): string {
  return Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
