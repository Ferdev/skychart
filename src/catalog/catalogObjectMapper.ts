import type { DestinationBodyType } from "../destinationPicker";
import type {
  Body,
  BodyExoplanet,
  CatalogObjectPayload,
  ExternalLink,
} from "../atlas/contracts";
import { smallBodyPositionAt } from "./smallBodyPropagation";

export type CatalogMappingContext = {
  auKm: number;
  earth?: Body;
  timestamp?: string;
  normalizeExternalLinks?: (links: readonly ExternalLink[]) => ExternalLink[];
};

/** Turns the catalog transport shape into the atlas's complete domain object. */
export class CatalogObjectMapper {
  constructor(private readonly context: () => CatalogMappingContext) {}

  map(object: CatalogObjectPayload): Body {
    const context = this.context();
    const facts = object.facts ?? {};
    const position = object.position ?? {};
    const propagated = object.catalog_group === "jpl_small_bodies" && object.parent_key === "sun" && context.timestamp
      ? smallBodyPositionAt(facts, context.timestamp)
      : null;
    const xAu = propagated?.xAu ?? finiteNumber(position.x_au, 0);
    const yAu = propagated?.yAu ?? finiteNumber(position.y_au, 0);
    const zAu = propagated?.zAu ?? finiteNumber(position.z_au, 0);
    const xKm = propagated ? xAu * context.auKm : finiteNumber(position.x_km, xAu * context.auKm);
    const yKm = propagated ? yAu * context.auKm : finiteNumber(position.y_km, yAu * context.auKm);
    const zKm = propagated ? zAu * context.auKm : finiteNumber(position.z_km, zAu * context.auKm);
    const earthPosition = context.earth?.position;
    const distanceFromEarthKm = earthPosition
      ? Math.hypot(
          xAu - earthPosition.x_au,
          yAu - earthPosition.y_au,
          zAu - earthPosition.z_au,
        ) * context.auKm
      : Math.hypot(xKm, yKm, zKm);
    const astrometry = object.astrometry ?? {};
    const objectType = normalizeDestinationType(object.object_type);
    const isDeepSkyLike = [
      "galaxy",
      "nebula",
      "star_cluster",
      "quasar",
      "active_galaxy",
      "black_hole",
      "pulsar",
      "xray_source",
      "xray_extended",
    ].includes(objectType);
    const isSmallBodyLike = ["asteroid", "comet", "small_body"].includes(objectType);
    const externalLinks = context.normalizeExternalLinks
      ? context.normalizeExternalLinks(object.external_links ?? [])
      : [...(object.external_links ?? [])];

    return {
      key: object.key,
      name: object.name,
      radius_km: finiteNumber(object.radius_km, 0),
      color: object.color || "#d9b86f",
      object_type: objectType,
      parent_key: object.parent_key ?? undefined,
      catalog_group: object.catalog_group ?? undefined,
      aliases: object.aliases ?? [],
      catalog: {
        source_type: object.source_type,
        position_model: object.position_model,
        dynamic_position: propagated !== null,
        preview: true,
        parent_key: object.parent_key,
        catalog_group: object.catalog_group ?? undefined,
        aliases: object.aliases ?? [],
        ra_deg: finiteOptionalNumber(astrometry.ra_deg),
        dec_deg: finiteOptionalNumber(astrometry.dec_deg),
        external_ids: object.external_ids ?? null,
        external_links: externalLinks,
        source: object.source ?? null,
        facts: object.facts ?? null,
      },
      stellar: objectType === "star"
        ? {
            distance_ly: finiteOptionalNumber(astrometry.distance_ly),
            parallax_mas: finiteOptionalNumber(facts.parallax_mas),
            apparent_magnitude: finiteOptionalNumber(astrometry.apparent_magnitude),
            absolute_magnitude: finiteOptionalNumber(astrometry.absolute_magnitude),
            bv_color_index: finiteOptionalNumber(facts.bv_color_index),
            stellar_radius_solar: finiteOptionalNumber(facts.stellar_radius_solar),
            stellar_teff_k: finiteOptionalNumber(facts.stellar_teff_k),
            spectral_type: stringFact(facts.spectral_type),
          }
        : null,
      deep_sky: isDeepSkyLike
        ? {
            aliases: object.aliases ?? [],
            deep_sky_type_label: stringFact(facts.deep_sky_type_label) ?? stringFact(facts.simbad_object_type_label),
            apparent_magnitude: finiteOptionalNumber(astrometry.apparent_magnitude),
            angular_size_arcmin: stringFact(facts.angular_size_arcmin),
            constellation: stringFact(facts.constellation),
            viewing_season: stringFact(facts.viewing_season),
            common_name: stringFact(facts.common_name),
            observing_equipment: stringFact(facts.observing_equipment),
            why_interesting: stringFact(facts.why_interesting),
            physical_diameter_ly: finiteOptionalNumber(facts.physical_diameter_ly),
            physical_minor_diameter_ly: finiteOptionalNumber(facts.physical_minor_diameter_ly),
            physical_size_note: stringFact(facts.physical_size_note) ?? stringFact(facts.distance_quality),
          }
        : null,
      exoplanet_system: isExoplanetObject(object)
        ? {
            confirmed_planet_count: object.catalog_group === "exoplanets"
              ? 1
              : finiteOptionalNumber(facts.exoplanet_count) ?? finiteOptionalNumber(facts.system_planet_count),
            system_star_count: finiteOptionalNumber(facts.system_star_count),
            system_planet_count: finiteOptionalNumber(facts.system_planet_count),
            system_moon_count: finiteOptionalNumber(facts.system_moon_count),
            planets: object.catalog_group === "exoplanets"
              ? [catalogObjectToExoplanet(object)]
              : Array.isArray(facts.planets) ? facts.planets as BodyExoplanet[] : [],
            why_interesting: stringFact(facts.why_interesting),
          }
        : null,
      small_body: isSmallBodyLike
        ? {
            orbit_class: stringFact(facts.orbit_class),
            neo: booleanFact(facts.neo),
            pha: booleanFact(facts.pha),
            diameter_km: finiteOptionalNumber(facts.diameter_km),
            estimated_diameter_km: finiteOptionalNumber(facts.estimated_diameter_km),
            h_absolute_magnitude: finiteOptionalNumber(facts.h_absolute_magnitude),
            perihelion_au: finiteOptionalNumber(facts.perihelion_au),
            aphelion_au: finiteOptionalNumber(facts.aphelion_au),
            semi_major_axis_au: finiteOptionalNumber(facts.semi_major_axis_au),
            eccentricity: finiteOptionalNumber(facts.eccentricity),
            inclination_deg: finiteOptionalNumber(facts.inclination_deg),
            orbital_period_days: finiteOptionalNumber(facts.orbital_period_days),
            earth_moid_au: finiteOptionalNumber(facts.earth_moid_au),
          }
        : null,
      position: {
        x_au: xAu,
        y_au: yAu,
        z_au: zAu,
        x_km: xKm,
        y_km: yKm,
        z_km: zKm,
        heliocentric_distance_km: Math.hypot(xKm, yKm, zKm),
      },
      distance_from_earth_km: distanceFromEarthKm,
    };
  }
}

export function finiteOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isExoplanetObject(object: CatalogObjectPayload): boolean {
  return ["exoplanet_systems", "nearby_exoplanet_systems", "exoplanets"].includes(object.catalog_group ?? "");
}

function catalogObjectToExoplanet(object: CatalogObjectPayload): BodyExoplanet {
  const facts = object.facts ?? {};
  return {
    name: object.name,
    radius_earth: finiteOptionalNumber(facts.radius_earth),
    mass_earth: finiteOptionalNumber(facts.mass_earth),
    period_days: finiteOptionalNumber(facts.period_days),
    semi_major_axis_au: finiteOptionalNumber(facts.semi_major_axis_au),
    discovery_method: stringFact(facts.discovery_method),
    discovery_year: finiteOptionalNumber(facts.discovery_year),
  };
}

function normalizeDestinationType(type: string | null | undefined): DestinationBodyType {
  const allowed = new Set<DestinationBodyType>([
    "star", "planet", "moon", "dwarf_planet", "galaxy", "quasar",
    "active_galaxy", "black_hole", "pulsar", "nebula", "star_cluster",
    "xray_source", "xray_extended",
    "asterism", "milky_way_patch", "asteroid", "comet", "small_body", "unknown",
  ]);
  return allowed.has(type as DestinationBodyType) ? type as DestinationBodyType : "unknown";
}

function stringFact(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function booleanFact(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
